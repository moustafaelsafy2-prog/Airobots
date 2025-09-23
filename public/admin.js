/*! @file public/admin.js
 *  @version 1.0.0
 *  @updated 2025-09-23
 *  @owner Mustafa
 *  @notes: منطق لوحة تحكم الأدمن — تسجيل الدخول، CRUD، البحث، وتصفح المستخدمين
 */

const loginSection = document.getElementById("login-section");
const loginForm = document.getElementById("login-form");
const loginUsername = document.getElementById("login-username");
const loginPassword = document.getElementById("login-password");

const adminSection = document.getElementById("admin-section");
const logoutBtn = document.getElementById("logout-btn");

const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const addUserForm = document.getElementById("add-user-form");
const newUsername = document.getElementById("new-username");
const newPassword = document.getElementById("new-password");

const usersTable = document.getElementById("users-table");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");
const pageInfo = document.getElementById("page-info");

let token = localStorage.getItem("adminToken") || null;
let currentPage = 1;
const limit = 5;

// 🔐 تسجيل الدخول
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: loginUsername.value,
        password: loginPassword.value,
      }),
    });

    if (!res.ok) throw new Error("فشل تسجيل الدخول");
    const data = await res.json();
    token = data.token;
    localStorage.setItem("adminToken", token);

    loginSection.classList.add("hidden");
    adminSection.classList.remove("hidden");
    loadUsers();
  } catch (err) {
    alert("⚠️ اسم المستخدم أو كلمة المرور غير صحيحة");
    console.error(err);
  }
});

// 🚪 تسجيل الخروج
logoutBtn.addEventListener("click", () => {
  token = null;
  localStorage.removeItem("adminToken");
  adminSection.classList.add("hidden");
  loginSection.classList.remove("hidden");
});

// 📥 تحميل المستخدمين
async function loadUsers(search = "", page = 1) {
  try {
    const res = await fetch(
      `/api/users?search=${encodeURIComponent(search)}&page=${page}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error("فشل تحميل المستخدمين");

    const data = await res.json();
    renderUsers(data.data);
    renderPagination(data.page, data.total, data.limit);
  } catch (err) {
    console.error(err);
    alert("⚠️ فشل تحميل المستخدمين");
  }
}

// 📋 عرض المستخدمين في الجدول
function renderUsers(users) {
  usersTable.innerHTML = "";
  users.forEach((user) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td class="border p-2 text-sm">${user.id}</td>
      <td class="border p-2">${user.username}</td>
      <td class="border p-2 text-sm">${new Date(user.createdAt).toLocaleString()}</td>
      <td class="border p-2 flex gap-2">
        <button class="bg-yellow-500 text-white px-2 py-1 rounded text-sm hover:bg-yellow-600"
          onclick="editUser('${user.id}', '${user.username}')">تعديل</button>
        <button class="bg-red-600 text-white px-2 py-1 rounded text-sm hover:bg-red-700"
          onclick="deleteUser('${user.id}')">حذف</button>
      </td>
    `;
    usersTable.appendChild(row);
  });
}

// 📑 عرض أزرار التصفح
function renderPagination(page, total, limit) {
  currentPage = page;
  const totalPages = Math.ceil(total / limit);
  pageInfo.textContent = `صفحة ${page} من ${totalPages}`;

  prevPageBtn.disabled = page <= 1;
  nextPageBtn.disabled = page >= totalPages;
}

prevPageBtn.addEventListener("click", () => {
  if (currentPage > 1) {
    loadUsers(searchInput.value, currentPage - 1);
  }
});
nextPageBtn.addEventListener("click", () => {
  loadUsers(searchInput.value, currentPage + 1);
});

// ➕ إضافة مستخدم
addUserForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        username: newUsername.value,
        password: newPassword.value,
      }),
    });
    if (!res.ok) throw new Error("فشل إضافة المستخدم");

    newUsername.value = "";
    newPassword.value = "";
    loadUsers();
  } catch (err) {
    console.error(err);
    alert("⚠️ فشل إضافة المستخدم");
  }
});

// ✏️ تعديل مستخدم
async function editUser(id, currentName) {
  const newName = prompt("أدخل اسم المستخدم الجديد:", currentName);
  if (!newName) return;

  const newPass = prompt("أدخل كلمة مرور جديدة (أو اتركها فارغة):");

  try {
    const res = await fetch("/api/users", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id, username: newName, password: newPass || undefined }),
    });
    if (!res.ok) throw new Error("فشل تعديل المستخدم");

    loadUsers(searchInput.value, currentPage);
  } catch (err) {
    console.error(err);
    alert("⚠️ فشل تعديل المستخدم");
  }
}

// 🗑️ حذف مستخدم
async function deleteUser(id) {
  if (!confirm("هل أنت متأكد أنك تريد حذف هذا المستخدم؟")) return;

  try {
    const res = await fetch(`/api/users?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("فشل حذف المستخدم");

    loadUsers(searchInput.value, currentPage);
  } catch (err) {
    console.error(err);
    alert("⚠️ فشل حذف المستخدم");
  }
}

// 🔍 البحث
searchBtn.addEventListener("click", () => {
  loadUsers(searchInput.value, 1);
});

// ✅ عند تحميل الصفحة تحقق من وجود جلسة
window.addEventListener("DOMContentLoaded", () => {
  if (token) {
    loginSection.classList.add("hidden");
    adminSection.classList.remove("hidden");
    loadUsers();
  }
});
