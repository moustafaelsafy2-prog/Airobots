/*! @file netlify/functions/chat.js
 *  @version 1.1.0
 *  @updated 2025-09-24
 *  واجهة آمنة لـ Gemini مع تخصيص "الشخصية" وسياق الشركة + دعم مرفقات + كشف لغة المستخدم
 *  ملاحظة: تم دمج directives-loader لبناء توجيهات احترافية باللغة المطابقة للمستخدم
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { withCORS, jsonResponse, safeParse } from "./_utils.js";
/* جديد: استدعاء مُنشئ توجيهات الشخصيات */
import { buildPersonaPrompt } from "./directives-loader.js";

/** الموديل الافتراضي (قابل للتعديل عبر البيئة) */
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-1.5-flash";

/** إعدادات التوليد (تُضبط من الملحق بالأسفل إن وُجدت بيئة) */
const generationConfig = {
  temperature: 0.6,
  topK: 32,
  topP: 0.95,
  maxOutputTokens: 1024,
};

export const handler = withCORS(async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ Missing GEMINI_API_KEY");
    return jsonResponse(500, { error: "GEMINI_API_KEY is not configured" });
  }

  const {
    messages = [],
    persona = "",
    company = {},
    files = [],
    meta = {}       // اختياري: userId, locale, tz, channel, intent...
  } = safeParse(event.body, {});

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse(400, { error: "messages[] is required" });
  }

  /* 1) كشف لغة المستخدم من سجل الرسائل مع احترام meta.locale إن وُجد */
  const userLang = detectUserLanguage(messages, meta);
  /* 2) بناء توجيهات احترافية للشخصية من ملف ai-directives.json، مع ضبط اللغة */
  const personaPrompt = buildPersonaPrompt(persona, userLang);

  /** تكوين contents كما يريد Gemini:
   *  أدوار: "user" و "model" (نحوّل assistant => model)
   */
  const contents = [];

  // نبدأ برسالة تعريفية (موجزة) تُخبر النموذج بالسياق + اللغة المطلوبة
  contents.push({
    role: "user",
    parts: [{
      text:
        `${personaPrompt}\n` +
        `[REPLY_LANG:${userLang}]  \n` +
        `- استخدم نفس لغة المستخدم بالكامل في كل الردود (ar/en) اعتماداً على [REPLY_LANG].\n` +
        `- إذا بدّل المستخدم اللغة لاحقاً فبدّل فوراً بدون تذكير.\n`
    }],
  });

  // نضيف المحادثة السابقة
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

  // دعم مرفقات (inlineData)
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

    // === استدعاء أساسي (مع Router أدناه) ===
    const model = genAI.getGenerativeModel({ model: MODEL_ID, generationConfig });
    const result = await model.generateContent({ contents });
    const text =
      (result?.response && typeof result.response.text === "function"
        ? result.response.text()
        : null) || (userLang === "ar" ? "لم يصل رد من النموذج." : "No response from the model.");

    // === Auto-Profiler: استخراج ذاكرة منظّمة من الحوار (JSON فقط) ===
    let memoryPatch = null;
    try {
      memoryPatch = await autoProfileFromConversation(genAI, {
        messages,
        persona,
        company,
        meta: { ...meta, lang: userLang }
      });
    } catch (e) {
      try { console.warn("⚠️ AutoProfiler failed:", e?.message || e); } catch {}
    }

    return jsonResponse(200, { text, memoryPatch: memoryPatch || undefined });
  } catch (err) {
    const status = err?.status || err?.code || 500;
    const message =
      err?.message?.toString?.() ||
      (typeof err === "string" ? err : (userLang === "ar" ? "فشل طلب Gemini" : "Gemini request failed"));

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
        error: userLang === "ar" ? "فشل طلب Gemini" : "Gemini request failed",
        code: typeof status === "number" ? status : 500,
        details:
          process.env.NODE_ENV === "development" ? String(message) : undefined,
      }
    );
  }
});

/* =============================== Helpers =============================== */

/** كشف لغة المستخدم ببساطة:
 *  - أولوية meta.locale ("ar", "en", "ar-SA", "en-US"...)
 *  - وإلا فحص آخر رسائل المستخدم: إذا احتوت على أحرف عربية → "ar" وإلا "en"
 */
function detectUserLanguage(messages = [], meta = {}) {
  const loc = (meta?.locale || meta?.lang || "").toString().toLowerCase();
  if (loc.startsWith("ar")) return "ar";
  if (loc.startsWith("en")) return "en";

  // ابحث من آخر رسالة للمستخدم باتجاه البداية
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && typeof m?.text === "string" && m.text) {
      if (hasArabic(m.text)) return "ar";
      return "en";
    }
  }
  // افتراضي عربي لأن الواجهة عربية في الغالب
  return "ar";
}

function hasArabic(s = "") {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(s);
}

/* =============================== Auto-Profiler =============================== */

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
   تعدد النماذج + تحكم بيئي + إعادة المحاولة + تلميع خفيف للنص
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
const __sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function __withRetry(fn, { tries = 2, baseDelay = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await __sleep(baseDelay * Math.pow(2, i)); }
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

/* 5) Router غير تدخلي */
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
   - GEMINI_API_KEY=****** (مطلوب)
   - GEMINI_MODEL_ID=gemini-1.5-flash (اختياري)
   - G9_MODELS=gemini-1.5-pro,gemini-1.5-pro-exp-0827,gemini-1.5-flash,gemini-1.5-flash-8b
   - G9_MAX_TOKENS=8192
   - G9_TEMP=0.35
   - G9_TOP_K=64
   - G9_TOP_P=0.95
   - (اختياري) G9_EXTRACTOR_MODEL=gemini-1.5-pro
   - (اختياري) G9_EXTRACTOR_TEMP=0.1
   - (اختياري) G9_EXTRACTOR_TOKENS=512
*/
