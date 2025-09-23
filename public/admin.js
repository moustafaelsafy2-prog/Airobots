/*! @file public/admin.js
 *  @version 2.0.0
 *  @updated 2025-09-23
 *  @owner Mustafa
 *  @notes: لوحة تحكم الأدمن — تسجيل الدخول، CRUD للمستخدمين، بحث، فرز، تصدير CSV
 */

// ==================== عناصر DOM ====================
const loginBox     = document.getElementById("login-box");
const loginForm    = document.getElementById("login-form");
const loginMsg     = document.getElementById("login-msg");
const adminPanel   = document.getElementById("admin-panel");
const logoutBtn    = document.getElementById("logout-btn");

const usersTable   = document.querySelector("#users-table tbody");
const searchInput  = document.getElementById("q");
const roleFilter   = document.getElementById("roleFilter");
const exportCsvBtn = document.getElementById("exportCsv");
const addUserBtn   = document.getElementById("add-user-btn");

// نافذة تعديل/إضافة
const modal        = document.getElementById("modal");
const modalTitle   = document.getElementById("modal-title");
const mUsername    = document.getElementById("m_username");
const mEmail       = document.getElementById("m_email");
const mPass        = document.getElementById("m_pass");
const mRole        = document.getElementById("m_role");
const saveBtn      = document.getElementById("save-user");
const cancelBtn    = document.getElementById("cancel-user");

// بيانات الحالة
let token   = localStorage.getItem("adminToken") || null;
let editingId = null;

// ==================== أدوات مساعدة ====================
function toast(msg, type = "ok") {
  const box = document.getElementById("toasts");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.style.borderColor = type === "err" ? "#dc2626" : "#10b981";
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`/api/${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "فشل الطلب");
  }
  return res.json();
}

// ==================== تسجيل الدخول/الخروج ====================
loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("admin-user").value.trim();
  const password = document.getElementById("admin-pass").value;

  try {
    const data = await api("admin-auth", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    token = data.token;
    localStorage.setItem("adminToken", token);
    loginBox.classList.add("hidden");
    adminPanel.classList.remove("hidden");
    toast("✅ تم تسجيل الدخول بنجاح");
    loadUsers();
  } catch (err) {
    loginMsg.textContent = "❌ اسم المستخدم أو كلمة المرور غير صحيحة";
    console.error(err);
  }
});

logoutBtn?.addEventListener("click", () => {
  token = null;
  localStorage.removeItem("adminToken");
  adminPanel.classList.add("hidden");
  loginBox.classList.remove("hidden");
  toast("🚪 تم تسجيل الخروج");
});

// ==================== إدارة المستخدمين ====================
async function loadUsers() {
  try {
    const users = await api("users");
    renderUsers(users);
  } catch (err) {
    console.error(err);
    toast("⚠️ فشل تحميل المستخدمين", "err");
  }
}

function renderUsers(users) {
  usersTable.innerHTML = "";
  users.forEach((u) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.username}</td>
      <td>${u.email || ""}</td>
      <td>${u.role || "مستخدم"}</td>
      <td class="row-actions">
        <button class="btn-ghost" onclick="editUser('${u.id}')">✏️ تعديل</button>
        <button class="btn-ghost" onclick="deleteUser('${u.id}')">🗑️ حذف</button>
      </td>
    `;
    usersTable.appendChild(tr);
  });
}

// إضافة مستخدم
addUserBtn?.addEventListener("click", () => {
  editingId = null;
  modalTitle.textContent = "إضافة مستخدم";
  mUsername.value = "";
  mEmail.value = "";
  mPass.value = "";
  mRole.value = "مستخدم";
  modal.classList.remove("hidden");
});

saveBtn?.addEventListener("click", async () => {
  const user = {
    username: mUsername.value.trim(),
    email: mEmail.value.trim(),
    password: mPass.value,
    role: mRole.value.trim() || "مستخدم",
  };

  if (!user.username || !user.password) {
    alert("⚠️ يجب إدخال اسم المستخدم وكلمة المرور");
    return;
  }

  try {
    if (editingId) {
      await api("users", {
        method: "PUT",
        body: JSON.stringify({ id: editingId, ...user }),
      });
      toast("✏️ تم تحديث المستخدم");
    } else {
      await api("users", { method: "POST", body: JSON.stringify(user) });
      toast("➕ تم إضافة المستخدم");
    }
    modal.classList.add("hidden");
    loadUsers();
  } catch (err) {
    console.error(err);
    toast(err.message, "err");
  }
});

cancelBtn?.addEventListener("click", () => modal.classList.add("hidden"));

// تعديل مستخدم
window.editUser = async function (id) {
  try {
    const users = await api("users");
    const u = users.find((x) => x.id === id);
    if (!u) return;
    editingId = id;
    modalTitle.textContent = "تعديل مستخدم";
    mUsername.value = u.username;
    mEmail.value = u.email || "";
    mPass.value = "";
    mRole.value = u.role || "مستخدم";
    modal.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    toast("⚠️ لم يتم العثور على المستخدم", "err");
  }
};

// حذف مستخدم
window.deleteUser = async function (id) {
  if (!confirm("هل تريد حذف هذا المستخدم؟")) return;
  try {
    await api(`users?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("🗑️ تم حذف المستخدم");
    loadUsers();
  } catch (err) {
    console.error(err);
    toast(err.message, "err");
  }
};

// ==================== البحث والتصفية والتصدير ====================
searchInput?.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  filterUsers(q, roleFilter.value);
});
roleFilter?.addEventListener("change", () => {
  filterUsers(searchInput.value.trim().toLowerCase(), roleFilter.value);
});

function filterUsers(q, role) {
  api("users")
    .then((users) => {
      let f = users.filter((u) => {
        const hay = [u.username, u.email, u.role].join(" ").toLowerCase();
        return (!q || hay.includes(q)) && (!role || u.role === role);
      });
      renderUsers(f);
    })
    .catch((err) => {
      console.error(err);
      toast("⚠️ فشل البحث", "err");
    });
}

exportCsvBtn?.addEventListener("click", async () => {
  try {
    const users = await api("users");
    if (!users.length) {
      toast("⚠️ لا يوجد بيانات للتصدير", "err");
      return;
    }
    const head = ["username", "email", "role"];
    const rows = users.map((u) =>
      [u.username, u.email || "", u.role || "مستخدم"].map((x) =>
        `"${String(x).replace(/"/g, '""')}"`
      )
    );
    const csv = [head.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("⬇️ تم تصدير CSV");
  } catch (err) {
    console.error(err);
    toast("⚠️ فشل التصدير", "err");
  }
});

// ==================== عند تحميل الصفحة ====================
window.addEventListener("DOMContentLoaded", () => {
  if (token) {
    loginBox.classList.add("hidden");
    adminPanel.classList.remove("hidden");
    loadUsers();
  }
});
