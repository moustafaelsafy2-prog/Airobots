/**
 * @file netlify/functions/directives-loader.js
 * @version 2.1.0
 * @desc تحميل ودمج توجيهات الذكاء الاصطناعي (public/ai-directives.json)
 *       وبناء موجه "خبير استشاري" ثنائي اللغة (AR/EN) مع حوار استقصائي ذكي.
 *
 * ملاحظات:
 * - يعتمد على _utils.js (jsonResponse) فقط، بدون تغيير أي ملفات أخرى.
 * - يدعم كشف اللغة تلقائيًا من رسالة المستخدم، أو إجبار لغة عبر باراميتر lang.
 * - يستخدم كاش داخلي مع التحقق من mtime لتفادي إعادة القراءة غير الضرورية.
 */

import fs from "fs";
import path from "path";
import { jsonResponse } from "./_utils.js";

/* ========================= إعدادات عامة ========================= */

const DIRECTIVES_PATH = path.resolve(process.cwd(), "public/ai-directives.json");

let _cached = {
  data: null,
  mtimeMs: 0
};

/* ========================= أدوات مساعدة ========================= */

/** كشف لغة المستخدم ببساطة: عرب/إنجليزي */
function detectLang(input = "") {
  if (typeof input !== "string") return "ar";
  // أي حرف عربي
  if (/[؀-ۿ]/.test(input)) return "ar";
  // أي حروف لاتينية تعطي EN
  if (/[A-Za-z]/.test(input)) return "en";
  // افتراضي عربي
  return "ar";
}

/** تنظيف نص آمن وبسيط */
function clean(s = "") {
  return String(s || "")
    .replace(/\s{3,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** قراءة وتخزين في كاش مع مراقبة mtime */
function loadDirectives() {
  try {
    const stat = fs.statSync(DIRECTIVES_PATH);
    if (_cached.data && stat.mtimeMs === _cached.mtimeMs) {
      return _cached.data;
    }
    const raw = fs.readFileSync(DIRECTIVES_PATH, "utf-8");
    const json = JSON.parse(raw);
    _cached = { data: json, mtimeMs: stat.mtimeMs };
    return json;
  } catch (e) {
    console.error("❌ فشل تحميل public/ai-directives.json:", e?.message || e);
    return { default: {}, personas: {} };
  }
}

/** دمج عميق خفيف (يُبقي قيم persona فوق default) */
function mergeDeep(base = {}, override = {}) {
  const out = { ...base };
  for (const k of Object.keys(override || {})) {
    const v = override[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = mergeDeep(out[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* ========================= بناء الموجه ========================= */

/**
 * يبني موجه "خبير محترف" ثنائي اللغة، يطبّق:
 * - الحوار الاستقصائي أولًا
 * - الالتزام بالنبرة والقيود من ai-directives.json
 * - مطابقة لغة الرد للغة المستخدم
 *
 * @param {string} personaName  اسم الشخصية (كما في ai-directives.json)
 * @param {string} langHint     تلميح لغة اختياري ("ar" | "en")
 * @param {object} opts         { userText?: string, channel?: string }
 * @returns {string}            نص موجه موجز وقوي
 */
export function buildPersonaPrompt(personaName = "", langHint = "ar", opts = {}) {
  const { userText = "", channel = "" } = opts || {};
  const data = loadDirectives();

  const defaults = data?.default || {};
  const personaNode = (data?.personas && data.personas[personaName]) || {};
  const merged = mergeDeep(defaults, personaNode);

  // تحديد اللغة النهائية: langHint > كشف من userText > "ar"
  const finalLang = (langHint || "").match(/^(ar|en)$/i)
    ? langHint.toLowerCase()
    : detectLang(userText);

  // النبرة والقيود
  const tone = merged.tone || (finalLang === "ar" ? "مهني/استشاري" : "Professional/Advisory");
  const hardRules = Array.isArray(merged.hard_rules) ? merged.hard_rules : [];

  // عنوان الدور
  const title =
    finalLang === "ar"
      ? `خبير محترف "${personaName || "مستشار"}"`
      : `Expert Consultant "${personaName || "Advisor"}"`;

  // طبقة الحوار الاستقصائي (مختصرة، موجّهة، بلا قوالب مطوّلة)
  const probingLayerAr = `
[الدور: ${title}]
- تحاور أولاً: اسأل أسئلة دقيقة لفهم الهدف، الفئة المستهدفة، الموارد، القيود، والمدة.
- لا تقدّم خطة نهائية قبل اكتمال الصورة.
- تصرّف كخبير: عملي، دقيق، مباشر، واقعي.
- إن كان السياق ناقصًا: اسأل أسئلة متابعة موجهة.
- بعد جمع المعلومات: قدّم خطة تنفيذية بخطوات مرقمة + مؤشرات قياس + مخاطر وتخفيفها.
- التزم بعدم الإطالة أو العموميات؛ كل جملة لها غرض واضح.
`.trim();

  const probingLayerEn = `
[ROLE: ${title}]
- Start with probing: ask precise questions to understand objective, target audience, resources, constraints, and timeline.
- Don't provide a final plan until the picture is complete.
- Act as a domain expert: practical, precise, direct, and realistic.
- If context is incomplete, ask targeted follow-ups.
- After collecting details, deliver an execution plan with numbered steps + KPIs + risks & mitigations.
- Avoid fluff; every sentence should add value.
`.trim();

  // القيود الصارمة من الملف (إن وجدت)
  const rulesBlockAr = hardRules.length
    ? `\n[قيود صارمة]\n- ${hardRules.join("\n- ")}\n`
    : "";

  const rulesBlockEn = hardRules.length
    ? `\n[HARD RULES]\n- ${hardRules.join("\n- ")}\n`
    : "";

  const langHeaderAr = `[LANG: ar]${channel ? ` [CHANNEL: ${channel}]` : ""}\n[TONE: ${tone}]`;
  const langHeaderEn = `[LANG: en]${channel ? ` [CHANNEL: ${channel}]` : ""}\n[TONE: ${tone}]`;

  const baseAr = `
${langHeaderAr}

${probingLayerAr}
${rulesBlockAr}

[التزام اللغة]
- إذا كتب المستخدم بالعربية فاجبه بالعربية. إذا كتب بالإنجليزية فاجبه بالإنجليزية.
- في حال تبدّلت لغة المستخدم أثناء الحوار، بدّل ردك لمطابقة لغته فورًا.
`.trim();

  const baseEn = `
${langHeaderEn}

${probingLayerEn}
${rulesBlockEn}

[Language adherence]
- If the user writes in Arabic, reply in Arabic. If they write in English, reply in English.
- If the user switches language mid-conversation, switch your reply to match them immediately.
`.trim();

  return clean(finalLang === "ar" ? baseAr : baseEn);
}

/* ========================= Netlify Handler =========================
   GET /.netlify/functions/directives-loader
   - بدون تعديل أي ملفات أخرى.
   - يدعم استعراض سريع: ?persona=..&lang=..&q=.. (اختياري)
   ================================================================== */

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return jsonResponse(405, { error: "Method Not Allowed" });
    }

    const data = loadDirectives();
    const personas = Object.keys(data?.personas || {});
    const defaults = data?.default || {};

    // معاينة اختيارية للموجه النهائي:
    const url = new URL(event.rawUrl || `http://x.local${event.path}${event.queryString || ""}`);
    const persona = url.searchParams.get("persona") || "";
    const lang = url.searchParams.get("lang") || "";
    const q = url.searchParams.get("q") || ""; // نص المستخدم (لاختبار كشف اللغة)

    const samplePrompt = buildPersonaPrompt(persona, lang, { userText: q });

    return jsonResponse(200, {
      personas,
      defaults,
      preview: {
        persona,
        lang: lang || detectLang(q) || "ar",
        prompt: samplePrompt
      }
    });
  } catch (e) {
    console.error("❌ directives-loader error:", e?.message || e);
    return jsonResponse(500, { error: "Internal Server Error" });
  }
};
