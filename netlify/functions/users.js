// netlify/functions/users.js
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("users");
  const method = req.method || "GET";

  try {
    let users = (await store.get("users.json", { type: "json" })) || [];

    // === GET: قراءة المستخدمين ===
    if (method === "GET") {
      return new Response(JSON.stringify({ ok: true, users }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // === POST: إضافة مستخدم جديد ===
    if (method === "POST") {
      const body = await req.json();
      if (!body.username || !body.password) {
        return new Response(JSON.stringify({ ok: false, error: "البيانات ناقصة" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      body.id = Date.now().toString();
      body.password = btoa(body.password); // تشفير مبسط Base64
      users.push(body);

      await store.set("users.json", JSON.stringify(users));

      return new Response(JSON.stringify({ ok: true, users }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // === DELETE: حذف مستخدم ===
    if (method === "DELETE") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      users = users.filter((u) => u.id !== id);

      await store.set("users.json", JSON.stringify(users));

      return new Response(JSON.stringify({ ok: true, users }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // === ميثود غير مدعوم ===
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
