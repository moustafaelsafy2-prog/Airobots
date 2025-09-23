/*! @file netlify/functions/users.js
 *  @version 2.0.0
 *  @updated 2025-09-23
 *  @owner Mustafa
 *  @notes: إدارة CRUD للمستخدمين مع دعم البحث والتصفية والتصفح (Pagination)
 */

import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("users");
  const method = req.method || "GET";

  try {
    let users = (await store.get("users.json", { type: "json" })) || [];

    // Helpers
    const findById = (id) => users.find((u) => String(u.id) === String(id));
    const findByUsername = (username) =>
      users.find(
        (u) =>
          (u.username || "").trim().toLowerCase() ===
          (username || "").trim().toLowerCase()
      );

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });

    // ==================== GET ====================
    if (method === "GET") {
      const url = new URL(req.url);
      const q = (url.searchParams.get("search") || "").toLowerCase();
      const role = url.searchParams.get("role") || "";
      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const limit = parseInt(url.searchParams.get("limit") || "10", 10);

      let filtered = users.filter((u) => {
        const hay = [u.username, u.email, u.role].join(" ").toLowerCase();
        const matchQ = !q || hay.includes(q);
        const matchRole = !role || (u.role || "").trim() === role;
        return matchQ && matchRole;
      });

      const total = filtered.length;
      const start = (page - 1) * limit;
      const end = start + limit;
      const data = filtered.slice(start, end);

      return json({ ok: true, data, page, limit, total });
    }

    // ==================== POST (إضافة/تحديث إذا الاسم موجود) ====================
    if (method === "POST") {
      const body = await req.json();
      const { username, password, email = "", role = "مستخدم" } = body || {};
      if (!username || !password)
        return json({ ok: false, error: "⚠️ البيانات ناقصة" }, 400);

      const existing = findByUsername(username);
      if (existing) {
        existing.email = email;
        existing.role = role;
        existing.password = btoa(password);
      } else {
        users.push({
          id: Date.now().toString(),
          username,
          email,
          role,
          password: btoa(password),
          createdAt: new Date().toISOString(),
        });
      }

      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 201);
    }

    // ==================== PUT (تعديل) ====================
    if (method === "PUT") {
      const body = await req.json();
      const { id, username, email, role, password } = body || {};
      if (!id) return json({ ok: false, error: "⚠️ id مفقود" }, 400);

      const node = findById(id);
      if (!node) return json({ ok: false, error: "❌ المستخدم غير موجود" }, 404);

      if (username) {
        const dup = findByUsername(username);
        if (dup && String(dup.id) !== String(id)) {
          return json({ ok: false, error: "⚠️ اسم المستخدم مستخدم بالفعل" }, 409);
        }
        node.username = username;
      }

      if (email != null) node.email = email;
      if (role != null) node.role = role;
      if (password) node.password = btoa(password);

      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 200);
    }

    // ==================== DELETE ====================
    if (method === "DELETE") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      if (!id) return json({ ok: false, error: "⚠️ id مفقود" }, 400);

      users = users.filter((u) => String(u.id) !== String(id));
      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 200);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405);
  } catch (err) {
    console.error("❌ Users API error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message || "Server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
