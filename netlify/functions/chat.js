/*! @file netlify/functions/chat.js
 *  @version 1.1.0
 *  @updated 2025-09-24
 *  واجهة آمنة لـ Gemini مع:
 *   - تخصيص "الشخصية" وسياق الشركة
 *   - دمج توجيهات الخبراء من ai-directives.json عبر directives-loader.js
 *   - دعم مرفقات (inlineData)
 *   - Auto-Profiler لاستخلاص ذاكرة منظمة من الحوار
 *   - Router متعدد النماذج + إعادة المحاولة
 *   - كشف لغة المستخدم (عربي/إنجليزي) والرد بها تلقائياً
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { withCORS, jsonResponse, safeParse } from "./_utils.js";
import { buildPersonaPrompt } from "./directives-loader.js";

/** الموديل الافتراضي (يمكن تغييره من متغير بيئة) */
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-1.5-flash";

/** إعدادات التوليد (قابلة للضبط من البيئة) */
const generationConfig = {
  temperature: 0.6,
  topK: 32,
  topP: 0.95,
  maxOutputTokens: 1024,
};

/** أدوات مساعدة صغيرة */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function detectLangFromHeaders(headers = {}) {
  const raw = headers["accept-language"] || headers["Accept-Language"] || "";
  const h = String(raw).toLowerCase();
  if (/^ar\b|arabic|sa|eg|ae|ma|jo|kw|qa|bh|om/.test(h)) return "ar";
  if (/en\b|english/.test(h)) return "en";
  return "ar"; // افتراضي عربي لواجهة عربية
}
function coalesceLang(meta = {}, headers = {}) {
  const m = (meta.lang || meta.locale || "").toString().slice(0, 2).toLowerCase();
  if (m === "ar" || m === "en") return m;
  return detectLangFromHeaders(headers);
}
/** findLast polyfill بسيط لدعم بيئات Node أقدم */
function findLastUserTurn(contents) {
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i]?.role === "user") return contents[i];
  }
  return null;
}

/** المُعالج الرئيسي */
export const handler = withCORS(async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ Missing GEMINI_API_KEY");
    return jsonResponse(500, { error: "GEMINI_API_KEY is not configured" });
  }

  // نقرأ الـ payload بأمان
  const {
    messages = [],
    persona = "",
    company = {},
    files = [],
    meta = {}
  } = safeParse(event.body, {});

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse(400, { error: "messages[] is required" });
  }

  // تحديد اللغة (ar/en) من meta أو من ترويسة المتصفح
  const lang = coalesceLang(meta, event.headers || {});
  const enrichedMeta = { ...meta, lang };

  // بناء "طبقة التوجيهات الاحترافية" من ai-directives.json
  // هذه الطبقة تجعل كل روبوت يتصرف كخبير، ويبدأ بحوار استقصائي قبل الحل.
  const expertDirectives = buildPersonaPrompt(persona || "مستشار", lang);

  // بناء System Prompt موجز (وسم حالة فقط)، ثم نضيف expertDirectives كمحفّز أعلى الحوار
  const systemPrompt = buildSystemHint(persona, company, enrichedMeta);

  // تحويل الرسائل لصيغة Gemini (roles: user/model)
  const contents = [];

  // (1) نضيف "hints" النظامية الصغيرة كمستخدم
  contents.push({ role: "user", parts: [{ text: systemPrompt }] });

  // (2) نضيف "توجيهات الخبراء" المستخرجة من ai-directives.json
  contents.push({ role: "user", parts: [{ text: expertDirectives }] });

  // (3) باقي سجل المحادثة مع الحفاظ على الأدوار
  for (const m of messages) {
    const role = m?.role === "assistant" ? "model" : "user";
    const text = typeof m?.text === "string" ? m.text : "";
    if (!text) continue;

    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text });
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  // (4) دعم المرفقات (inlineData) — تُلحق بآخر دور "user"
  if (Array.isArray(files) && files.length) {
    let target = findLastUserTurn(contents);
    if (!target) {
      target = { role: "user", parts: [] };
      contents.push(target);
    }
    for (const f of files) {
      if (f?.mime && f?.base64) {
        target.parts.push({ inlineData: { data: f.base64, mimeType: f.mime } });
      }
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // === (أ) استدعاء الدردشة الأساسي (مع Router أسفل الملف) ===
    const model = genAI.getGenerativeModel({ model: MODEL_ID, generationConfig });
    const result = await model.generateContent({ contents });
    const text =
      (result?.response && typeof result.response.text === "function"
        ? result.response.text()
        : null) || (lang === "ar" ? "لم يصل رد من النموذج." : "No response from the model.");

    // === (ب) Auto-Profiler لاستخراج patch من الحوار (JSON منظم) ===
    let memoryPatch = null;
    try {
      memoryPatch = await autoProfileFromConversation(genAI, {
        messages,
        persona,
        company,
        meta: enrichedMeta
      });
    } catch (e) {
      try { console.warn("⚠️ AutoProfiler failed:", e?.message || e); } catch {}
    }

    return jsonResponse(200, { text, memoryPatch: memoryPatch || undefined });
  } catch (err) {
    const status = err?.status || err?.code || 500;
    const message =
      err?.message?.toString?.() ||
      (typeof err === "string" ? err : "Gemini request failed");

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
        error: lang === "ar" ? "فشل طلب Gemini" : "Gemini request failed",
        code: typeof status === "number" ? status : 500,
        details:
          process.env.NODE_ENV === "development" ? String(message) : undefined,
      }
    );
  }
});

/** System hint صغير جداً: لا يفرض قوالب؛ يوسم السياق فقط */
function buildSystemHint(persona = "", company = {}, meta = {}) {
  const lang = meta?.lang || "ar";
  const channel = meta?.channel ? `@${meta.channel}` : "";
  const p = persona ? `(${persona})` : "";
  const orgHint = company && Object.keys(company).length ? `|org` : "";
  // تلميح موجز للنموذج كي يفهم السياق (لغة/قناة/شخصية/وجود شركة)
  return `[context:${lang}${channel}] [mode:advisor${p}${orgHint}]`;
}

/* =============================== Auto-Profiler ===============================
   يستنتج "ذاكرة" منظمة من الحوار نفسه ويعيد patch آمن.
   لا يضيف نصوص جاهزة للمستخدم — JSON فقط.
   -------------------------------------------------------------------------- */
async function autoProfileFromConversation(genAI, { messages = [], persona = "", company = {}, meta = {} }) {
  const N = 16;
  const recent = messages.slice(-N).map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.text || "") }]
  }));

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
    want: {
      company: ["name","industry","size","audience","goals","region","currency"],
      preferences: ["tone","lang","reporting","units"],
      constraints: ["budget","deadline","compliance"],
      opportunities: ["quickWins","channels","segments"],
      updatedFields: []
    }
  };

  const req = [
    { role: "user", parts: [{ text: "[extract-structured-profile-json]" }] },
    ...recent,
    { role: "user", parts: [{ text: JSON.stringify({ persona, meta, schemaHint }) }] }
  ];

  const r = await extractor.generateContent({ contents: req });
  const raw = (r?.response && typeof r.response.text === "function") ? r.response.text() : "{}";

  try {
    const j = JSON.parse(safeJson(raw, "{}"));
    const out = {};
    if (j && typeof j === "object") {
      if (j.company && typeof j.company === "object") out.company = j.company;
      if (j.preferences && typeof j.preferences === "object") out.preferences = j.preferences;
      if (j.constraints && typeof j.constraints === "object") out.constraints = j.constraints;
      if (j.opportunities && typeof j.opportunities === "object") out.opportunities = j.opportunities;
      if (Array.isArray(j.updatedFields)) out.updatedFields = j.updatedFields;
    }
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
   Router متعدد النماذج + تحكم بالتكونات + إعادة المحاولة + تلميع خفيف
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

try {
  if (G9_TEMP !== undefined)       generationConfig.temperature     = Number(G9_TEMP);
  if (G9_TOP_K !== undefined)      generationConfig.topK            = Number(G9_TOP_K);
  if (G9_TOP_P !== undefined)      generationConfig.topP            = Number(G9_TOP_P);
  if (G9_MAX_TOKENS !== undefined) generationConfig.maxOutputTokens = Number(G9_MAX_TOKENS);
} catch { /* تجاهل أخطاء التحويل */ }

/* 2) أدوات الوثوقية */
async function __withRetry(fn, { tries = 2, baseDelay = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await sleep(baseDelay * Math.pow(2, i)); }
  }
  throw lastErr;
}

/* 3) مُقيّم خفيف لاختيار أفضل مخرج */
function __score(text = "") {
  const len = text.length;
  const lines = (text.match(/\n/g) || []).length;
  return (len * 0.0008) + (lines * 0.5);
}

/* 4) مُلمّع رقيق */
function __polish(text = "") {
  if (!text) return text;
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/* 5) Router عبر Monkey-Patch للـ SDK */
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

/* 6) تذكير ضبط البيئة (Netlify → Site settings → Environment)
   - GEMINI_API_KEY=<your key>
   - GEMINI_MODEL_ID=gemini-1.5-flash            (اختياري)
   - G9_MODELS=gemini-1.5-pro,gemini-1.5-flash   (اختياري)
   - G9_MAX_TOKENS=4096                          (أو حسب الحد)
   - G9_TEMP=0.35
   - G9_TOP_K=64
   - G9_TOP_P=0.95
   - (اختياري) G9_EXTRACTOR_MODEL=gemini-1.5-pro
   - (اختياري) G9_EXTRACTOR_TEMP=0.1
   - (اختياري) G9_EXTRACTOR_TOKENS=512
*/
