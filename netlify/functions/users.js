// netlify/functions/users.js
import { getStore } from "@netlify/blobs";

/**
 * Users API
 * ✅ GET:    ?search=...&page=1&limit=10
 * ✅ POST:   { username, password, email, role }
 * ✅ PUT:    { id, username?, email?, role?, password? }
 * ✅ DELETE: /api/users?id=123
 */
export default async (req) => {
  const store = getStore("users");
  const method = req.method || "GET";

  try {
    let users = (await store.get("users.json", { type: "json" })) || [];

    // --- Helpers ---
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

    // --- GET (with search + pagination) ---
    if (method === "GET") {
      const url = new URL(req.url);
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const page = parseInt(url.searchParams.get("page") || "1");
      const limit = parseInt(url.searchParams.get("limit") || "10");

      let filtered = users;
      if (search) {
        filtered = users.filter((u) => {
          const hay = `${u.username} ${u.email} ${u.role}`.toLowerCase();
          return hay.includes(search);
        });
      }

      const total = filtered.length;
      const start = (page - 1) * limit;
      const end = start + limit;
      const data = filtered.slice(start, end);

      return json({ ok: true, data, page, limit, total });
    }

    // --- POST (create / upsert by username) ---
    if (method === "POST") {
      const body = await req.json();
      const { username, password, email = "", role = "مستخدم" } = body || {};
      if (!username || !password)
        return json({ ok: false, error: "البيانات ناقصة" }, 400);

      let node = findByUsername(username);
      if (node) {
        node.email = email;
        node.role = role;
        node.password = btoa(password);
      } else {
        node = {
          id: Date.now().toString(),
          username,
          email,
          role,
          password: btoa(password),
          createdAt: new Date().toISOString(),
        };
        users.push(node);
      }

      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, data: node }, 201);
    }

    // --- PUT (update) ---
    if (method === "PUT") {
      const body = await req.json();
      const { id, username, email, role, password } = body || {};
      if (!id) return json({ ok: false, error: "id مفقود" }, 400);

      const node = findById(id);
      if (!node) return json({ ok: false, error: "المستخدم غير موجود" }, 404);

      // منع تكرار username
      if (username) {
        const dup = findByUsername(username);
        if (dup && String(dup.id) !== String(id)) {
          return json({ ok: false, error: "اسم المستخدم مستخدم بالفعل" }, 409);
        }
      }

      if (username != null) node.username = username;
      if (email != null) node.email = email;
      if (role != null) node.role = role;
      if (password) node.password = btoa(password);

      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, data: node }, 200);
    }

    // --- DELETE ---
    if (method === "DELETE") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      const before = users.length;
      users = users.filter((u) => String(u.id) !== String(id));
      if (users.length === before)
        return json({ ok: false, error: "المستخدم غير موجود" }, 404);

      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, id }, 200);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405);
  } catch (err) {
    console.error("❌ Users API error:", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
