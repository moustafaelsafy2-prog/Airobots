// public/admin-sync.js
// متوافق مع netlify/functions/users.js (expects: username, email, password, role)

(function () {
  const API = '/.netlify/functions/users';

  let USERS = [];
  let EDIT_ID = null;

  // DOM helpers
  const $tbody = () => document.querySelector('#users-table tbody');
  const $modal = () => document.getElementById('modal');
  const $title = () => document.getElementById('modal-title');

  const $u = () => document.getElementById('m_username');
  const $e = () => document.getElementById('m_email');
  const $p = () => document.getElementById('m_pass');
  const $r = () => document.getElementById('m_role');

  const $btnAdd = () => document.getElementById('add-user-btn');
  const $btnSave = () => document.getElementById('save-user');
  const $btnCancel = () => document.getElementById('cancel-user');

  async function api(method, path = '', body) {
    const res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || data.ok === false) {
      const msg = (data && (data.error || data.msg)) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function load() {
    const { users } = await api('GET');
    USERS = Array.isArray(users) ? users : [];
    localStorage.setItem('app_users', JSON.stringify(USERS));
    return USERS;
  }

  function openAdd() {
    EDIT_ID = null;
    $title().textContent = 'إضافة مستخدم';
    $u().value = ''; $e().value = ''; $p().value = ''; $r().value = 'مستخدم';
    $modal().classList.remove('hidden');
    $u().focus();
  }

  function openEdit(u) {
    EDIT_ID = u.id;
    $title().textContent = 'تعديل مستخدم';
    $u().value = u.username || '';
    $e().value = u.email || '';
    // نعرض كلمة المرور كما هي إن كانت مخزنة نصًا، أو نتركها فارغة لو Base64
    $p().value = (u.password && atobSafe(u.password)) || u.password || u.pass || '';
    $r().value = u.role || 'مستخدم';
    $modal().classList.remove('hidden');
  }

  function closeModal() { $modal().classList.add('hidden'); }

  function atobSafe(s){ try { return atob(s || ''); } catch(_) { return ''; } }

  async function render() {
    await load();
    const body = $tbody();
    body.innerHTML = '';

    USERS.forEach((u, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.username || ''}</td>
        <td>${u.email || ''}</td>
        <td>${u.role || 'مستخدم'}</td>
        <td>
          <button class="btn-edit" data-i="${i}">تعديل ✏️</button>
          <button class="btn-del"  data-i="${i}">حذف 🗑️</button>
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = USERS[+btn.dataset.i];
        if (u) openEdit(u);
      });
    });

    body.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const u = USERS[+btn.dataset.i];
        if (!u) return;
        if (!confirm('هل تريد حذف هذا المستخدم؟')) return;
        await api('DELETE', '?id=' + encodeURIComponent(u.id));
        await render();
      });
    });
  }

  function wire() {
    // إضافة مستخدم
    $btnAdd()?.addEventListener('click', openAdd);

    // إلغاء
    $btnCancel()?.addEventListener('click', closeModal);

    // حفظ (إضافة/تعديل)
    $btnSave()?.addEventListener('click', async () => {
      const username = ($u().value || '').trim();
      const email    = ($e().value || '').trim();
      const password = $p().value || '';
      const role     = ($r().value || 'مستخدم').trim();

      if (!username || !password) {
        alert('⚠️ اسم المستخدم وكلمة المرور إلزاميان');
        return;
      }

      try {
        if (EDIT_ID) {
          // تحديث: نرسل id + password (نصي) والوظيفة ستقوم بتخزينه Base64
          await api('PUT', '', { id: EDIT_ID, username, email, password, role });
        } else {
          // إضافة: الحقول الصحيحة — لاحظ "password" وليس "pass"
          await api('POST', '', { username, email, password, role });
        }
        closeModal();
        await render();
      } catch (err) {
        alert('تعذّر الحفظ: ' + err.message);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    wire();
    try { await render(); }
    catch (e) {
      console.error(e);
      const body = $tbody();
      body.innerHTML = '<tr><td colspan="4">تعذر تحميل القائمة — تحقق من وظيفة users.js</td></tr>';
    }
  });
})();
