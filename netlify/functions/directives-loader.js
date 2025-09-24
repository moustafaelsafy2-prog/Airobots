/**
 * @file directives-loader.js
 * @purpose تحميل ودمج توجيهات الذكاء الاصطناعي (ai-directives.json) باحترافية
 *          + دعم ثنائي اللغة (AR/EN) تلقائي بحسب لغة المستخدم
 *          + حوار استقصائي عميق يجعل كل روبوت خبيراً يتناقش قبل الحل
 *
 * يعتمد على وجود ملف JSON بالجذر باسم: ai-directives.json
 * البنية المتوقعة:
 * {
 *   "default": {
 *     "tone": "مهني/استشاري",
 *     "style": ["واضح","مباشر"],
 *     "constraints": ["لا تطيل بلا قيمة"],
 *     "output": { "structure": ["تشخيص","أسئلة","خطة","KPIs","مخاطر"] }
 *   },
 *   "personas": {
 *     "ألفا (Alfa)": {
 *       "aliases": ["Alfa","alpha","الفا"],
 *       "tone": "خبير تسويق تحويلي",
 *       "style": ["مقنع","Data-driven"],
 *       "constraints": ["اربط كل توصية بهدف قابل للقياس"],
 *       "output": { "kpis": ["CTR","CPA","ROAS"] }
 *     }
 *   }
 * }
 */

import fs from "fs";
import path from "path";
import { jsonResponse } from "./_utils.js";

const DIRECTIVES_PATH = path.resolve("ai-directives.json");

// ==================== كاش + مراقبة تعديلات الملف ====================
let __cache = { payload: null, mtimeMs: 0 };

function safeStatMTimeMs(p) {
  try { return (fs.statSync(p).mtimeMs || 0); } catch { return 0; }
}

function safeReadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch (e) {
    console.error("❌ فشل قراءة/تحليل ai-directives.json:", e.message);
    return null;
  }
}

function normalizeSchema(obj) {
  const out = {
    default: (obj && typeof obj.default === "object" && !Array.isArray(obj.default)) ? obj.default : {},
    personas: (obj && typeof obj.personas === "object" && !Array.isArray(obj.personas)) ? obj.personas : {},
  };

  // personas: تأكيد أنواع الحقول
  for (const k of Object.keys(out.personas)) {
    const p = out.personas[k] || {};
    if (p.aliases && !Array.isArray(p.aliases)) p.aliases = [String(p.aliases)];
    if (!p.aliases) p.aliases = [];
    ["style", "constraints"].forEach((key) => {
      if (p[key] && !Array.isArray(p[key])) p[key] = [String(p[key])];
    });
  }

  // default: قوائم سليمة
  ["style", "constraints"].forEach((key) => {
    if (out.default[key] && !Array.isArray(out.default[key])) {
      out.default[key] = [String(out.default[key])];
    }
  });

  return out;
}

function loadDirectives() {
  const now = safeStatMTimeMs(DIRECTIVES_PATH);
  if (__cache.payload && __cache.mtimeMs === now) return __cache.payload;
  const json = safeReadJSON(DIRECTIVES_PATH) || { default: {}, personas: {} };
  const normalized = normalizeSchema(json);
  __cache = { payload: normalized, mtimeMs: now };
  return normalized;
}

// ==================== أدوات مساعدة ====================
function isPlainObject(x) { return x && typeof x === "object" && !Array.isArray(x); }

function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const set = new Set([...a.map(String), ...b.map(String)]);
    return Array.from(set);
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const out = { ...a };
    for (const k of Object.keys(b)) {
      out[k] = (k in out) ? deepMerge(out[k], b[k]) : b[k];
    }
    return out;
  }
  return (b === undefined ? a : b);
}

function resolvePersona(personaName = "") {
  const data = loadDirectives();
  const personas = data.personas || {};
  if (!personaName) return { key: "", conf: {} };

  const n = String(personaName).trim().toLowerCase();

  // مطابقة مباشرة
  for (const key of Object.keys(personas)) {
    if (key.trim().toLowerCase() === n) return { key, conf: personas[key] || {} };
  }
  // مرادفات
  for (const key of Object.keys(personas)) {
    const p = personas[key] || {};
    const aliases = Array.isArray(p.aliases) ? p.aliases : [];
    if (aliases.map(s => String(s).trim().toLowerCase()).includes(n)) {
      return { key, conf: p };
    }
  }
  return { key: personaName, conf: {} };
}

function mdList(arr, bullet = "-") {
  if (!arr || !arr.length) return "- لا شيء.";
  return arr.map((v) => `${bullet} ${String(v)}`).join("\n");
}

function renderKPIs(merged) {
  const kpis = merged?.output?.kpis;
  if (!Array.isArray(kpis) || !kpis.length) return "";
  return `
[KPIs]
${mdList(kpis)}
`.trim();
}

// ==================== كشف لغة المستخدم (AR/EN) ====================
/**
 * يحاول تخمين لغة المستخدم من نصّه:
 * - وجود أحرف عربية → "ar"
 * - وجود أحرف لاتينية + غياب العربية → "en"
 * - مزج اللغتين → "mix" (نردّ بنفس لغة آخر جملة/أغلب المحتوى)
 */
function detectLangFromText(text = "") {
  const t = String(text || "");
  const hasArabic = /[\u0600-\u06FF]/.test(t);
  const hasLatin  = /[A-Za-z]/.test(t);
  if (hasArabic && !hasLatin) return "ar";
  if (!hasArabic && hasLatin) return "en";
  if (hasArabic && hasLatin) return "mix";
  return "ar"; // افتراضي
}

/** يختار لغة نهائية باستخدام سياسة واضحة */
function resolveLang({ explicitLang = "auto", userText = "" } = {}) {
  if (explicitLang && explicitLang !== "auto") {
    return explicitLang.toLowerCase().startsWith("en") ? "en" : "ar";
  }
  const d = detectLangFromText(userText);
  if (d === "mix") {
    // قاعدة بسيطة: إن كانت الأحرف العربية > اللاتينية → "ar" وإلا "en"
    const arCount = (userText.match(/[\u0600-\u06FF]/g) || []).length;
    const enCount = (userText.match(/[A-Za-z]/g) || []).length;
    return arCount >= enCount ? "ar" : "en";
  }
  return d; // "ar" أو "en"
}

// ==================== بناء برومبت ثنائي اللغة ====================
/**
 * @param {string} personaName - اسم الروبوت/الشخصية
 * @param {string} lang - "ar" | "en" | "auto"
 * @param {object} options - { userText?: string, minQuestions?: number, maxFollowups?: number }
 * ملاحظة: الإبقاء على التوافق مع التوقيع القديم: lang كان "ar" افتراضياً.
 * الآن يمكنك تمرير "auto" + userText لالتقاط اللغة تلقائياً.
 */
export function buildPersonaPrompt(personaName = "", lang = "ar", options = {}) {
  const userText = options.userText || "";
  const finalLang = resolveLang({ explicitLang: lang, userText });

  const data = loadDirectives();
  const { key: resolvedName, conf: personaConf } = resolvePersona(personaName);
  const defaults = data.default || {};
  const merged = deepMerge(defaults, personaConf || {});

  const tone = merged.tone || (finalLang === "en" ? "Professional/Consultative" : "مهني/استشاري");
  const style = merged.style || [];
  const constraints = merged.constraints || [];
  const minQuestions = Math.max(2, Number(options.minQuestions || 3));
  const maxFollowups = Math.max(minQuestions, Number(options.maxFollowups || 6));
  const outputStructure = merged?.output?.structure || (
    finalLang === "en"
      ? ["Quick diagnosis", `Clarifying questions (${minQuestions}-${maxFollowups})`, "Step-by-step plan", "Success KPIs", "Risks & mitigations", "Shareable executive summary"]
      : ["تشخيص سريع", `أسئلة توضيحية (${minQuestions}-${maxFollowups})`, "خطة تنفيذية مرقّمة", "مؤشرات نجاح (KPIs)", "المخاطر والمعالجات", "ملخص تنفيذي قابل للمشاركة"]
  );

  const styleBlock = style.length
    ? (finalLang === "en" ? `[Reply Style]\n${mdList(style)}` : `[أسلوب الرد]\n${mdList(style)}`)
    : "";

  const constraintsBlock = constraints.length
    ? (finalLang === "en" ? `[Hard Constraints]\n${mdList(constraints)}` : `[قيود إلزامية]\n${mdList(constraints)}`)
    : (finalLang === "en"
        ? `[Hard Constraints]
- Avoid generic/fluffy language.
- Do not parrot the user; always add value.
- Every recommendation must be actionable & measurable.
- Do not deliver a final plan before collecting core requirements.`
        : `[قيود إلزامية]
- لا تستخدم لغة عامة أو فضفاضة.
- لا تكرر ما قاله المستخدم بلا إضافة.
- كل توصية يجب أن تكون قابلة للتنفيذ ويمكن قياسها.
- لا تعطي خطة نهائية قبل جمع المعطيات الأساسية.`);

  const kpisBlock = renderKPIs(merged);
  const langHeader = finalLang === "en" ? "[LANG: en]" : "[LANG: ar]";
  const toneHeader = `[TONE: ${tone}]`;
  const roleHeader = finalLang === "en"
    ? `[ROLE: Senior Expert "${resolvedName || personaName || "Consultant"}"]`
    : `[ROLE: خبير محترف "${resolvedName || personaName || "مستشار"}"]`;

  // طبقة الحوار الاستقصائي (بالعربية/الإنجليزية)
  const convoLayer = finalLang === "en"
    ? `
[Investigative Dialogue Mode]
- Start with (${minQuestions}–${maxFollowups}) smart clarifying questions covering: goal(s), audience/segments, resources, time/budget constraints, available data, success criteria.
- Do NOT present a full solution until you have enough context; if answers are incomplete, ask precisely for missing pieces.
- Once context is sufficient, deliver a practical, context-aware plan with examples, formulas, and measurement guidelines when needed.`
    : `
[وضع الحوار الاستقصائي]
- ابدأ بـ (${minQuestions}-${maxFollowups}) أسئلة توضيحية ذكية تغطي: الأهداف، الشرائح/الجمهور، الموارد، القيود الزمنية/الميزانية، البيانات المتاحة، معايير النجاح.
- لا تقدّم حلاً كاملاً حتى يكتمل السياق؛ إن كانت الإجابات ناقصة فاطلب بدقة ما ينقص.
- عند اكتمال الصورة، قدّم خطة عملية مبنية على السياق، مع أمثلة وصيغ/معادلات وطرق قياس حيث يلزم.`;

  // سياسة اللغة للمزج/التبديل الذكي إذا احتاج المستخدم
  const langPolicy = finalLang === "en"
    ? `[Language Policy]
- Reply in English if the user uses English.
- If the user mixes English & Arabic, prefer the user's dominant language; mirror key terms as the user wrote them (e.g., product names, acronyms).
- If the user explicitly asks for Arabic, switch to Arabic.`
    : `[سياسة اللغة]
- رُد بالعربية إن كتب المستخدم بالعربية.
- عند المزج بين العربية والإنجليزية، استخدم اللغة الغالبة عند المستخدم، واحتفظ بالمصطلحات كما كتبها (أسماء المنتجات، الاختصارات).
- إن طلب المستخدم الإنجليزية صراحةً، تحوّل فوراً إلى الإنجليزية.`;

  // ملاحظات تنفيذية قصيرة – تُظهر “احترافية” ونتائج قابلة للقياس
  const execNotes = finalLang === "en"
    ? `[Execution Notes]
- When proposing tools/channels/A-B tests: explain WHY, HOW to measure, and expected impact briefly.
- Include time-bound, role-owned steps (e.g., "Marketing Lead – Week 1: …").
- Offer "Pre-flight checks" and "Fallback plan" where relevant.`
    : `[ملاحظات تنفيذية]
- عند اقتراح أدوات/قنوات/اختبارات A/B: اشرح لماذا، وكيف يُقاس النجاح، والأثر المتوقع باختصار.
- اجعل الخطوات محددة بزمن ومسؤولية (مثال: "قائد التسويق — الأسبوع 1: …").
- أضف "فحوص ما قبل التنفيذ" و"خطة طوارئ" عند الحاجة.`;

  return `
${langHeader}
${toneHeader}
${roleHeader}

${styleBlock}

${langPolicy}

${convoLayer}

${constraintsBlock}

${kpisBlock ? "\n" + kpisBlock + "\n" : ""}

${finalLang === "en" ? "[Required Output Structure]" : "[هيكل الإخراج الإلزامي]"}
${mdList(outputStructure)}

${execNotes}
`.trim();
}

// ==================== HTTP Preview (اختياري للفحص) ====================
/**
 * GET /.netlify/functions/directives-loader
 * أمثلة:
 *   - عرض الأسماء:          /directives-loader
 *   - معاينة برومبت:        /directives-loader?persona=ألفا%20(Alfa)&preview=1
 *   - معاينة مع لغة تلقائية: /directives-loader?persona=Alfa&preview=1&lang=auto&user=اعمل حملة مبيعات لمنتج جديد
 */
export const handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  try {
    const data = loadDirectives();
    const personas = Object.keys(data.personas || {});
    const hasDefault = !!data.default && Object.keys(data.default).length > 0;

    const url = new URL(event.rawUrl || `http://x${event.path}`);
    const persona = url.searchParams.get("persona") || "";
    const lang = (url.searchParams.get("lang") || "ar").toLowerCase(); // "ar" | "en" | "auto"
    const preview = url.searchParams.get("preview");
    const userText = url.searchParams.get("user") || "";

    if (preview && persona) {
      const prompt = buildPersonaPrompt(persona, lang, { userText });
      const resolvedLang = resolveLang({ explicitLang: lang, userText });
      return jsonResponse(200, {
        personaResolved: resolvePersona(persona).key,
        langRequested: lang,
        langResolved: resolvedLang,
        prompt,
      });
    }

    return jsonResponse(200, {
      personas,
      hasDefault,
      tips: {
        preview_ar: "أرسل ?persona=اسم_الشخصية&preview=1&lang=auto&user=نص_المستخدم لمعاينة البرومبت المدمج",
        preview_en: "Send ?persona=PersonaName&preview=1&lang=auto&user=Your%20message to preview merged prompt",
      },
    });
  } catch (e) {
    console.error("❌ directives-loader handler error:", e);
    return jsonResponse(500, { error: "Internal Error" });
  }
};
