// netlify/functions/users.js
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("users");
  const method = req.method || "GET";

  try {
    let users = (await store.get("users.json", { type: "json" })) || [];

    if (method === "GET") {
      return json({ ok: true, users }, 200);
    }

    if (method === "POST") {
      const body = await req.json();
      if (!body.username || !body.password) return json({ ok:false, error:"البيانات ناقصة" }, 400);
      const node = {
        id: Date.now().toString(),
        username: body.username,
        email: body.email || '',
        role: body.role || 'مستخدم',
        password: btoa(body.password) // تخزين مبسّط
      };
      users.push(node);
      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 201);
    }

    if (method === "PUT") {
      const body = await req.json();
      if (!body.id) return json({ ok:false, error:"id مفقود" }, 400);
      users = users.map(u => u.id === body.id
        ? {
            ...u,
            username: body.username ?? u.username,
            email:    body.email ?? u.email,
            role:     body.role ?? u.role,
            password: body.password ? btoa(body.password) : u.password
          }
        : u
      );
      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 200);
    }

    if (method === "DELETE") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      users = users.filter(u => u.id !== id);
      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 200);
    }

    return json({ ok:false, error:"Method Not Allowed" }, 405);
  } catch (err) {
    return json({ ok:false, error: err.message }, 500);
  }
};

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
