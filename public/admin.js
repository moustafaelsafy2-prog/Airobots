/*! @file public/admin.js
 *  @version 2.0.1
 *  @updated 2025-09-24
 *  @owner Mustafa
 *  @notes: لوحة تحكم الأدمن — تسجيل الدخول، CRUD للمستخدمين، بحث، فرز، تصدير CSV (متوافق مع { ok, users })
 */

// ==================== عناصر DOM ====================
const loginBox     = document.getElementById("login-box");
const loginForm    = document.getElementById("login-form");   // قد لا يكون موجودًا في بعض القوالب
const loginBtnEl   = document.getElementById("login-btn");     // زر الدخول البديل
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
  // نسمح برسائل الخطأ النصّية أيضًا
  if (!res.ok) {
    let errMsg = "فشل الطلب";
    try { const err = await res.json(); errMsg = err.error || errMsg; } catch {}
    throw new Error(errMsg);
  }
  return res.json();
}

// تحويل عرض الدور لتوافق الفلتر والواجهات العربية
function displayRole(role) {
  if (!role) return "مستخدم";
  const s = String(role).toLowerCase();
  if (s === "user") return "مستخدم";
  if (s === "admin" || s === "مشرف") return "مشرف";
  return role; // أي قيمة مخصصة تبقى كما هي
}

// ==================== تسجيل الدخول/الخروج ====================
async function handleLogin(e) {
  e?.preventDefault?.();
  const uEl = document.getElementById("admin-user");
  const pEl = document.getElementById("admin-pass");
  const username = (uEl?.value || "").trim();
  const password = pEl?.value || "";

  try {
    const data = await api("admin-auth", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    token = data.token;
    localStorage.setItem("adminToken", token);
    loginBox?.classList.add("hidden");
    adminPanel?.classList.remove("hidden");
    toast("✅ تم تسجيل الدخول بنجاح");
    loadUsers();
  } catch (err) {
    if (loginMsg) loginMsg.textContent = "❌ اسم المستخدم أو كلمة المرور غير صحيحة";
    console.error(err);
  }
}

// يدعم نموذج أو زر
loginForm?.addEventListener("submit", handleLogin);
loginBtnEl?.addEventListener("click", handleLogin);

logoutBtn?.addEventListener("click", () => {
  token = null;
  localStorage.removeItem("adminToken");
  adminPanel?.classList.add("hidden");
  loginBox?.classList.remove("hidden");
  toast("🚪 تم تسجيل الخروج");
});

// ==================== إدارة المستخدمين ====================
async function loadUsers() {
  try {
    const payload = await api("users");
    const users = payload.users || payload; // دعم في حال رجع مصفوفة مباشرة
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
      <td>${displayRole(u.role)}</td>
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
    password: mPass.value,                  // الخادم يقبل password أو pass(Base64)
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
    const payload = await api("users");
    const users = payload.users || payload;
    const u = users.find((x) => x.id === id);
    if (!u) return;
    editingId = id;
    modalTitle.textContent = "تعديل مستخدم";
    mUsername.value = u.username;
    mEmail.value = u.email || "";
    mPass.value = "";                        // لا نملأ كلمة المرور
    mRole.value = displayRole(u.role);       // نعرضه بالعربية
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
  filterUsers(q, roleFilter?.value || "");
});
roleFilter?.addEventListener("change", () => {
  filterUsers(searchInput.value.trim().toLowerCase(), roleFilter.value);
});

function filterUsers(q, role) {
  api("users")
    .then((payload) => {
      const users = payload.users || payload;
      let f = users.filter((u) => {
        const hay = [u.username, u.email, displayRole(u.role)].join(" ").toLowerCase();
        return (!q || hay.includes(q)) && (!role || displayRole(u.role) === role);
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
    const payload = await api("users");
    const users = payload.users || payload;
    if (!users.length) {
      toast("⚠️ لا يوجد بيانات للتصدير", "err");
      return;
    }
    const head = ["username", "email", "role"];
    const rows = users.map((u) =>
      [u.username, u.email || "", displayRole(u.role)].map((x) =>
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
    loginBox?.classList.add("hidden");
    adminPanel?.classList.remove("hidden");
    loadUsers();
  }
});
