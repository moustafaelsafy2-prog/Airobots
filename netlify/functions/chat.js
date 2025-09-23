/*! @file netlify/functions/chat.js
 *  واجهة آمنة لـ Gemini مع تخصيص "الشخصية" وسياق الشركة
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { withCORS, jsonResponse, safeParse } from "./_utils.js";

const MODEL_ID = "gemini-1.5-pro"; // جودة أعلى
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
    console.error("Missing GEMINI_API_KEY");
    return jsonResponse(500, { error: "GEMINI_API_KEY is not configured" });
  }

  const { messages = [], persona = "", company = {}, files = [] } = safeParse(event.body, {});
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse(400, { error: "messages[] is required" });
  }

  const systemPrompt = buildSystemPrompt(persona, company);

  // نحول المحادثة إلى صيغة واحدة واضحة للنموذج
  const dialogue = [
    { role: "user", parts: [{ text: systemPrompt }] },
    {
      role: "user",
      parts: [
        {
          text:
            "هذه المحادثة تتضمن أدوار user/assistant.\n" +
            messages
              .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.text}`)
              .join("\n") +
            "\nAssistant:",
        },
      ],
    },
  ];

  // دعم رفع ملفات (اختياري)
  if (Array.isArray(files) && files.length) {
    const last = dialogue[dialogue.length - 1];
    files.forEach((f) => {
      if (f?.mime && f?.base64) {
        last.parts.push({ inlineData: { data: f.base64, mimeType: f.mime } });
      }
    });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_ID, generationConfig });
    const result = await model.generateContent({ contents: dialogue });

    const text =
      (result?.response && typeof result.response.text === "function"
        ? result.response.text()
        : null) || "لم يصل رد من النموذج.";

    return jsonResponse(200, { text });
  } catch (err) {
    // رسائل أخطاء مقروءة
    const code = err?.status || err?.code || "unknown";
    const msg =
      err?.message?.toString?.() ||
      (typeof err === "string" ? err : "Gemini request failed");
    console.error("Gemini error:", code, msg);
    return jsonResponse(500, {
      error: "Gemini request failed",
      code,
      details: process.env.NODE_ENV === "development" ? msg : undefined,
    });
  }
});

function buildSystemPrompt(persona = "", company = {}) {
  const base =
    "أنت مستشار عربي محترف يكتب بإيجاز وتنظيم (عناوين فرعية، نقاط، خطوات، جداول كود عند الحاجة)، " +
    "يسأل أسئلة استيضاحية قصيرة قبل الحل إن كانت المعلومات ناقصة، ويقترح خطة تنفيذ قابلة للتطبيق. " +
    "تجنب الحشو والعموميات؛ اجعل كل سطر قابلًا للتنفيذ.";

  const org =
    company && Object.keys(company).length
      ? `\n[سياق الشركة]\n- الاسم: ${company.name || "غير محدد"}\n- المجال: ${
          company.industry || "غير محدد"
        }\n- الحجم: ${company.size || "غير محدد"}\n- الجمهور: ${
          company.audience || "غير محدد"
        }\n- الأهداف: ${company.goals || "غير محدد"}\n`
      : "";

  const personas = {
    "ألفا (Alfa)":
      "الدور: خبير تسويق رقمي (بحث كلمات مفتاحية، ICP/Persona، رسائل قيمة، قنوات اكتساب، قمع مبيعات، تجارب A/B، تتبع وتحليلات). أخرج مخططات حملات، تقاويم محتوى، ونماذج رسائل.",
    "فيزي (Vizi)":
      "الدور: خبير مبيعات B2B/B2C (Discovery، عروض قيمة، معالجة اعتراضات، تأهيل، CRM، تتبع مؤشرات). أخرج Playbooks ورسائل بريد/واتساب ونصوص مكالمات.",
    "كورتكس (Cortex)":
      "الدور: خبير مالي (ميزانيات، تدفق نقدي، تسعير، KPIs، لوحات متابعة). أخرج جداول/معادلات وخطوات تنفيذ.",
    "ليكس (Lex)":
      "الدور: خدمة عملاء (SLA، قوالب ردود، إدارة الشكاوى، CSAT/CRM). أخرج سكربتات وإجراءات تصعيد.",
    "أوكتو (Octo)":
      "الدور: عمليات (SOPs، أتمتة، خرائط سير عمل، أدوات). أخرج SOPs خطوة بخطوة وقائمة أدوات.",
    "مينا (Mina)":
      "الدور: تحليل بيانات (تنظيف، مؤشرات، رؤى قابلة للتنفيذ، لوحات). أخرج أسئلة الفرضيات وخطة استخراج بيانات.",
    "بولت (Bolt)":
      "الدور: إدارة مشاريع (نطاق/زمن/تكلفة/مخاطر، مخطط جانت، WBS). أخرج خطة عمل أسبوعية ومخاطر وإجراءات تخفيف.",
    "ريكس (Rex)":
      "الدور: إدارة مالية تشغيلية (موازنات أقسام، رقابة تكاليف، توفير). أخرج سياسات صرف وبنود خفض تكلفة.",
    "بادي (Buddy)":
      "الدور: علاقات عامة (رسائل، تغطيات، تواصل مع مؤثرين، بيان صحفي). أخرج حزمة محتوى نُشر/قوالب.",
    "روفر (Rover)":
      "الدور: CRM ولاء (تقسيم شرائح، رحلات عميل، عروض). أخرج Segments وسيناريوهات رحلة العميل.",
    "فالور (Valor)":
      "الدور: تجارة إلكترونية (CRO، صفحات المنتج، سلة/دفع، مخزون). أخرج تشخيص صفحات وخطة اختبارات.",
    "زينيث (Zenith)":
      "الدور: ابتكار/منتج (أفكار، MVP، منافسون، خارطة طريق). أخرج Canvas وخطة تحقق من الفرضيات.",
  };

  const role = personas[persona] || "";
  return [base, org, role].filter(Boolean).join("\n");
}
