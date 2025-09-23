/*! @file netlify/functions/chat.js
 *  @version 1.0.0
 *  @updated 2025-09-23
 *  @owner Mustafa
 *  @notes: واجهة آمنة لاستدعاء Gemini — لا تُسرّب المفتاح للمتصفح
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { withCORS, jsonResponse } from "./_utils.js";

// نموذج افتراضي: سريع وعملي. غيّره إلى "gemini-1.5-pro" عند الحاجة للجودة الأعلى.
const MODEL_ID = "gemini-1.5-flash";

export const handler = withCORS(async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: "GEMINI_API_KEY is not configured" });
  }

  // Parse body
  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { messages = [], persona = "", files = [] } = payload;

  // بناء system prompt بحسب الشخصية
  const systemPrompt = buildSystemPrompt(persona);

  // دمج المحادثة في نص واحد (يمكن لاحقاً استخدام محادثة متعددة الأدوار)
  let chatText = `${systemPrompt}\n\n`;
  for (const m of messages) {
    const tag = m.role === "user" ? "User" : "Assistant";
    chatText += `${tag}: ${m.text}\n`;
  }
  chatText += "Assistant:";

  // إعداد الأجزاء (نص + ملفات مضمّنة اختياريًا)
  const parts = [{ text: chatText }];

  if (Array.isArray(files) && files.length) {
    for (const f of files) {
      if (f?.mime && f?.base64) {
        parts.push({
          inlineData: { data: f.base64, mimeType: f.mime },
        });
      }
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_ID });

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });

    // استخلاص النص
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

/** بناء مطالبة النظام بحسب الشخصية المختارة */
function buildSystemPrompt(persona = "") {
  const base =
    "أنت مساعد محترف يجيب بالعربية بوضوح ودقة، يركز على النتائج والتنفيذ، " +
    "ويستخدم تنسيقًا موجزًا بعناوين ونقاط عند الحاجة. لا تقدّم حشوًا.";

  const personas = {
    "ألفا (Alfa)":
      "شخصيتك: خبير تسويق رقمي (حملات، محتوى، تتبع، A/B، قمع مبيعات).",
    "فيزي (Vizi)":
      "شخصيتك: خبير مبيعات (إقفال صفقات، CRM، عروض قيمة، اعتراضات).",
    "كورتكس (Cortex)":
      "شخصيتك: خبير مالي (ميزانيات، تدفق نقدي، تقارير KPI).",
    "ليكس (Lex)":
      "شخصيتك: خدمة عملاء (SLA، قوالب ردود، CSAT، تصعيد).",
    "أوكتو (Octo)":
      "شخصيتك: عمليات (SOPs، أتمتة، تحسين سير العمل).",
    "مينا (Mina)":
      "شخصيتك: تحليل بيانات (لوحات مؤشرات، KPIs، رؤى قابلة للتنفيذ).",
    "بولت (Bolt)":
      "شخصيتك: إدارة مشاريع (نطاق/زمن/تكلفة/مخاطر، خطط وجداول).",
    "ريكس (Rex)":
      "شخصيتك: إدارة مالية تشغيلية (موازنات الأقسام، رقابة التكاليف).",
    "بادي (Buddy)":
      "شخصيتك: علاقات عامة (رسائل، بيانات صحفية، سمعة).",
    "روفر (Rover)":
      "شخصيتك: علاقات العملاء/CRM (ولاء، تقسيم شرائح، رحلات عميل).",
    "فالور (Valor)":
      "شخصيتك: تجارة إلكترونية (CRO، مخزون، تجربة دفع).",
    "زينيث (Zenith)":
      "شخصيتك: ابتكار/منتج (خارطة طريق، منافسون، MVP).",
  };

  const p = personas[persona] || "";
  return [base, p].filter(Boolean).join("\n");
}
