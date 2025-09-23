// public/admin-sync.js
// يربط admin.html بـ Netlify Function لحفظ وقراءة المستخدمين عالميًا

(function () {
  const API = '/.netlify/functions/users';

  async function api(method, path = '', body) {
    const res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.msg || ('HTTP ' + res.status));
    return data;
  }

  // إذا وُجدت دوال admin.html نعيد تعريفها لتصبح سحابية
  function mount() {
    // استبدال getUsers لتقرأ من السحابة
    window.getUsers = async function () {
      const { users } = await api('GET');
      return Array.isArray(users) ? users : [];
    };

    // استبدال setUsers لتكتب المصفوفة كلها (bulk)
    window.setUsers = async function (arr) {
      await api('PUT', '', { bulk: arr });
    };

    // إعادة تعريف renderUsers إن كانت تعرفت محليًا على أنها متزامنة
    const tbody = document.querySelector('#users-table tbody');
    window.renderUsers = async function () {
      const users = await window.getUsers();
      tbody.innerHTML = '';
      users.forEach((user, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${user.username}</td>
          <td>${user.email || ''}</td>
          <td>${user.role || 'مستخدم'}</td>
          <td>
            <button onclick="editUser(${i})">✏️ تعديل</button>
            <button onclick="deleteUser(${i})">🗑️ حذف</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      // خزّن نسخة محلية ككاش (اختياري)
      localStorage.setItem('app_users', JSON.stringify(users));
    };

    // تعديل وظائف الحذف/التعديل لتتعامل مع الـ bulk
    const _editUser = window.editUser;
    const _deleteUser = window.deleteUser;

    window.deleteUser = async function (i) {
      const list = await window.getUsers();
      const target = list[i];
      if (!target) return;
      if (!confirm('هل تريد حذف هذا المستخدم؟')) return;
      await api('DELETE', '?id=' + encodeURIComponent(target.id));
      await window.renderUsers();
    };

    window.editUser = function (i) {
      // نعيد استخدام نافذتك كما هي (admin.html الأصلي يتكفل بفتح/حفظ)
      _editUser ? _editUser(i) : console.warn('editUser not found in admin.html');
    };
  }

  document.addEventListener('DOMContentLoaded', mount);
})();
