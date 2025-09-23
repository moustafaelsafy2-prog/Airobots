import { getStore } from "@netlify/blobs";

function json(status, data) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    },
    body: JSON.stringify(data)
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});

  try {
    const store = getStore("users");
    let users = (await store.get("users.json", { type: "json" })) || [];

    if (event.httpMethod === "GET") {
      return json(200, { ok: true, users });
    }

    if (event.httpMethod === "POST") {
      const { username, password, email = "", role = "مستخدم" } = JSON.parse(event.body || "{}");
      if (!username || !password) return json(400, { ok: false, error: "بيانات ناقصة" });

      users.push({
        id: Date.now().toString(),
        username,
        email,
        role,
        password: btoa(password),
        createdAt: new Date().toISOString()
      });
      await store.set("users.json", JSON.stringify(users));
      return json(201, { ok: true });
    }

    if (event.httpMethod === "PUT") {
      const { id, username, email, role, password } = JSON.parse(event.body || "{}");
      const user = users.find((u) => u.id === id);
      if (!user) return json(404, { ok: false, error: "غير موجود" });

      if (username) user.username = username;
      if (email) user.email = email;
      if (role) user.role = role;
      if (password) user.password = btoa(password);

      await store.set("users.json", JSON.stringify(users));
      return json(200, { ok: true });
    }

    if (event.httpMethod === "DELETE") {
      const id = event.queryStringParameters?.id;
      users = users.filter((u) => u.id !== id);
      await store.set("users.json", JSON.stringify(users));
      return json(200, { ok: true });
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("users.js error:", err);
    return json(500, { ok: false, error: err.message });
  }
};
