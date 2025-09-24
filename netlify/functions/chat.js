/*! @file netlify/functions/chat.js
 *  @version 1.0.2
 *  @updated 2025-09-24
 *  واجهة آمنة لـ Gemini مع تخصيص "الشخصية" وسياق الشركة + دعم مرفقات
 *  ملاحظة: تمت إضافة Auto-Profiler + Router متعدد النماذج بدون حذف أي منطق أصلي
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { withCORS, jsonResponse, safeParse } from "./_utils.js";

/** اختر الموديل الافتراضي (يمكن تغييره من متغير بيئة) */
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-1.5-flash";

/** إعدادات التوليد (قابلة للضبط بيئيًا عبر الملحق بالأسفل) */
const generationConfig = {
  temperature: 0.6,
  topK: 32,
  topP: 0.95,
  maxOutputTokens: 1024,
};

export const handler = withCORS(async (event) => {
  // نسمح فقط بالـ POST
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  // مفتاح Gemini
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ Missing GEMINI_API_KEY");
    return jsonResponse(500, { error: "GEMINI_API_KEY is not configured" });
  }

  // قراءة الـ payload بأمان
  const {
    messages = [],
    persona = "",
    company = {},   // يمكن أن يأتي فارغًا — سنبني الملف التعريفي من الحوار
    files = [],
    meta = {}       // اختياري: userId, locale, tz, channel...
  } = safeParse(event.body, {});

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse(400, { error: "messages[] is required" });
  }

  // 1) نبني "تعليمات موجزة" ديناميكية للغاية — بلا نصوص ثابتة جاهزة
  //    الفكرة: نمرر فقط "سياق حي" مشتق من الشخصية/اللغة، دون قوالب.
  const systemPrompt = buildSystemPrompt(persona, company, meta);

  /** نبني contents كما تتوقع مكتبة Gemini:
   *  الأدوار المقبولة: "user" و "model"
   *  نترجم assistant => model لضمان صحة الحوار
   */
  const contents = [];

  // 1) نبدأ برسالة "user" تحتوي على تعليمات موجزة مشتقة (وليست نصًا جاهزًا)
  contents.push({
    role: "user",
    parts: [{ text: systemPrompt }],
  });

  // 2) نضيف المحادثة السابقة بدقة أدوارها
  for (const m of messages) {
    const role = m?.role === "assistant" ? "model" : "user";
    const text = typeof m?.text === "string" ? m.text : "";
    if (!text) continue;

    // دمج الرسائل المتتالية من نفس الدور في جزء واحد أبسط
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text });
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  // 3) دعم مرفقات الملفات (inlineData)
  if (Array.isArray(files) && files.length) {
    let target = contents.findLast?.((c) => c.role === "user");
    if (!target) {
      target = { role: "user", parts: [] };
      contents.push(target);
    }
    for (const f of files) {
      if (f?.mime && f?.base64) {
        target.parts.push({
          inlineData: { data: f.base64, mimeType: f.mime },
        });
      }
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // === (أ) استدعاء الدردشة الأساسي ===
    const model = genAI.getGenerativeModel({
      model: MODEL_ID,
      generationConfig,
    });

    const result = await model.generateContent({ contents });
    const text =
      (result?.response && typeof result.response.text === "function"
        ? result.response.text()
        : null) || "لم يصل رد من النموذج.";

    // === (ب) Auto-Profiler: استنتاج ملف الشركة/الأهداف من الحوار — بلا قوالب جاهزة ===
    //     نطلب من النموذج ذاته استخراج "patch" للذاكرة بصيغة JSON نظيفة.
    //     هذا ليس نصًا جاهزًا للعرض؛ هو بيانات منظمة من سياق الكلام فقط.
    let memoryPatch = null;
    try {
      memoryPatch = await autoProfileFromConversation(genAI, {
        messages,
        persona,
        company,
        meta
      });
    } catch (e) {
      try { console.warn("⚠️ AutoProfiler failed:", e?.message || e); } catch {}
    }

    // نعيد النص + patch اختياري (يمكن للواجهة حفظه في localStorage/DB)
    return jsonResponse(200, { text, memoryPatch: memoryPatch || undefined });
  } catch (err) {
    // معالجة أخطاء مقروءة
    const status = err?.status || err?.code || 500;
    const message =
      err?.message?.toString?.() ||
      (typeof err === "string" ? err : "Gemini request failed");

    // بعض أخطاء 400 تأتي من content غير صحيح — نطبع محتويات مختصرة للتشخيص
    try {
      console.error("❌ Gemini error:", status, message, {
        model: MODEL_ID,
        hasFiles: Array.isArray(files) && files.length > 0,
        turns: contents.length,
        lastTurnRole: contents[contents.length - 1]?.role,
        lastTurnParts: contents[contents.length - 1]?.parts?.length,
      });
    } catch {}

    return jsonResponse(
      typeof status === "number" ? status : 500,
      {
        error: "Gemini request failed",
        code: typeof status === "number" ? status : 500,
        details:
          process.env.NODE_ENV === "development" ? String(message) : undefined,
      }
    );
  }
});

/** بناء تعليمات موجزة مشتقة من السياق — بدون نصوص جاهزة أو قوالب ثابتة */
function buildSystemPrompt(persona = "", company = {}, meta = {}) {
  // نشتق فقط إشارات خفيفة للسياق (اللغة/القناة/الشخصية) دون قوالب.
  const lang = meta?.lang || "ar";
  const channel = meta?.channel ? `@${meta.channel}` : "";
  const p = persona ? `(${persona})` : "";
  const orgHint = company && Object.keys(company).length ? `|org` : "";
  // سطر موجز يُعلِم النموذج بأن يقرأ السياق ويتصرف كمستشار محترف — بلا نص جاهز
  return `[context:${lang}${channel}] [mode:advisor${p}${orgHint}]`;
}

/* =============================== Auto-Profiler ===============================
   يستنتج "ذاكرة" منظمة من الحوار نفسه (بدون قوالب/نصوص جاهزة للمستخدم)
   ويعيد patch آمن يمكن للواجهة تخزينه (localStorage/DB).
   -------------------------------------------------------------------------- */

async function autoProfileFromConversation(genAI, { messages = [], persona = "", company = {}, meta = {} }) {
  // نكوّن محتوى مختصرًا: آخر N رسائل كافية للاستخلاص
  const N = 16;
  const recent = messages.slice(-N).map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.text || "") }]
  }));

  // نطلب من النموذج إرجاع JSON صارم فقط — لا نصوص جاهزة، لا قوالب.
  const extractor = genAI.getGenerativeModel({
    model: process.env.G9_EXTRACTOR_MODEL || "gemini-1.5-pro",
    generationConfig: {
      temperature: Number(process.env.G9_EXTRACTOR_TEMP ?? 0.1),
      topK: 64,
      topP: 0.9,
      maxOutputTokens: Number(process.env.G9_EXTRACTOR_TOKENS ?? 512),
    }
  });

  const schemaHint = {
    // تلميح هيكلي — ليس نصًا جاهزًا — يحدّد شكل JSON المطلوب فقط
    want: {
      company: ["name","industry","size","audience","goals","region","currency"],
      preferences: ["tone","lang","reporting","units"],
      constraints: ["budget","deadline","compliance"],
      opportunities: ["quickWins","channels","segments"],
      updatedFields: [] // أسماء الحقول التي تغيّرت فعليًا
    }
  };

  const req = [
    { role: "user", parts: [{ text: "[extract-structured-profile-json]" }] },
    ...recent,
    { role: "user", parts: [{ text: JSON.stringify({ persona, meta, schemaHint }) }] }
  ];

  // محاولات مع backoff (يستفيد من router السفلي تلقائيًا)
  const r = await extractor.generateContent({ contents: req });
  const raw = (r?.response && typeof r.response.text === "function") ? r.response.text() : "{}";

  // نحاول التحليل بأمان؛ أي خطأ يعيد null بدون كسر
  try {
    const j = JSON.parse(safeJson(raw, "{}"));
    // فلترة حقول فقط (تجنّب أي شيء غير متوقع)
    const out = {};
    if (j && typeof j === "object") {
      if (j.company && typeof j.company === "object") out.company = j.company;
      if (j.preferences && typeof j.preferences === "object") out.preferences = j.preferences;
      if (j.constraints && typeof j.constraints === "object") out.constraints = j.constraints;
      if (j.opportunities && typeof j.opportunities === "object") out.opportunities = j.opportunities;
      if (Array.isArray(j.updatedFields)) out.updatedFields = j.updatedFields;
    }
    // إن لم يوجد شيء مفيد، نعيد null
    if (!Object.keys(out).length) return null;
    return out;
  } catch {
    return null;
  }
}

function safeJson(s, fallback = "{}") {
  try { return s && s.trim().startsWith("{") ? s : fallback; }
  catch { return fallback; }
}

/* =======================================================================
   Gemini Power Add-on (Non-invasive)
   يفعّل: تعدد النماذج + تحكم كامل بالتكونات + إعادة المحاولة + تنسيق الردود
   — بدون إدخال نصوص جاهزة/قوالب للمستخدم —
   ======================================================================= */

import { GoogleGenerativeAI as __GGAI } from "@google/generative-ai";

/* 1) التحكم من البيئة */
const G9_MODELS = (process.env.G9_MODELS || [
  "gemini-1.5-pro",
  "gemini-1.5-pro-exp-0827",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b"
]).toString().split(",").map(s => s.trim()).filter(Boolean);

const G9_TEMP       = process.env.G9_TEMP;
const G9_TOP_K      = process.env.G9_TOP_K;
const G9_TOP_P      = process.env.G9_TOP_P;
const G9_MAX_TOKENS = process.env.G9_MAX_TOKENS;

// نُحدِّث إعدادات التوليد الحالية دون لمس مناداتك
try {
  if (G9_TEMP !== undefined)       generationConfig.temperature     = Number(G9_TEMP);
  if (G9_TOP_K !== undefined)      generationConfig.topK            = Number(G9_TOP_K);
  if (G9_TOP_P !== undefined)      generationConfig.topP            = Number(G9_TOP_P);
  if (G9_MAX_TOKENS !== undefined) generationConfig.maxOutputTokens = Number(G9_MAX_TOKENS);
} catch { /* تجاهل أخطاء التحويل */ }

/* 2) أدوات الوثوقية */
const __sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function __withRetry(fn, { tries = 2, baseDelay = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await __sleep(baseDelay * Math.pow(2, i)); }
  }
  throw lastErr;
}

/* 3) مُقيّم خفيف لاختيار أفضل مخرج — بلا فرض قالب */
function __score(text = "") {
  // معيار محايد: طول معقول + وجود تنظيم عام (نمطي) — لا يفرض صيغة
  const len = text.length;
  const lines = (text.match(/\n/g) || []).length;
  return (len * 0.0008) + (lines * 0.5);
}

/* 4) مُلمّع رقيق — لا يفرض عناوين ثابتة ولا يضيف نصًا جاهزًا */
function __polish(text = "") {
  if (!text) return text;
  // تنظيف فراغات متكررة فقط
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/* 5) Router غير تدخلي عبر Monkey-Patch للـ SDK */
const __origGet = __GGAI.prototype.getGenerativeModel;

__GGAI.prototype.getGenerativeModel = function patchedGetGenerativeModel(opts = {}) {
  const api = this;
  const baseModelId = (opts && opts.model) || "gemini-1.5-flash";

  if (!G9_MODELS || G9_MODELS.length <= 1) {
    return __origGet.call(api, opts);
  }

  return {
    async generateContent(payload) {
      const results = [];
      for (const mid of G9_MODELS) {
        const m = __origGet.call(api, { ...opts, model: mid, generationConfig });
        try {
          const r = await __withRetry(() => m.generateContent(payload), { tries: 2, baseDelay: 250 });
          const text = (r?.response && typeof r.response.text === "function") ? r.response.text() : "";
          if (text) results.push({ model: mid, text, score: __score(text) });
        } catch (e) {
          try { console.warn("⚠️ Model failed:", mid, e?.message || e); } catch {}
        }
      }

      if (results.length === 0) {
        const fallback = __origGet.call(api, { ...opts, model: baseModelId, generationConfig });
        const r = await __withRetry(() => fallback.generateContent(payload), { tries: 2, baseDelay: 300 });
        const text = (r?.response && typeof r.response.text === "function") ? r.response.text() : "";
        return { response: { text: () => __polish(text || "لم يصل رد من النموذج.") } };
      }

      results.sort((a, b) => b.score - a.score);
      const best = results[0];
      return { response: { text: () => __polish(best.text) } };
    }
  };
};

/* 6) تذكير بضبط البيئة (Netlify → Site settings → Environment)
   - G9_MODELS=gemini-1.5-pro,gemini-1.5-pro-exp-0827,gemini-1.5-flash,gemini-1.5-flash-8b
   - G9_MAX_TOKENS=8192  (أو الحد المدعوم لديك)
   - G9_TEMP=0.35
   - G9_TOP_K=64
   - G9_TOP_P=0.95
   - (اختياري) G9_EXTRACTOR_MODEL=gemini-1.5-pro
   - (اختياري) G9_EXTRACTOR_TEMP=0.1
   - (اختياري) G9_EXTRACTOR_TOKENS=512
*/
