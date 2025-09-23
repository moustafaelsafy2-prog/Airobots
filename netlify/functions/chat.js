/*! @file netlify/functions/chat.js
 *  @version 1.0.1
 *  @updated 2025-09-23
 *  واجهة آمنة لـ Gemini مع تخصيص "الشخصية" وسياق الشركة + دعم مرفقات
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { withCORS, jsonResponse, safeParse } from "./_utils.js";

/** اختر الموديل الافتراضي (يمكن تغييره من متغير بيئة) */
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-1.5-flash";

/** إعدادات التوليد */
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
    company = {},
    files = [],
  } = safeParse(event.body, {});

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse(400, { error: "messages[] is required" });
  }

  // نبني مطالبة النظام بحسب الشخصية وسياق الشركة
  const systemPrompt = buildSystemPrompt(persona, company);

  /** نبني contents كما تتوقع مكتبة Gemini:
   *  الأدوار المقبولة: "user" و "model"
   *  نترجم assistant => model لضمان صحة الحوار
   */
  const contents = [];

  // 1) نبدأ برسالة "user" تحتوي على System Prompt (تعليمات الدور)
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

  // 3) دعم مرفقات الملفات (inlineData) — نرفقها مع آخر رسالة "user" إن وجدت، وإلا ننشئ رسالة user جديدة
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
    const model = genAI.getGenerativeModel({
      model: MODEL_ID,
      generationConfig,
    });

    // نطلب التوليد مباشرة دون حشو "Assistant:" أو أدوار غير مدعومة
    const result = await model.generateContent({ contents });

    const text =
      (result?.response && typeof result.response.text === "function"
        ? result.response.text()
        : null) || "لم يصل رد من النموذج.";

    return jsonResponse(200, { text });
  } catch (err) {
    // معالجة أخطاء مقروءة
    const status = err?.status || err?.code || 500;
    const message =
      err?.message?.toString?.() ||
      (typeof err === "string" ? err : "Gemini request failed");

    // بعض أخطاء 400 تأتي من content غير صحيح — نطبع محتويات مختصرة للتشخيص في اللوج فقط
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
        // أظهر التفاصيل في وضع التطوير فقط
        details:
          process.env.NODE_ENV === "development" ? String(message) : undefined,
      }
    );
  }
});

/** بناء مطالبة النظام مع شخصية + سياق الشركة */
function buildSystemPrompt(persona = "", company = {}) {
  const base =
    "أنت مستشار عربي محترف يجيب بإيجاز وتنظيم (عناوين فرعية، نقاط، خطوات، أمثلة عملية)، " +
    "تسأل سؤال/سؤالين استيضاحيين فقط إن كانت المعلومات ناقصة، ثم تقدّم خطة تنفيذ مختصرة قابلة للتطبيق. " +
    "تجنّب الحشو والعموميات وركّز على نتائج قابلة للقياس.";

  const org =
    company && Object.keys(company).length
      ? [
          "[سياق الشركة]",
          `- الاسم: ${company.name || "غير محدد"}`,
          `- المجال: ${company.industry || "غير محدد"}`,
          `- الحجم: ${company.size || "غير محدد"}`,
          `- الجمهور: ${company.audience || "غير محدد"}`,
          `- الأهداف: ${company.goals || "غير محدد"}`,
        ].join("\n")
      : "";

  const personas = {
    "ألفا (Alfa)":
      "الدور: خبير تسويق رقمي (SEO/SEM، ICP، رسائل قيمة، قنوات اكتساب، قمع، A/B، تتبع). أخرج مخططات حملات وتقاويم محتوى ورسائل.",
    "فيزي (Vizi)":
      "الدور: خبير مبيعات (Discovery، عروض قيمة، اعتراضات، تأهيل، CRM، KPIs). أخرج Playbooks ورسائل بريد/واتساب ونصوص مكالمات.",
    "كورتكس (Cortex)":
      "الدور: خبير مالي (ميزانيات، تدفق نقدي، تسعير، KPIs، لوحات). أخرج جداول/معادلات وخطوات تنفيذ.",
    "ليكس (Lex)":
      "الدور: خدمة عملاء (SLA، قوالب ردود، إدارة شكاوى، CSAT). أخرج سكربتات وإجراءات تصعيد.",
    "أوكتو (Octo)":
      "الدور: عمليات (SOPs، أتمتة، خرائط سير عمل). أخرج SOPs خطوة بخطوة وقائمة أدوات.",
    "مينا (Mina)":
      "الدور: تحليل بيانات (تنظيف، مؤشرات، رؤى قابلة للتنفيذ، لوحات). أخرج أسئلة فرضيات وخطة استخراج.",
    "بولت (Bolt)":
      "الدور: إدارة مشاريع (نطاق/زمن/تكلفة/مخاطر، WBS، جانت). أخرج خطة أسبوعية ومصفوفة مخاطر.",
    "ريكس (Rex)":
      "الدور: إدارة مالية تشغيلية (موازنات أقسام، رقابة تكاليف). أخرج سياسات صرف وبنود خفض تكلفة.",
    "بادي (Buddy)":
      "الدور: علاقات عامة (رسائل، مؤثرون، بيان صحفي). أخرج حزمة محتوى وقوالب.",
    "روفر (Rover)":
      "الدور: CRM ولاء (تقسيم شرائح، رحلات عميل). أخرج Segments وسيناريوهات Journey.",
    "فالور (Valor)":
      "الدور: تجارة إلكترونية (CRO، صفحات المنتج، السلة/الدفع، مخزون). أخرج تشخيص صفحات وخطة اختبارات.",
    "زينيث (Zenith)":
      "الدور: ابتكار/منتج (أفكار، MVP، منافسون، خارطة طريق). أخرج Canvas وخطة تحقق.",
  };

  const role = personas[persona] || "";
  return [base, org, role].filter(Boolean).join("\n\n");
}
