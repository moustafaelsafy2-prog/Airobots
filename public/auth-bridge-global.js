/* auth-bridge-global.js
   قراءة المستخدمين من Netlify Function: /.netlify/functions/users
   دون تعديل أي سطر في index.html — فقط اعتراض زر "دخول" والتحقق.
*/

(function () {
  const API = '/.netlify/functions/users';

  // ---------- Helpers ----------
  const norm = s => (s || '').trim().toLowerCase();
  function b64d(s){ try { return atob(s || ''); } catch(_) { return ''; } }
  function passMatch(stored, input){
    if (stored == null) return false;
    // ندعم تخزين كلمة المرور كنص عادي أو Base64
    if (stored === input) return true;
    if (b64d(stored) === input) return true;
    return false;
  }

  async function fetchUsers(){
    try{
      const res = await fetch(API, { method: 'GET', cache: 'no-store' });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data.ok || !Array.isArray(data.users)) return [];
      // كاش احتياطي محلي (اختياري)
      localStorage.setItem('app_users', JSON.stringify(data.users));
      return data.users;
    } catch(_) {
      // fallback: لو الوظيفة غير متاحة مؤقتًا، جرّب الكاش المحلي
      try { return JSON.parse(localStorage.getItem('app_users') || '[]'); } catch(_) { return []; }
    }
  }

  async function canLogin(username, password){
    const users = await fetchUsers();
    const hit = users.find(u => norm(u.username) === norm(username));
    return !!(hit && passMatch(hit.pass || hit.password, password));
  }

  // نفس تدفق النجاح في صفحتك (بدون تغيير DOM الأصلي)
  function onSuccess(){
    const loginModal = document.getElementById('login-modal');
    const mainHeader = document.getElementById('main-header');
    const mainContent = document.getElementById('main-content');
    const setupChatInterface = document.getElementById('setup-chat-interface');
    const dashboardContainer = document.getElementById('dashboard-container');

    if (loginModal) loginModal.style.display = 'none';

    if (localStorage.getItem('companyData')) {
      mainContent?.classList.add('hidden');
      mainHeader?.classList.remove('hidden');
      dashboardContainer?.classList.remove('hidden');
      try { window.renderRobotList && window.renderRobotList(); } catch(_) {}
      try { window.renderConversationsList && window.renderConversationsList(); } catch(_) {}
    } else {
      mainContent?.classList.add('hidden');
      mainHeader?.classList.add('hidden');
      setupChatInterface?.classList.remove('hidden');
      const msgs = document.getElementById('setup-chat-messages');
      if (msgs && !msgs.dataset.injected) {
        const div = document.createElement('div');
        div.className = 'chat-message ai-message';
        div.textContent = 'مرحباً بك! أنا مساعد الإعداد الذكي. قبل أن نبدأ، ما هو اسم شركتك؟';
        msgs.appendChild(div);
        msgs.dataset.injected = '1';
      }
    }
  }

  function attach(){
    const btn = document.getElementById('submit-login');
    const userEl = document.getElementById('username');
    const passEl = document.getElementById('password');
    const msgEl  = document.getElementById('login-message');
    if (!btn || !userEl || !passEl || !msgEl) return;

    // اعتراض الزر — دون إزالة مستمعاتك الأصلية
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();

      const u = (userEl.value || '').trim();
      const p = passEl.value || '';

      msgEl.textContent = 'جاري التحقق...';
      msgEl.style.color = '#9ca3af';

      try {
        const ok = await canLogin(u, p);
        if (ok){
          msgEl.textContent = 'تم تسجيل الدخول بنجاح!';
          msgEl.style.color = '#10b981';
          setTimeout(onSuccess, 300);
        } else {
          msgEl.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة.';
          msgEl.style.color = '#ef4444';
        }
      } catch (err) {
        msgEl.textContent = 'تعذّر الاتصال بالخادم (الوظيفة). حاول لاحقًا.';
        msgEl.style.color = '#ef4444';
        console.error(err);
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', attach);
})();
