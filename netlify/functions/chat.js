/*! @file netlify/functions/chat.js
 *  @version 2.0.0
 *  @updated 2025-09-24
 *  واجهة آمنة لـ Gemini مع شخصية موجهة + ذاكرة تلقائية + دعم مرفقات (صور/ملفات) + كشف لغة
 *  تحسينات هذا الإصدار: تعدد النماذج الذكي، إعادة المحاولة 3 مرات، زمن انتظار أعلى، مخرجات أطول (8192 توكن)، تلميع أفضل.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { withCORS, jsonResponse, safeParse } from "./_utils.js";
import { buildPersonaPrompt } from "./directives-loader.js";

/** الموديل الافتراضي (قابل للتعديل عبر البيئة) */
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-1.5-flash";

/** إعدادات التوليد (يمكن ضبطها من البيئة) */
const generationConfig = {
  temperature: Number(process.env.G9_TEMP ?? 0.35),
  topK: Number(process.env.G9_TOP_K ?? 64),
  topP: Number(process.env.G9_TOP_P ?? 0.95),
  maxOutputTokens: Number(process.env.G9_MAX_TOKENS ?? 8192),
};

/** مصفوفة نماذج لمحرك الاختيار الذكي */
const G9_MODELS = (process.env.G9_MODELS || [
  "gemini-1.5-pro",
  "gemini-1.5-pro-exp-0827",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
]).toString().split(",").map(s => s.trim()).filter(Boolean);

/* أدوات الوثوقية */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function withRetry(fn, { tries = 3, baseDelay = 300 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await sleep(baseDelay * Math.pow(2, i)); }
  }
  throw lastErr;
}

/* تقييم بسيط لاختيار أفضل مخرج بين النماذج */
function score(text = "") {
  const len = text.length;
  const lines = (text.match(/\n/g) || []).length;
  // وزن طفيف للطول + السطور (يميل إلى الردود الأكثر ثراء وتنظيماً)
  return (len * 0.0008) + (lines * 0.5);
}

/* مُلمّع رقيق للمخرجات */
function polish(text = "") {
  if (!text) return text;
  // دمج الفراغات وترك سطرين كحد أقصى بين الفقرات
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/* =============================== Handlers =============================== */

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
    meta = {},  // userId, locale, tz, channel, intent...
  } = safeParse(event.body, {});

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse(400, { error: "messages[] is required" });
  }

  // 1) كشف لغة المستخدم
  const userLang = detectUserLanguage(messages, meta);

  // 2) بناء توجيهات احترافية للشخصية من ai-directives.json
  const personaPrompt = buildPersonaPrompt(persona, userLang);

  // 3) تحويل المحادثة إلى contents كما يتوقع Gemini
  const contents = [];

  // مقدمة ملزمة للسلوك واللغة
  contents.push({
    role: "user",
    parts: [{
      text:
        `${personaPrompt}\n` +
        `[REPLY_LANG:${userLang}]  \n` +
        `- استخدم نفس لغة المستخدم بالكامل (ar/en) وفق [REPLY_LANG].\n` +
        `- التزم بالقواعد الصلبة (hard_rules) والأسئلة الاستقصائية أولاً عند الحاجة.\n` +
        `- اربط التوصيات بمؤشرات قياس قابلة للتتبع.\n`
    }],
  });

  // نسخ الرسائل السابقة (تحويل assistant => model)
  for (const m of messages) {
    const role = m?.role === "assistant" ? "model" : "user";
    const text = typeof m?.text === "string" ? m.text : "";
    if (!text) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push({ text });
    else contents.push({ role, parts: [{ text }] });
  }

  // دعم مرفقات (صور/ملفات) كـ inlineData
  if (Array.isArray(files) && files.length) {
    let target = contents.findLast?.(c => c.role === "user");
    if (!target) { target = { role: "user", parts: [] }; contents.push(target); }
    for (const f of files) {
      if (f?.mime && f?.base64) {
        target.parts.push({ inlineData: { data: f.base64, mimeType: f.mime } });
      }
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // ===== Router: جرّب عدة نماذج واختر الأفضل =====
    const results = [];
    for (const mid of G9_MODELS.length ? G9_MODELS : [MODEL_ID]) {
      const model = genAI.getGenerativeModel({ model: mid, generationConfig });
      try {
        const r = await withRetry(() => model.generateContent({ contents }), { tries: 3, baseDelay: 300 });
        const candidate = (r?.response && typeof r.response.text === "function") ? r.response.text() : "";
        if (candidate) results.push({ model: mid, text: candidate, score: score(candidate) });
      } catch (e) {
        try { console.warn("⚠️ Model failed:", mid, e?.message || e); } catch {}
      }
    }

    let text;
    if (results.length === 0) {
      // محاولة أخيرة بالموديل الأساسي
      const fallback = genAI.getGenerativeModel({ model: MODEL_ID, generationConfig });
      const r = await withRetry(() => fallback.generateContent({ contents }), { tries: 3, baseDelay: 400 });
      text = (r?.response && typeof r.response.text === "function") ? r.response.text() : "";
    } else {
      results.sort((a, b) => b.score - a.score);
      text = results[0].text;
    }

    text = polish(text || (userLang === "ar" ? "لم يصل رد من النموذج." : "No response from the model."));

    // === Auto-Profiler: استخراج ذاكرة منظمة من الحوار (JSON فقط) ===
    let memoryPatch = null;
    try {
      memoryPatch = await autoProfileFromConversation(genAI, {
        messages, persona, company, meta: { ...meta, lang: userLang }
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
        details: process.env.NODE_ENV === "development" ? String(message) : undefined,
      }
    );
  }
});

/* =============================== Helpers =============================== */

/** كشف لغة المستخدم:
 *  - أولوية meta.locale (ar/en)
 *  - وإلا نفحص آخر رسالة للمستخدم: حروف عربية => "ar" وإلا "en"
 */
function detectUserLanguage(messages = [], meta = {}) {
  const loc = (meta?.locale || meta?.lang || "").toString().toLowerCase();
  if (loc.startsWith("ar")) return "ar";
  if (loc.startsWith("en")) return "en";

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && typeof m?.text === "string" && m.text) {
      if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(m.text)) return "ar";
      return "en";
    }
  }
  return "ar";
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
