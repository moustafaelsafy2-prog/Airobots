/*! @file netlify/functions/users.js
 *  @version 2.0.0
 *  @updated 2025-09-23
 *  @owner Mustafa
 *  @notes: CRUD + بحث + Pagination + حماية بالـ JWT
 */

import { getStore } from "@netlify/blobs";
import { withCORS, jsonResponse, verifyToken } from "./_utils.js";

export const handler = withCORS(async (event) => {
  const store = getStore("users");
  const method = event.httpMethod || "GET";

  try {
    // تحقق من التوكن (إلزامي لكل العمليات ماعدا GET العام)
    const isProtected = ["POST", "PUT", "DELETE"].includes(method);
    if (isProtected) {
      const auth = event.headers.authorization || "";
      const token = auth.replace("Bearer ", "");
      const decoded = verifyToken(token);
      if (!decoded || decoded.role !== "admin") {
        return jsonResponse(401, { ok: false, error: "غير مصرح لك" });
      }
    }

    // جلب بيانات المستخدمين من التخزين
    let users = (await store.get("users.json", { type: "json" })) || [];

    // Helpers
    const findById = (id) => users.find((u) => String(u.id) === String(id));
    const findByUsername = (username) =>
      users.find(
        (u) =>
          (u.username || "").trim().toLowerCase() ===
          (username || "").trim().toLowerCase()
      );

    // البحث + التصفح
    const url = new URL(event.rawUrl);
    const q = (url.searchParams.get("search") || "").toLowerCase().trim();
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);

    const filterUsers = (list) =>
      !q
        ? list
        : list.filter((u) =>
            [u.username, u.email, u.role]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q)
          );

    // 📌 GET — قراءة المستخدمين (مع البحث والتصفح)
    if (method === "GET") {
      const filtered = filterUsers(users);
      const start = (page - 1) * limit;
      const end = start + limit;
      const paged = filtered.slice(start, end);

      return jsonResponse(200, {
        ok: true,
        data: paged,
        page,
        limit,
        total: filtered.length,
      });
    }

    // 📌 POST — إضافة مستخدم جديد
    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { username, password, email = "", role = "مستخدم" } = body;

      if (!username || !password) {
        return jsonResponse(400, { ok: false, error: "البيانات ناقصة" });
      }

      const existing = findByUsername(username);
      if (existing) {
        return jsonResponse(409, {
          ok: false,
          error: "اسم المستخدم مستخدم بالفعل",
        });
      }

      const user = {
        id: Date.now().toString(),
        username,
        email,
        role,
        password: btoa(password), // Base64
        createdAt: new Date().toISOString(),
      };
      users.push(user);

      await store.set("users.json", JSON.stringify(users));
      return jsonResponse(201, { ok: true, user });
    }

    // 📌 PUT — تعديل مستخدم
    if (method === "PUT") {
      const body = JSON.parse(event.body || "{}");
      const { id, username, email, role, password } = body;

      if (!id) return jsonResponse(400, { ok: false, error: "id مفقود" });

      const node = findById(id);
      if (!node) return jsonResponse(404, { ok: false, error: "المستخدم غير موجود" });

      if (username) {
        const dup = findByUsername(username);
        if (dup && String(dup.id) !== String(id)) {
          return jsonResponse(409, { ok: false, error: "اسم المستخدم مستخدم بالفعل" });
        }
        node.username = username;
      }
      if (email != null) node.email = email;
      if (role != null) node.role = role;
      if (password) node.password = btoa(password);

      await store.set("users.json", JSON.stringify(users));
      return jsonResponse(200, { ok: true, user: node });
    }

    // 📌 DELETE — حذف مستخدم
    if (method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return jsonResponse(400, { ok: false, error: "id مفقود" });

      const before = users.length;
      users = users.filter((u) => String(u.id) !== String(id));

      if (users.length === before) {
        return jsonResponse(404, { ok: false, error: "المستخدم غير موجود" });
      }

      await store.set("users.json", JSON.stringify(users));
      return jsonResponse(200, { ok: true, id });
    }

    // 📌 أي ميثود آخر
    return jsonResponse(405, { ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("❌ Users API error:", err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
});
