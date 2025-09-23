// public/admin-sync.js
// ربط admin.html بواجهة Netlify Functions + Blobs وحلّ مشكلة عدم الحفظ

(function () {
  const API = '/.netlify/functions/users';

  // كاش محلي للعرض
  let USERS_CACHE = [];
  // نحفظ الـ id الجاري تعديله داخل الـ modal
  let EDIT_ID = null;

  // عناصر DOM
  const tbody = () => document.querySelector('#users-table tbody');
  const modal = () => document.getElementById('modal');
  const mUser = () => document.getElementById('m_username');
  const mMail = () => document.getElementById('m_email');
  const mPass = () => document.getElementById('m_pass');
  const mRole = () => document.getElementById('m_role');
  const btnSave = () => document.getElementById('save-user');
  const btnAdd  = () => document.getElementById('add-user-btn');
  const btnCancel = () => document.getElementById('cancel-user');
  const modalTitle = () => document.getElementById('modal-title');

  // ---- API helpers ----
  async function api(method, path = '', body) {
    const res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data.ok) throw new Error(data.msg || ('HTTP ' + res.status));
    return data;
  }

  async function fetchAll() {
    const { users } = await api('GET');
    USERS_CACHE = Array.isArray(users) ? users : [];
    // كاش احتياطي في المتصفح
    localStorage.setItem('app_users', JSON.stringify(USERS_CACHE));
    return USERS_CACHE;
  }

  // ---- UI helpers ----
  async function renderUsers() {
    const list = await fetchAll();
    const body = tbody();
    if (!body) return;
    body.innerHTML = '';
    list.forEach((u, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.username}</td>
        <td>${u.email || ''}</td>
        <td>${u.role || 'مستخدم'}</td>
        <td>
          <button data-i="${i}" class="btn-edit">✏️ تعديل</button>
          <button data-i="${i}" class="btn-del">🗑️ حذف</button>
        </td>
      `;
      body.appendChild(tr);
    });

    // ربط أزرار التعديل والحذف
    body.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.getAttribute('data-i');
        const u = USERS_CACHE[i];
        if (!u) return;
        EDIT_ID = u.id; // حدد id الجاري تعديله
        modalTitle().textContent = 'تعديل مستخدم';
        mUser().value = u.username || '';
        mMail().value = u.email || '';
        mPass().value = u.pass || '';
        mRole().value = u.role || 'مستخدم';
        modal().classList.remove('hidden');
      });
    });

    body.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const i = +btn.getAttribute('data-i');
        const u = USERS_CACHE[i];
        if (!u) return;
        if (!confirm('هل تريد حذف هذا المستخدم؟')) return;
        await api('DELETE', '?id=' + encodeURIComponent(u.id));
        await renderUsers();
      });
    });
  }

  function wireModal() {
    // زر "إضافة مستخدم" — يفتح المودال لوضع إضافة
    if (btnAdd()) {
      btnAdd().addEventListener('click', () => {
        EDIT_ID = null;
        modalTitle().textContent = 'إضافة مستخدم';
        mUser().value = '';
        mMail().value = '';
        mPass().value = '';
        mRole().value = 'مستخدم';
        modal().classList.remove('hidden');
        mUser().focus();
      });
    }

    // زر إلغاء
    if (btnCancel()) {
      btnCancel().addEventListener('click', () => {
        modal().classList.add('hidden');
      });
    }

    // زر حفظ — اعتراض مباشر، لا نعتمد على setUsers/getUsers الخاصة بالصفحة
    if (btnSave()) {
      btnSave().addEventListener('click', async () => {
        const username = (mUser().value || '').trim();
        const email    = (mMail().value || '').trim();
        const pass     = mPass().value || '';
        const role     = (mRole().value || 'مستخدم').trim();

        if (!username || !pass) {
          alert('⚠️ يجب إدخال اسم المستخدم وكلمة المرور');
          return;
        }

        try {
          if (EDIT_ID) {
            // تحديث عنصر موجود
            await api('PUT', '', { id: EDIT_ID, username, email, pass, role });
          } else {
            // إنشاء جديد
            await api('POST', '', { username, email, pass, role });
          }
          modal().classList.add('hidden');
          await renderUsers();
        } catch (err) {
          alert('تعذر الحفظ: ' + (err.message || 'خطأ غير معروف'));
        }
      });
    }
  }

  // ---- init ----
  document.addEventListener('DOMContentLoaded', async () => {
    // اجبر المودال أن يكون مغلق عند التحميل
    if (modal()) modal().classList.add('hidden');
    // اربط الأحداث
    wireModal();
    // اعرض القائمة
    try {
      await renderUsers();
    } catch (e) {
      console.error(e);
      // fallback: لو الوظيفة غير متوفرة (أثناء أول نشر) أعرض من localStorage
      const body = tbody();
      if (body) body.innerHTML = '<tr><td colspan="4">تعذر الاتصال بالوظيفة. تأكد من نشر netlify/functions/users.js</td></tr>';
    }
  });
})();
