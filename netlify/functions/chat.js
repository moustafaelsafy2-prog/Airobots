/*! @file netlify/functions/chat.js
 *  واجهة آمنة لـ Gemini مع تخصيص "الشخصية" وسياق الشركة + تحسينات احترافية
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { withCORS, jsonResponse, safeParse } from "./_utils.js";

// اسم النموذج يمكن تغييره من متغير بيئة إن وُجد
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-1.5-pro";

const generationConfig = {
  temperature: 0.6,
  topK: 32,
  topP: 0.95,
  maxOutputTokens: 1024,
  responseMimeType: "text/markdown", // إخراج منسّق
};

// إعدادات الأمان (يمكن تعديلها حسب الحاجة)
const safetySettings = [
  // أمثلة—اتركها افتراضيًا إن رغبت. يمكن توسعتها لاحقًا.
  // { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
  // { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
];

const LIMITS = {
  MAX_MESSAGES: 24,            // أقصى عدد رسائل نمرّرها للنموذج
  MAX_FILES: 4,                // أقصى عدد ملفات
  MAX_FILE_BYTES: 5 * 1024 * 1024, // 5MB لكل ملف
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

  // نقرأ الجسم بأمان + دعم meta.company
  const body = safeParse(event.body, {});
  const {
    messages = [],
    persona = "",
    company: companyRaw = {},
    files = [],
    meta = {},
  } = body;

  const company = Object.keys(companyRaw || {}).length
    ? companyRaw
    : (meta && meta.company) || {};

  // تحقق من المدخلات
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse(400, { error: "messages[] is required" });
  }
  if (!Array.isArray(files)) {
    return jsonResponse(400, { error: "files[] must be an array" });
  }

  // تقليم المحادثة لتجنّب تضخّم السياق
  const trimmedMessages = messages.slice(-LIMITS.MAX_MESSAGES).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    text: typeof m.text === "string" ? m.text : "",
  }));

  // فحص الملفات (اختياري)
  const safeFiles = [];
  for (const f of files.slice(0, LIMITS.MAX_FILES)) {
    if (!f?.mime || !f?.base64) continue;
    try {
      const bytes = Buffer.from(f.base64, "base64");
      if (bytes.length > LIMITS.MAX_FILE_BYTES) {
        return jsonResponse(413, {
          error: `File too large (> ${Math.round(LIMITS.MAX_FILE_BYTES / (1024 * 1024))}MB): ${f.name || f.mime}`,
        });
      }
      safeFiles.push({ mimeType: f.mime, data: f.base64 });
    } catch {
      // تجاهل الملف غير الصالح
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // نبني System Instruction احترافي
    const systemInstruction = buildSystemPrompt(persona, company);

    const model = genAI.getGenerativeModel({
      model: MODEL_ID,
      generationConfig,
      safetySettings,
      systemInstruction, // تعليمات النظام الرسمية
    });

    // نبني الأجزاء (المحادثة + مرفقات)
    const parts = [
      {
        text:
          "هذه محادثة تتضمن user/assistant. التزم بالتنسيق العملي المختصر.\n" +
          trimmedMessages
            .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.text}`)
            .join("\n") +
          "\nAssistant:",
      },
    ];

    // إلحاق الملفات (إن وُجدت)
    safeFiles.forEach((f) => parts.push({ inlineData: { data: f.data, mimeType: f.mimeType } }));

    const contents = [{ role: "user", parts }];

    const result = await model.generateContent({ contents });
    const text =
      (result?.response && typeof result.response.text === "function"
        ? result.response.text()
        : null) || "لم يصل رد من النموذج.";

    return jsonResponse(200, { text });
  } catch (err) {
    // أخطاء مقروءة للمستهلك
    const code = err?.status || err?.code || "unknown";
    const msg =
      err?.message?.toString?.() ||
      (typeof err === "string" ? err : "Gemini request failed");

    // سجل مبسّط (تجنّب طباعة الجسم)
    console.error("❌ Gemini error:", code, msg);

    return jsonResponse(500, {
      error: "Gemini request failed",
      code,
      details: process.env.NODE_ENV === "development" ? msg : undefined,
    });
  }
});

function buildSystemPrompt(persona = "", company = {}) {
  const base =
    "أنت مستشار عربي محترف يكتب بإيجاز وتنظيم (عناوين فرعية، نقاط، خطوات، جداول/كود عند الحاجة). " +
    "اسأل أسئلة استيضاحية قصيرة فقط إن كانت المعلومات ناقصة، ثم قدّم خطة تنفيذ واضحة قابلة للتطبيق. " +
    "تجنّب الحشو والعموميات؛ اجعل كل سطر عمليًا. اكتب بصياغة ودودة ولكن حاسمة.";

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
      "الدور: خبير تسويق رقمي (بحث كلمات مفتاحية، ICP، رسائل قيمة، قنوات اكتساب، قمع مبيعات، A/B، تتبع وتحليلات). أخرج مخططات حملات، تقاويم محتوى، ونماذج رسائل.",
    "فيزي (Vizi)":
      "الدور: خبير مبيعات B2B/B2C (Discovery، عروض قيمة، اعتراضات، تأهيل، CRM، مؤشرات). أخرج Playbooks ورسائل بريد/واتساب ونصوص مكالمات.",
    "كورتكس (Cortex)":
      "الدور: خبير مالي (ميزانيات، تدفق نقدي، تسعير، KPIs، لوحات). أخرج جداول/معادلات وخطوات تنفيذ.",
    "ليكس (Lex)":
      "الدور: خدمة عملاء (SLA، قوالب ردود، إدارة الشكاوى، CSAT/CRM). أخرج سكربتات وإجراءات تصعيد.",
    "أوكتو (Octo)":
      "الدور: عمليات (SOPs، أتمتة، خرائط سير عمل، أدوات). أخرج SOPs خطوة بخطوة وقائمة أدوات.",
    "مينا (Mina)":
      "الدور: تحليل بيانات (تنظيف، مؤشرات، رؤى قابلة للتنفيذ، لوحات). أخرج أسئلة فرضيات وخطة استخراج بيانات.",
    "بولت (Bolt)":
      "الدور: إدارة مشاريع (نطاق/زمن/تكلفة/مخاطر، Gantt، WBS). أخرج خطة أسبوعية ومخاطر وتخفيف.",
    "ريكس (Rex)":
      "الدور: إدارة مالية تشغيلية (موازنات أقسام، رقابة تكاليف، توفير). أخرج سياسات صرف وبنود خفض تكلفة.",
    "بادي (Buddy)":
      "الدور: علاقات عامة (رسائل، تغطيات، مؤثرون، بيان صحفي). أخرج حزمة محتوى وقوالب.",
    "روفر (Rover)":
      "الدور: CRM ولاء (تقسيم شرائح، رحلات عميل، عروض). أخرج Segments وسيناريوهات Journey.",
    "فالور (Valor)":
      "الدور: تجارة إلكترونية (CRO، صفحات المنتج، سلة/دفع، مخزون). أخرج تشخيص صفحات وخطة اختبارات.",
    "زينيث (Zenith)":
      "الدور: ابتكار/منتج (أفكار، MVP، منافسون، خارطة طريق). أخرج Canvas وخطة تحقق من الفرضيات.",
  };

  const role = personas[persona] || "";
  return [base, org, role].filter(Boolean).join("\n");
}
