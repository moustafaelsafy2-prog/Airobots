/*! @file netlify/functions/admin-auth.js
 *  @version 1.0.0
 *  @updated 2025-09-23
 *  @owner Mustafa
 *  @notes: تسجيل دخول الأدمن — يتحقق من بيانات الدخول ويصدر JWT
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
      return jsonResponse(400, { error: "يجب إدخال اسم المستخدم وكلمة المرور" });
    }

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const token = generateToken({ role: "admin", username });
      return jsonResponse(200, { token });
    } else {
      return jsonResponse(401, { error: "بيانات الدخول غير صحيحة" });
    }
  } catch (err) {
    console.error("❌ Login error:", err);
    return jsonResponse(500, { error: "حدث خطأ في السيرفر" });
  }
});
