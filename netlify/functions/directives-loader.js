/*! @file netlify/functions/directives-loader.js
 *  @version 2.0.0
 *  يبني توجيه شخصية (Persona Prompt) ديناميكياً من ai-directives.json مع احترام اللغة والقواعد الصلبة
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedDirectives = null;

function loadDirectives() {
  if (cachedDirectives) return cachedDirectives;
  // المسار النسبي من ملف النتلايفي فانكشن إلى ai-directives.json في جذر المشروع
  const p = path.resolve(__dirname, "../ai-directives.json"); // عدّل المسار إذا كان الملف في مكان مختلف
  const fallback = path.resolve(__dirname, "../../ai-directives.json");
  let jsonStr = null;

  try { jsonStr = fs.readFileSync(p, "utf-8"); }
  catch {
    try { jsonStr = fs.readFileSync(fallback, "utf-8"); }
    catch { jsonStr = "{}"; }
  }

  try { cachedDirectives = JSON.parse(jsonStr); }
  catch { cachedDirectives = { version: "0", default: {}, personas: {} }; }
  return cachedDirectives;
}

function ensureArray(x) { return Array.isArray(x) ? x : (x ? [x] : []); }

export function buildPersonaPrompt(personaName = "", lang = "ar") {
  const data = loadDirectives();
  const base = data?.default || {};
  const personas = data?.personas || {};
  const persona = personaName && personas[personaName] ? personas[personaName] : null;

  const languagePolicy = base.language_policy || {};
  const hardRules = [
    ...(ensureArray(base.hard_rules)),
    ...(persona?.hard_rules ? ensureArray(persona.hard_rules) : []),
  ].filter(Boolean);

  const softRules = [
    ...(ensureArray(base.soft_rules)),
    ...(persona?.soft_rules ? ensureArray(persona.soft_rules) : []),
  ].filter(Boolean);

  const probing = base.probing || {};
  const probingPriority = persona?.probing_priority || [];
  const kpIs = persona?.kpis || base?.kpis || [];
  const planSnippets = persona?.plan_snippets || [];

  const tone = persona?.tone || base?.tone || "مهني/استشاري";
  const style = base?.style || "مباشر، دقيق، منظّم، عملي";

  // رأس التوجيه
  const header =
    lang === "ar"
      ? `أنت مساعد خبير يعمل كجزء من "فريق العون الذكي". اتبع بدقة قواعد الشخصية، وأجب دائمًا بلغة المستخدم الحالية.`
      : `You are an expert assistant within "Smart Aid Team". Strictly follow persona rules and always reply in the user's current language.`;

  // سياسة اللغة
  const langBlock = [
    `LANG_POLICY:`,
    `- mirror_user_language: ${languagePolicy?.mirror_user_language ? "true" : "false"}`,
    `- primary: ${(languagePolicy?.primary || []).join(", ")}`,
    `- fallback_order: ${(languagePolicy?.fallback_order || []).join(", ")}`,
  ].join("\n");

  const personaBlock = [
    `PERSONA: ${personaName || "عام/General"}`,
    `TONE: ${tone}`,
    `STYLE: ${style}`,
    kpIs.length ? `KPIs: ${kpIs.join(", ")}` : ``,
    planSnippets.length ? `PLAN_HINTS: ${planSnippets.map(s=>`• ${s}`).join("\n")}` : ``,
  ].filter(Boolean).join("\n");

  const hardRulesBlock = [
    `HARD_RULES:`,
    ...hardRules.map((r, i) => `${i + 1}. ${r}`),
    `- اطرح أسئلة استقصائية أولاً عند نقص المعلومات، ثم قدّم خطة تنفيذية رشيقة مرتبطة بـ KPIs.`,
    `- اربط كل توصية بسبب واضح ومؤشر قياس قابل للتتبّع.`,
    `- لا حشو، لا عموميات، كل سطر يوجّه التنفيذ.`,
  ].join("\n");

  const softRulesBlock = softRules.length
    ? ["SOFT_RULES:", ...softRules.map((r, i) => `${i + 1}. ${r}`)].join("\n")
    : "";

  const probingBlock = (() => {
    const cols = [];
    for (const [key, arr] of Object.entries(probing)) {
      if (!Array.isArray(arr) || !arr.length) continue;
      cols.push(`• ${key}: ${arr.join(" | ")}`);
    }
    const prio = probingPriority.length ? `PRIORITY: ${probingPriority.join(" → ")}` : "";
    return `PROBING:\n${cols.join("\n")}\n${prio}`;
  })();

  return [
    header,
    langBlock,
    personaBlock,
    hardRulesBlock,
    softRulesBlock,
    probingBlock,
    `OUTPUT FORMAT: Markdown مقسّم بعناوين واضحة وقوائم قصيرة.`
  ].filter(Boolean).join("\n\n");
}
