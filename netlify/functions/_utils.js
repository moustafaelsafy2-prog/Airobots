/*! @file netlify/functions/_utils.js
 *  @version 1.0.0
 *  @updated 2025-09-23
 *  @owner Mustafa
 *  @notes: أدوات مساعدة — CORS, JWT, BCrypt, JSON response
 */

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET;

// 📌 تفعيل CORS
export function withCORS(handler) {
  return async (event, context) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    };

    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers, body: "" };
    }

    const response = await handler(event, context);
    return { ...response, headers: { ...headers, ...(response.headers || {}) } };
  };
}

// 📌 إنشاء JWT
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "6h" });
}

// 📌 التحقق من JWT
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// 📌 دوال مساعدة للتشفير
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

export async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

// 📌 تنسيق JSON قياسي
export function jsonResponse(statusCode, data) {
  return {
    statusCode,
    body: JSON.stringify(data),
  };
}
