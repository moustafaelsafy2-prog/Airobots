import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const store = getStore("users");
  const { method } = req;

  try {
    if (method === "GET") {
      const users = (await store.get("users.json", { type: "json" })) || [];
      return Response.json({ ok: true, users });
    }

    if (method === "POST") {
      const body = await req.json();
      const users = (await store.get("users.json", { type: "json" })) || [];
      body.id = Date.now().toString();
      users.push(body);
      await store.set("users.json", JSON.stringify(users));
      return Response.json({ ok: true, users });
    }

    if (method === "PUT") {
      const body = await req.json();
      let users = (await store.get("users.json", { type: "json" })) || [];
      users = users.map(u => (u.id === body.id ? { ...u, ...body } : u));
      await store.set("users.json", JSON.stringify(users));
      return Response.json({ ok: true, users });
    }

    if (method === "DELETE") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      let users = (await store.get("users.json", { type: "json" })) || [];
      users = users.filter(u => u.id !== id);
      await store.set("users.json", JSON.stringify(users));
      return Response.json({ ok: true, users });
    }

    return new Response("Method Not Allowed", { status: 405 });
  } catch (err) {
    return Response.json({ ok: false, msg: err.message }, { status: 500 });
  }
};
