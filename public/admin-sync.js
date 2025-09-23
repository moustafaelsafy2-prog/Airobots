// public/admin-sync.js
// متوافق مع الوظيفة الجديدة (POST يمنع التكرار، PUT يحدّث حسب id)
(function () {
  const API = "/.netlify/functions/users";

  let USERS = [];
  let EDIT_ID = null;

  // DOM
  const $tbody = () => document.querySelector("#users-table tbody");
  const $modal = () => document.getElementById("modal");
  const $title = () => document.getElementById("modal-title");
  const $u = () => document.getElementById("m_username");
  const $e = () => document.getElementById("m_email");
  const $p = () => document.getElementById("m_pass");
  const $r = () => document.getElementById("m_role");
  const $btnAdd = () => document.getElementById("add-user-btn");
  const $btnSave = () => document.getElementById("save-user");
  const $btnCancel = () => document.getElementById("cancel-user");

  // منع أي submit افتراضي محتمل
  document.addEventListener("submit", (ev) => ev.preventDefault(), true);

  async function api(method, path = "", body) {
    const res = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {}
    if (!res.ok || data.ok === false) {
      const msg = (data && (data.error || data.msg)) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function load() {
    const { users } = await api("GET");
    USERS = Array.isArray(users) ? users : [];
    localStorage.setItem("app_users", JSON.stringify(USERS));
    return USERS;
  }

  function atobSafe(s) {
    try {
      return atob(s || "");
    } catch (_) {
      return "";
    }
  }

  function openAdd() {
    EDIT_ID = null;
    $title().textContent = "إضافة مستخدم";
    $u().value = "";
    $e().value = "";
    $p().value = "";
    $r().value = "مستخدم";
    $modal().classList.remove("hidden");
    $u().focus();
  }

  function openEdit(u) {
    EDIT_ID = u.id;
    $title().textContent = "تعديل مستخدم";
    $u().value = u.username || "";
    $e().value = u.email || "";
    // لا نعرض كلمة مرور مفكوكة؛ اتركها فارغة ليحتفظ بالسابق إن لم تغيّرها
    $p().value = "";
    $r().value = u.role || "مستخدم";
    $modal().classList.remove("hidden");
  }

  function closeModal() {
    $modal().classList.add("hidden");
  }

  async function render() {
    await load();
    const body = $tbody();
    body.innerHTML = "";

    USERS.forEach((u, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${u.username || ""}</td>
        <td>${u.email || ""}</td>
        <td>${u.role || "مستخدم"}</td>
        <td>
          <button type="button" class="btn-edit" data-i="${i}">تعديل ✏️</button>
          <button type="button" class="btn-del"  data-i="${i}">حذف 🗑️</button>
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const u = USERS[+btn.dataset.i];
        if (u) openEdit(u);
      });
    });

    body.querySelectorAll(".btn-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const u = USERS[+btn.dataset.i];
        if (!u) return;
        if (!confirm("هل تريد حذف هذا المستخدم؟")) return;
        await api("DELETE", "?id=" + encodeURIComponent(u.id));
        await render();
      });
    });
  }

  function wire() {
    $btnAdd()?.addEventListener("click", openAdd);
    $btnCancel()?.addEventListener("click", closeModal);

    // تأكد أن زر الحفظ لا يطلق إلا Listener واحد
    $btnSave()?.replaceWith($btnSave().cloneNode(true));
    const btn = document.getElementById("save-user");

    btn.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();

        const username = ($u().value || "").trim();
        const email = ($e().value || "").trim();
        const password = $p().value || "";
        const role = ($r().value || "مستخدم").trim();

        if (!username) return alert("⚠️ اسم المستخدم إجباري");
        if (!EDIT_ID && !password) return alert("⚠️ كلمة المرور مطلوبة عند الإضافة");

        try {
          if (EDIT_ID) {
            await api("PUT", "", {
              id: EDIT_ID,
              username,
              email,
              role,
              // إن كانت فارغة لا نرسلها ليبقى القديم
              ...(password ? { password } : {}),
            });
          } else {
            await api("POST", "", { username, email, role, password });
          }
          closeModal();
          await render();
        } catch (err) {
          alert("تعذّر الحفظ: " + err.message);
        }
      },
      { once: false }
    );
  }

  document.addEventListener("DOMContentLoaded", async () => {
    wire();
    try {
      await render();
    } catch (e) {
      console.error(e);
      const body = $tbody();
      body.innerHTML =
        '<tr><td colspan="4">تعذر تحميل القائمة — تحقّق من وظيفة users.js</td></tr>';
    }
  });
})();
