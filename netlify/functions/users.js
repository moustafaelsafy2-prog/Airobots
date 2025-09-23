// netlify/functions/users.js
import { getStore } from "@netlify/blobs";

export default async function handler(req, res) {
  const store = getStore("users"); // خزن باسم users
  let users = [];

  try {
    const existing = await store.get("users.json", { type: "json" });
    if (existing) users = existing;
  } catch (err) {
    console.error("❌ خطأ في قراءة المستخدمين:", err);
  }

  // --- التعامل مع الميثود ---
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, users });
  }

  if (req.method === "POST") {
    try {
      const body = JSON.parse(req.body);

      if (!body.username || !body.password) {
        return res.status(400).json({ ok: false, error: "يجب إدخال اسم مستخدم وكلمة مرور" });
      }

      const newUser = {
        id: Date.now(),
        username: body.username,
        email: body.email || "",
        role: body.role || "مستخدم",
        password: btoa(body.password), // تخزين مبسط Base64
      };

      users.push(newUser);

      await store.setJSON("users.json", users);

      return res.status(201).json({ ok: true, user: newUser });
    } catch (err) {
      console.error("❌ خطأ عند إضافة المستخدم:", err);
      return res.status(500).json({ ok: false, error: "خطأ في إضافة المستخدم" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const body = JSON.parse(req.body);
      users = users.filter(u => u.id !== body.id);

      await store.setJSON("users.json", users);

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("❌ خطأ عند الحذف:", err);
      return res.status(500).json({ ok: false, error: "خطأ في الحذف" });
    }
  }

  return res.status(405).json({ ok: false, error: "Method Not Allowed" });
}
