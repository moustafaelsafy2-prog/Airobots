/*! @file netlify/functions/admin-auth.js
 *  @version 2.0.0
 *  @updated 2025-09-23
 *  @owner Mustafa
 *  @notes: تسجيل دخول الأدمن — يتحقق من بيانات الدخول ويصدر JWT آمن مع مدة صلاحية
 */

import { withCORS, generateToken, jsonResponse } from "./_utils.js";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export const handler = withCORS(async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  try {
    const { username, password } = JSON.parse(event.body || "{}");

    if (!username || !password) {
      return jsonResponse(400, { error: "⚠️ يجب إدخال اسم المستخدم وكلمة المرور" });
    }

    // التحقق من بيانات الدخول من المتغيرات السرية
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      // صلاحية التوكن: ساعة واحدة
      const token = generateToken(
        { role: "admin", username },
        { expiresIn: "1h" }
      );

      return jsonResponse(200, {
        ok: true,
        token,
        message: "✅ تم تسجيل الدخول بنجاح",
      });
    } else {
      return jsonResponse(401, { ok: false, error: "❌ بيانات الدخول غير صحيحة" });
    }
  } catch (err) {
    console.error("❌ Admin login error:", err);
    return jsonResponse(500, { ok: false, error: "حدث خطأ داخلي في السيرفر" });
  }
});
