// netlify/functions/users.js
import { getStore } from "@netlify/blobs";

// تحويل بين pass/password مع حفظ Base64
function toBase64(s) {
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "utf8").toString("base64");
}
function fromBase64(s) {
  try { return typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("utf8"); }
  catch { return ""; }
}

// قراءة seed من الملف المنشور (للتشغيل الأول فقط)
async function readSeedFromPublic() {
  try {
    // Netlify Functions لا ترى ملفات public كمسار نسبي؛ لكن أثناء الـ build تُنسخ.
    // نحاول القراءة بالمسار المطلق داخل الحزمة إذا توفّر، وإلا نتجاهل.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    // عادةً يوضَع الكود داخل /var/task/ أو /opt/build/repo … لذلك نحاول عدّة احتمالات
    const candidates = [
      path.resolve("public/users.json"),
      "/var/task/public/users.json",
      "/opt/build/repo/public/users.json",
    ];
    for (const p of candidates) {
      try {
        const buf = await fs.readFile(p, "utf8");
        const data = JSON.parse(buf);
        if (Array.isArray(data)) return data;
      } catch {}
    }
  } catch {}
  return null;
}

export default async (req) => {
  const store = getStore("users");
  const method = req.method || "GET";

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

  try {
    let users = (await store.get("users.json", { type: "json" })) || [];

    // تشغيل أول: لو فاضي نحاول نقرأ seed من public/users.json
    if (!Array.isArray(users) || users.length === 0) {
      const seed = await readSeedFromPublic();
      if (Array.isArray(seed) && seed.length) {
        users = seed;
        await store.set("users.json", JSON.stringify(users));
      } else {
        users = [];
      }
    }

    const findById = (id) => users.find((u) => String(u.id) === String(id));
    const findByUsername = (username) =>
      users.find((u) => (u.username || "").trim().toLowerCase() === (username || "").trim().toLowerCase());

    if (method === "GET") {
      // دعم بحث بسيط بالاسم/البريد/الدور
      const url = new URL(req.url);
      const q = (url.searchParams.get("search") || "").toLowerCase();
      const filtered = q
        ? users.filter((u) => {
            const hay = [u.username, u.email, u.role].map((v) => String(v || "").toLowerCase()).join(" ");
            return hay.includes(q);
          })
        : users;

      return json({ ok: true, users: filtered });
    }

    if (method === "POST") {
      const body = await req.json();
      const username = (body.username || "").trim();
      const email = (body.email || "").trim();
      const role = (body.role || "user").trim();
      // يقبل pass أو password
      const rawPass = body.pass ? fromBase64(body.pass) : (body.password || "");
      if (!username || !rawPass) return json({ ok: false, error: "البيانات ناقصة" }, 400);

      // لو موجود بنفس الاسم نرجّع خطأ
      if (findByUsername(username)) return json({ ok: false, error: "اسم المستخدم موجود مسبقاً" }, 409);

      const node = {
        id: Date.now().toString(),
        username,
        email,
        role,
        pass: toBase64(rawPass), // نخزّن كـ pass (Base64) لتوافق الواجهة الحالية
      };
      users.push(node);
      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 201);
    }

    if (method === "PUT") {
      const body = await req.json();
      const { id } = body || {};
      if (!id) return json({ ok: false, error: "id مفقود" }, 400);

      const node = findById(id);
      if (!node) return json({ ok: false, error: "المستخدم غير موجود" }, 404);

      // منع تكرار الاسم
      if (body.username) {
        const dup = findByUsername(body.username);
        if (dup && String(dup.id) !== String(id)) {
          return json({ ok: false, error: "اسم المستخدم مستخدم بالفعل" }, 409);
        }
      }

      if (body.username != null) node.username = String(body.username).trim();
      if (body.email != null) node.email = String(body.email).trim();
      if (body.role != null) node.role = String(body.role).trim();

      // يقبل pass(Base64) أو password(نص واضح)
      if (typeof body.pass === "string" && body.pass !== "") {
        node.pass = body.pass; // يفترض Base64 جاهز
      } else if (typeof body.password === "string" && body.password !== "") {
        node.pass = toBase64(body.password);
      }

      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 200);
    }

    if (method === "DELETE") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      const before = users.length;
      users = users.filter((u) => String(u.id) !== String(id));
      if (users.length === before) return json({ ok: false, error: "المستخدم غير موجود" }, 404);
      await store.set("users.json", JSON.stringify(users));
      return json({ ok: true, users }, 200);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405);
  } catch (err) {
    console.error("users.js error:", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
