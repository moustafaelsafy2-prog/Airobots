// netlify/functions/users.js
import { getStore } from "@netlify/blobs";

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }

  try {
    const store = getStore("users"); // namespace
    const method = event.httpMethod || "GET";

    let users = (await store.get("users.json", { type: "json" })) || [];
    const findById = (id) => users.find((u) => String(u.id) === String(id));
    const findByUsername = (username) =>
      users.find(
        (u) =>
          (u.username || "").trim().toLowerCase() ===
          (username || "").trim().toLowerCase()
      );

    if (method === "GET") {
      // دعم بحث بسيط وتقسيم صفحات اختياريًا
      const url = new URL(event.rawUrl || `https://x${event.path}?${event.queryStringParameters || ""}`);
      const q = (url.searchParams.get("search") || "").trim().toLowerCase();
      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);

      let data = users;
      if (q) {
        data = users.filter((u) => {
          const hay = [u.username, u.email, u.role]
            .map((x) => String(x || "").toLowerCase())
            .join(" ");
          return hay.includes(q);
        });
      }

      const total = data.length;
      const start = (page - 1) * limit;
      const slice = data.slice(start, start + limit);

      return json(200, { ok: true, data: slice, page, limit, total });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { username, password, email = "", role = "مستخدم" } = body || {};
      if (!username || !password) return json(400, { ok: false, error: "البيانات ناقصة" });

      const existing = findByUsername(username);
      if (existing) {
        // حدّث الموجود لمنع التكرار
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
          createdAt: new Date().toISOString()
        });
      }

      await store.set("users.json", JSON.stringify(users));
      return json(201, { ok: true, users });
    }

    if (method === "PUT") {
      const body = JSON.parse(event.body || "{}");
      const { id, username, email, role, password } = body || {};
      if (!id) return json(400, { ok: false, error: "id مفقود" });

      const node = findById(id);
      if (!node) return json(404, { ok: false, error: "المستخدم غير موجود" });

      if (username) {
        const dup = findByUsername(username);
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

    if (method === "DELETE") {
      const url = new URL(event.rawUrl || `https://x${event.path}?${event.queryStringParameters || ""}`);
      const id = url.searchParams.get("id");
      users = users.filter((u) => String(u.id) !== String(id));
      await store.set("users.json", JSON.stringify(users));
      return json(200, { ok: true, users });
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("users function error:", err);
    return json(500, { ok: false, error: err.message || "server error" });
  }
};
