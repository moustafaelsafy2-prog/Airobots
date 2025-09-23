/*! @file netlify/functions/users.js
 *  @version 1.0.0
 *  @updated 2025-09-23
 *  @owner Mustafa
 *  @notes: إدارة المستخدمين (إضافة – تعديل – حذف – بحث – قائمة) عبر Netlify Functions
 */

import { withCORS, verifyToken, jsonResponse, readData, writeData } from "./_utils.js";

const USERS_FILE = "data/users.json";

export const handler = withCORS(async (event) => {
  const token = event.headers.authorization?.split(" ")[1];
  const user = verifyToken(token);

  if (!user || user.role !== "admin") {
    return jsonResponse(403, { error: "غير مصرح" });
  }

  const method = event.httpMethod;

  try {
    if (method === "GET") {
      // ✅ الحصول على قائمة المستخدمين أو البحث
      const data = readData(USERS_FILE);
      const search = event.queryStringParameters?.search?.toLowerCase();
      let users = data.users || [];

      if (search) {
        users = users.filter(
          (u) =>
            u.username.toLowerCase().includes(search) ||
            (u.fullName && u.fullName.toLowerCase().includes(search))
        );
      }

      return jsonResponse(200, { users });
    }

    if (method === "POST") {
      // ✅ إضافة مستخدم جديد
      const { username, password, fullName } = JSON.parse(event.body || "{}");
      if (!username || !password) {
        return jsonResponse(400, { error: "اسم المستخدم وكلمة السر مطلوبان" });
      }

      const data = readData(USERS_FILE);
      if (data.users.find((u) => u.username === username)) {
        return jsonResponse(409, { error: "اسم المستخدم موجود بالفعل" });
      }

      const newUser = {
        id: Date.now().toString(),
        username,
        password,
        fullName: fullName || "",
        createdAt: new Date().toISOString(),
      };

      data.users.push(newUser);
      writeData(USERS_FILE, data);

      return jsonResponse(201, { message: "تمت إضافة المستخدم بنجاح", user: newUser });
    }

    if (method === "PUT") {
      // ✅ تعديل مستخدم
      const { id, username, password, fullName } = JSON.parse(event.body || "{}");
      if (!id) {
        return jsonResponse(400, { error: "معرّف المستخدم مطلوب" });
      }

      const data = readData(USERS_FILE);
      const userIndex = data.users.findIndex((u) => u.id === id);
      if (userIndex === -1) {
        return jsonResponse(404, { error: "المستخدم غير موجود" });
      }

      if (username) data.users[userIndex].username = username;
      if (password) data.users[userIndex].password = password;
      if (fullName !== undefined) data.users[userIndex].fullName = fullName;

      writeData(USERS_FILE, data);

      return jsonResponse(200, { message: "تم تعديل المستخدم بنجاح", user: data.users[userIndex] });
    }

    if (method === "DELETE") {
      // ✅ حذف مستخدم
      const { id } = JSON.parse(event.body || "{}");
      if (!id) {
        return jsonResponse(400, { error: "معرّف المستخدم مطلوب" });
      }

      const data = readData(USERS_FILE);
      const updatedUsers = data.users.filter((u) => u.id !== id);

      if (updatedUsers.length === data.users.length) {
        return jsonResponse(404, { error: "المستخدم غير موجود" });
      }

      data.users = updatedUsers;
      writeData(USERS_FILE, data);

      return jsonResponse(200, { message: "تم حذف المستخدم بنجاح" });
    }

    return jsonResponse(405, { error: "Method Not Allowed" });
  } catch (err) {
    console.error("❌ Users API Error:", err);
    return jsonResponse(500, { error: "خطأ في السيرفر" });
  }
});
