// netlify/functions/users.js
// تخزين المستخدمين في Netlify Blobs (بدون قاعدة بيانات خارجية)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // تحميل واجهة Blobs وقت التنفيذ (Esm داخل وظيفة CJS)
  const { getStore } = await import('netlify:blobs');
  const store = getStore('users_store'); // namespace

  const readAll = async () => {
    const data = await store.get('users.json', { type: 'json' });
    return Array.isArray(data) ? data : [];
  };
  const writeAll = async (arr) => {
    await store.setJSON('users.json', arr || []);
    return arr || [];
  };

  const json = (code, obj) => ({
    statusCode: code,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify(obj)
  });

  try {
    switch (event.httpMethod) {
      // قراءة
      case "GET": {
        const list = await readAll();
        return json(200, { ok: true, users: list });
      }

      // إنشاء مستخدم
      case "POST": {
        const body = JSON.parse(event.body || "{}");
        const { username, email = "", pass = "", role = "مستخدم", notes = "" } = body;

        if (!username || !pass) return json(400, { ok: false, msg: "username & pass required" });

        const list = await readAll();
        const exists = list.some(u => (u.username || "").toLowerCase() === username.toLowerCase());
        if (exists) return json(409, { ok: false, msg: "username exists" });

        const id = "u_" + Math.random().toString(36).slice(2, 9);
        list.unshift({ id, username, email, pass, role, notes, createdAt: Date.now() });
        await writeAll(list);
        return json(201, { ok: true, user: { id, username } });
      }

      // تحديث مجمّع (Bulk) أو عنصر واحد
      case "PUT": {
        const body = JSON.parse(event.body || "{}");

        // تحديث كامل المصفوفة (bulk) — يستخدمها admin-sync
        if (Array.isArray(body.bulk)) {
          await writeAll(body.bulk);
          return json(200, { ok: true, count: body.bulk.length });
        }

        // أو تحديث عنصر محدد
        const { id, username, email, pass, role, notes } = body;
        if (!id) return json(400, { ok: false, msg: "id required" });

        const list = await readAll();
        const idx = list.findIndex(u => u.id === id);
        if (idx === -1) return json(404, { ok: false, msg: "not found" });

        list[idx] = { ...list[idx], username, email, pass, role, notes, updatedAt: Date.now() };
        await writeAll(list);
        return json(200, { ok: true, user: list[idx] });
      }

      // حذف
      case "DELETE": {
        const q = event.queryStringParameters || {};
        const id = q.id;
        if (!id) return json(400, { ok: false, msg: "id query required" });

        const list = await readAll();
        const next = list.filter(u => u.id !== id);
        await writeAll(next);
        return json(200, { ok: true, removed: list.length - next.length });
      }

      default:
        return json(405, { ok: false, msg: "Method Not Allowed" });
    }
  } catch (err) {
    return json(500, { ok: false, msg: err.message || "server error" });
  }
};
