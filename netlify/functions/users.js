// netlify/functions/users.js
// إدارة مستخدمين بسيطة عبر Netlify Blobs
// إصلاح 502: استبدال btoa() بـ Buffer (Node)

import { getStore } from "@netlify/blobs";
import { Buffer } from "node:buffer";

/** Base64 في Node */
const toB64 = (s = "") => Buffer.from(String(s), "utf8").toString("base64");

/** رد JSON موحّد */
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export default async (req) => {
  const store = getStore("users"); // اسم الحاوية
  const method = req.method || "GET";

  try {
    // اقرأ القائمة أو مصفوفة فاضية أول مرة
    let users = (await store.get("users.json", { type: "json" })) || [];

    // أدوات مساعدة
    const findById = (id) => users.find((u) => String(u.id) === String(id));
    const findByUsername = (username) =>
      users.find(
        (u) =>
          (u.username || "").trim().toLowerCase() ===
          (username || "").trim().toLowerCase()
      );

    // ======== GET: دعم البحث والتصفح إن وُجدت بارامترات، وإلا نرجّع الشكل القديم ========
    if (method === "GET") {
      const url = new URL(req.url);
      const q = (url.searchParams.get("search") || "").trim().toLowerCase();
      const page = parseInt(url.searchParams.get("page") || "0", 10);
      const limit = parseInt(url.searchParams.get("limit") || "0", 10);

      // لو ما في page/limit -> استجابة متوافقة قديمة
      if (!page || !limit) {
        return json({ ok: true, users });
      }

      // فلترة بالبحث (اسم/بريد/دور)
      let filtered = users;
      if (q) {
        filtered = users.filter((u) => {
          const hay = [u.username, u.email, u.role]
            .map((v) => String(v || "").toLowerCase())
            .join(" ");
          return hay.includes(q);
        });
      }

      // ترتيب (اختياري لاحقًا) — هنا بدون ترتيب مُحدد
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const safePage = Math.min(Math.max(1, page), totalPages);
      const start = (safePage - 1) * limit;
      const data = filtered.slice(start, start + limit);

      return json({
        ok: true,
        data,
        page: safePage,
        total,
        limit,
      });
    }

    // ======== POST: إضافة (أو تحديث إذا الاسم موجود) ========
    if (method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { username, password, email = "", role = "مستخدم" } = body || {};

      if (!username || !password) {
        return json({ ok: false, error: "البيانات ناقصة" }, 400);
      }

      // لو الاسم موجود بالفعل -> نحدّث بدل الإضافة
      const existing = findByUsername(username);
      if (existing) {
        existing.email = email;
        existing.role = role;
        existing.password = toB64(password); // ✅ آمن في Node
      } else {
        users.push({
          id: Date.now().toString(),
          username,
          email,
          role,
          createdAt: Date.now(),
          password: toB64(password), // ✅
        });
      }

      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 201);
    }

    // ======== PUT: تعديل بحسب id مع منع تكرار الاسم ========
    if (method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const { id, username, email, role, password } = body || {};

      if (!id) return json({ ok: false, error: "id مفقود" }, 400);

      const node = findById(id);
      if (!node) return json({ ok: false, error: "المستخدم غير موجود" }, 404);

      // منع اسم مكرر لشخص آخر
      if (username) {
        const dup = findByUsername(username);
        if (dup && String(dup.id) !== String(id)) {
          return json({ ok: false, error: "اسم المستخدم مستخدم بالفعل" }, 409);
        }
      }

      if (username != null) node.username = username;
      if (email != null) node.email = email;
      if (role != null) node.role = role;
      if (password) node.password = toB64(password); // ✅

      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 200);
    }

    // ======== DELETE: حذف بحسب id في query ========
    if (method === "DELETE") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      users = users.filter((u) => String(u.id) !== String(id));
      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 200);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405);
  } catch (err) {
    // أي استثناء -> 500 برسالة واضحة (بدلاً من 502 غامضة)
    return json({ ok: false, error: err.message }, 500);
  }
};
