// netlify/functions/users.js
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(__dirname, "../../public/users.json");

// helpers
async function loadUsers() {
  try {
    const raw = await fs.readFile(dataFile, "utf-8");
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}
async function saveUsers(users) {
  await fs.writeFile(dataFile, JSON.stringify(users, null, 2), "utf-8");
}

export default async (req) => {
  const method = req.method || "GET";

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });

  try {
    let users = await loadUsers();

    const findById = (id) => users.find((u) => String(u.id) === String(id));
    const findByUsername = (username) =>
      users.find(
        (u) =>
          (u.username || "").trim().toLowerCase() ===
          (username || "").trim().toLowerCase()
      );

    if (method === "GET") {
      return json({ ok: true, users });
    }

    if (method === "POST") {
      const body = await req.json();
      const { username, password, email = "", role = "مستخدم" } = body || {};
      if (!username || !password)
        return json({ ok: false, error: "البيانات ناقصة" }, 400);

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
        });
      }

      await saveUsers(users);
      return json({ ok: true, users }, 201);
    }

    if (method === "PUT") {
      const body = await req.json();
      const { id, username, email, role, password } = body || {};
      if (!id) return json({ ok: false, error: "id مفقود" }, 400);

      const node = findById(id);
      if (!node) return json({ ok: false, error: "المستخدم غير موجود" }, 404);

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

      await saveUsers(users);
      return json({ ok: true, users }, 200);
    }

    if (method === "DELETE") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      users = users.filter((u) => String(u.id) !== String(id));
      await saveUsers(users);
      return json({ ok: true, users }, 200);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405);
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
