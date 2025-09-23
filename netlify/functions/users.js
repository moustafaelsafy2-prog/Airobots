// netlify/functions/users.js
// CRUD + Search/Pagination (اختياري) مع Netlify Blobs مفعّل عبر env

import { getStore } from "@netlify/blobs";

/* ====== إعداد مخزن الـ Blobs مع مفاتيح البيئة ====== */
function makeStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;

  // إن لم تُضبط البيئة، أعطِ رسالة مفهومة بدل 502
  if (!siteID || !token) {
    throw new Error(
      "Netlify Blobs غير مُفعّلة: يُرجى ضبط NETLIFY_SITE_ID و NETLIFY_BLOBS_TOKEN في Environment Variables."
    );
  }

  return getStore("users", { siteID, token });
}

/* ====== أدوات مساعدة ====== */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });

/* ترقيم صفحات اختياري مع الحفاظ على التوافق */
function paginate(list, page, limit) {
  const p = Math.max(1, Number(page) || 0);
  const L = Math.max(1, Number(limit) || 0);
  if (!p || !L) return { mode: "raw", data: list }; // لا توجد معلمات — أعد القائمة كما هي (توافق قديم)

  const start = (p - 1) * L;
  const data = list.slice(start, start + L);
  return { mode: "paged", data, meta: { page: p, total: list.length, limit: L } };
}

export default async (req) => {
  // دعم طلبات الـ OPTIONS (Preflight)
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS_HEADERS });

  let store;
  try {
    store = makeStore();
  } catch (e) {
    return json(500, { ok: false, error: e.message });
  }

  try {
    const method = req.method || "GET";
    let users = (await store.get("users.json", { type: "json" })) || [];

    // توابع مساعدة
    const byId = (id) => users.find((u) => String(u.id) === String(id));
    const byUsername = (username) =>
      users.find(
        (u) =>
          (u.username || "").trim().toLowerCase() ===
          (username || "").trim().toLowerCase()
      );

    /* ================== GET ================== */
    if (method === "GET") {
      const url = new URL(req.url);
      const q = (url.searchParams.get("search") || "").trim().toLowerCase();
      const page = url.searchParams.get("page");
      const limit = url.searchParams.get("limit");

      let list = users;

      // بحث اختياري
      if (q) {
        list = list.filter((u) => {
          const hay = [
            u.username,
            u.email,
            u.role,
            u.id,
          ]
            .map((v) => String(v || "").toLowerCase())
            .join(" ");
          return hay.includes(q);
        });
      }

      const pg = paginate(list, page, limit);
      if (pg.mode === "raw") {
        // التوافق القديم: أعد { ok, users }
        return json(200, { ok: true, users: list });
      }
      // شكل متوافق مع لوحة الأدمن ذات الترقيم
      return json(200, {
        ok: true,
        data: pg.data,
        page: pg.meta.page,
        total: pg.meta.total,
        limit: pg.meta.limit,
      });
    }

    /* ================== POST (إضافة/تحديث بالاسم إن وجد) ================== */
    if (method === "POST") {
      const body = await req.json();
      const { username, password, email = "", role = "مستخدم" } = body || {};
      if (!username || !password) return json(400, { ok: false, error: "البيانات ناقصة" });

      const existing = byUsername(username);
      if (existing) {
        // تحديث السجل الموجود بنفس الاسم (منع ازدواجية)
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
      return json(201, { ok: true, users });
    }

    /* ================== PUT (تعديل بالسِّجل عبر id) ================== */
    if (method === "PUT") {
      const body = await req.json();
      const { id, username, email, role, password } = body || {};
      if (!id) return json(400, { ok: false, error: "id مفقود" });

      const node = byId(id);
      if (!node) return json(404, { ok: false, error: "المستخدم غير موجود" });

      // منع تكرار اسم المستخدم لغير هذا السجل
      if (username) {
        const dup = byUsername(username);
        if (dup && String(dup.id) !== String(id)) {
          return json(409, { ok: false, error: "اسم المستخدم مستخدم بالفعل" });
        }
      }

      if (username != null) node.username = username;
      if (email != null) node.email = email;
      if (role != null) node.role = role;
      if (password) node.password = btoa(password);

      await store.set("users.json", JSON.stringify(users));
      return json(200, { ok: true, users });
    }

    /* ================== DELETE ================== */
    if (method === "DELETE") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      if (!id) return json(400, { ok: false, error: "id مفقود" });

      const before = users.length;
      users = users.filter((u) => String(u.id) !== String(id));
      if (users.length === before) return json(404, { ok: false, error: "المستخدم غير موجود" });

      await store.set("users.json", JSON.stringify(users));
      return json(200, { ok: true, users });
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("Users function error:", err);
    return json(500, { ok: false, error: err.message || "Server error" });
  }
};
