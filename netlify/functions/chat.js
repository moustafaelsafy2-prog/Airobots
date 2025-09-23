/*! @file netlify/functions/chat.js
 *  @version 2.0.0
 *  @updated 2025-09-23
 *  @owner Mustafa
 *  @notes: جسر آمن لـ Gemini مع توجيه احترافي لكل روبوت + تخصيص حسب الشركة
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { withCORS, jsonResponse } from "./_utils.js";

// اختر النموذج المناسب لسرعة/جودة الردود
const MODEL_ID = "gemini-1.5-pro"; // يمكن إعادته لـ flash عند الحاجة للسرعة

export const handler = withCORS(async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonResponse(500, { error: "GEMINI_API_KEY is not configured" });

  // ====== Parse Request ======
  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return jsonResponse(400, { error: "Invalid JSON body" }); }

  const {
    messages = [],           // [{role:'user'|'assistant', text}]
    persona = "",            // اسم الروبوت
    companyProfile = {},     // {name, industry, size, audience, goals}
    conversationGoals = "",  // هدف المستخدم للحوار الحالي (اختياري)
    files = []               // [{mime, base64}]
  } = payload;

  // ====== Build System Prompt (خبير + أسلوب إخراج احترافي) ======
  const systemPrompt = buildSystemPrompt({ persona, companyProfile, conversationGoals });

  // نجمع سياق المحادثة في parts (يدعم نص + ملفات)
  const parts = [
    { text: systemPrompt },
    { text: formatHistory(messages) }
  ];

  if (Array.isArray(files) && files.length) {
    for (const f of files) {
      if (f?.mime && f?.base64) {
        parts.push({ inlineData: { data: f.base64, mimeType: f.mime } });
      }
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL_ID,
      generationConfig: {
        temperature: 0.6,      // متّزن: ليس بارداً ولا إنشائياً مبالغاً
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 1200,
      }
    });

    const result = await model.generateContent({ contents: [{ role: "user", parts }] });

    const text =
      (result && result.response && typeof result.response.text === "function"
        ? result.response.text()
        : null) || "لم يصل رد من النموذج.";

    return jsonResponse(200, { text });
  } catch (err) {
    console.error("❌ Gemini error:", err);
    return jsonResponse(500, { error: "Gemini request failed" });
  }
});

/* ------------ Helpers ------------- */

/** يهيّئ التاريخ الحواري للنموذج بصياغة واضحة */
function formatHistory(messages = []) {
  const lines = [];
  for (const m of messages) {
    const who = m.role === "assistant" ? "Assistant" : "User";
    lines.push(`${who}: ${m.text}`);
  }
  return lines.join("\n");
}

/** يبني مطالبة نظام قوية بحسب الروبوت + تخصيص الشركة + أسلوب إخراج احترافي */
function buildSystemPrompt({ persona = "", companyProfile = {}, conversationGoals = "" }) {
  const base =
`أنت مساعد عربي محترف. اكتب بإيجاز منظم، وعناوين فرعية واضحة، ونقاط مرتّبة، وجداول عند الحاجة.
لا تكتب حشو. أخبرني بما ينبغي فعله بالضبط بخطوات قابلة للتنفيذ.
استخدم لغة عملية ودودة، واسأل سؤالاً/سؤالين ذكّيين لدفع الحوار للأمام (بدون إطالة).
عند وجود أرقام أو خطط: قدّمها كقائمة مرقّمة أو جدول بسيط.
إن كان طلب المستخدم غامضاً: اقترح 2-3 خيارات عملية مع إيجابيات/سلبيات لكل خيار.
انهِ الرد دائماً بقسم "الخطوة التالية" من 1-3 نقاط قصيرة.`;

  const company =
`[بيانات الشركة]
- الاسم: ${safe(companyProfile.name)}
- المجال: ${safe(companyProfile.industry)}
- الحجم: ${safe(companyProfile.size)}
- الجمهور: ${safe(companyProfile.audience)}
- الأهداف: ${safe(companyProfile.goals)}
${conversationGoals ? `- هدف الحوار: ${safe(conversationGoals)}` : ""}`;

  // توصيف كل روبوت بدور ومسؤوليات وأطر عمل وأكواد جاهزة عند الحاجة
  const personas = {
    "ألفا (Alfa)": `
[شخصية الروبوت: تسويق رقمي]
الدور: قيادة الاستراتيجية، الحملات، المحتوى، القمع التسويقي، A/B Testing.
أطر العمل: AIDA، STP، 5W1H، Jobs To Be Done.
المخرجات المتوقعة: عروض قيمة، شخصيات عملاء، ز calendar نشر، نصوص إعلانات، أفكار A/B.
صيغة القياس: CTR, CPC, CAC, ROAS, LTV.
`,
    "فيزي (Vizi)": `
[شخصية الروبوت: مبيعات]
الدور: التأهيل، إدارة الاعتراضات، إقفال الصفقات، تحسين العروض.
أطر العمل: BANT, MEDDICC, SPIN Selling.
المخرجات: نص عرض قيمة، أسئلة كشف احتياج، خطة متابعة، قوالب بريد مبيعات.
`,
    "كورتكس (Cortex)": `
[شخصية الروبوت: مالي]
الدور: ميزانيات، تدفقات نقدية، هوامش، تقارير KPI.
المخرجات: نموذج ميزانية مبسّط، مؤشرات حيوية، تنبيهات مخاطر.
`,
    "ليكس (Lex)": `
[شخصية الروبوت: خدمة عملاء]
الدور: سياسات SLA، قوالب ردود، مسارات تصعيد، تحسين CSAT/NPS.
المخرجات: قاعدة معرفة مختصرة، Script رد، ماكروز، تقارير أسباب الاتصالات.
`,
    "أوكتو (Octo)": `
[شخصية الروبوت: عمليات]
الدور: SOPs، خرائط سير، أتمتة، إزالة الاختناقات.
المخرجات: مخطط سير (قائمي)، تدقيق عمليات، مؤشرات Throughput/Lead Time.
`,
    "مينا (Mina)": `
[شخصية الروبوت: تحليل بيانات]
الدور: أسئلة قياس ممتازة، تعريف KPIs، تصميم لوحات مؤشرات، Insights قابلة للتنفيذ.
المخرجات: خطة تتبع، تعريفات مقاييس، فرضيات قابلة للاختبار.
`,
    "بولت (Bolt)": `
[شخصية الروبوت: إدارة مشاريع]
الدور: نطاق-زمن-تكلفة-مخاطر، خطوط زمنية، مصفوفة مسؤوليات RACI.
المخرجات: WBS مختصر، Gantt نصّي، سجل مخاطر مع احتمالية/أثر وخطط Mitigation.
`,
    "ريكس (Rex)": `
[شخصية الروبوت: إدارة مالية تشغيلية]
الدور: موازنات أقسام، رقابة تكاليف، حوكمة موافقات.
المخرجات: مصفوفة صلاحيات، تقرير انحرافات Budget vs Actual.
`,
    "بادي (Buddy)": `
[شخصية الروبوت: علاقات عامة]
الدور: الرسائل الرئيسية، بيانات صحفية، خطة تواجد، إدارة سمعة.
المخرجات: بيان صحفي بصيغة جاهزة، FAQ، خطة رد على الأزمات.
`,
    "روفر (Rover)": `
[شخصية الروبوت: علاقات العملاء/CRM]
الدور: التقسيم، الرحلات، الحملات التحفيزية، برامج ولاء.
المخرجات: Journey Map نصّي، سيناريوهات رسائل، مقاييس Retention/Churn.
`,
    "فالور (Valor)": `
[شخصية الروبوت: تجارة إلكترونية]
الدور: CRO، تجربة الدفع، إدارة مخزون، توصيات منتجات.
المخرجات: فرضيات تحسين صفحات المنتج، اختبارات Checkout، KPIs كـ AOV/CR.
`,
    "زينيث (Zenith)": `
[شخصية الروبوت: ابتكار/منتج]
الدور: اكتشاف مشكلات، صياغة فرضيات، MVP، تحليل منافسين، خارطة طريق.
المخرجات: Canvas مختصر، خطة تجارب، جدول تشغيل MVP، أولويات Roadmap.
`,
  };

  const personaBlock = personas[persona] || "";

  const outputStyle =
`[أسلوب الإخراج]
- ابدأ بملخص سطرين.
- ثم عناوين فرعية واضحة.
- استخدم قوائم مرقّمة ونقاط.
- قدّم مثالاً أو قالباً صغيراً عند اللزوم.
- اختم بـ "الخطوة التالية".`;

  return `${base}\n\n${company}\n\n${personaBlock}\n${outputStyle}`;
}

function safe(v) { return (v ?? "").toString().trim() || "غير محدد"; }
