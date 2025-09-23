/* auth-bridge.js
 * ربط تسجيل الدخول مع مستخدمي admin.html (localStorage) + ملف users.json (اختياري)
 * لا يغيّر أي سطر من كودك؛ يلتقط حدث الضغط على زر الدخول ويتحقق بنفس منطقك.
 */
(function () {
  // -------- أدوات مساعدة --------
  function b64d(s) { try { return atob(s || ''); } catch (_) { return ''; } }
  function normUsername(u) { return (u || '').trim().toLowerCase(); }

  function loadLocalUsers() {
    try { 
      const arr = JSON.parse(localStorage.getItem('app_users') || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  async function loadGlobalUsers() {
    // ملف اختياري users.json بجذر الموقع — إن لم يوجد نتجاهله
    try {
      const res = await fetch('users.json', { cache: 'no-store' });
      if (!res.ok) return [];
      const arr = await res.json();
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  // مقارنة كلمة المرور: ندعم الحفظ نصيًا أو Base64 (للتوافق مع أي من طريقتيك)
  function isPassMatch(stored, input) {
    if (stored == null) return false;
    if (stored === input) return true;        // نص عادي
    if (b64d(stored) === input) return true;  // Base64
    return false;
  }

  async function canLogin(username, password) {
    const u = normUsername(username);

    // 1) محلي (أُنشئ من admin.html)
    const local = loadLocalUsers();
    let hit = local.find(x => normUsername(x.username) === u);
    if (hit && isPassMatch(hit.pass, password)) return true;

    // 2) عالمي (users.json) — اختياري
    const global = await loadGlobalUsers();
    hit = global.find(x => normUsername(x.username) === u);
    if (hit && isPassMatch(hit.pass, password)) return true;

    // 3) اعتماد حسابك الافتراضي القديم إن وُجد في الصفحة
    if (username === 'Aiagent' && password === '2222') return true;

    return false;
  }

  // مطابقة سلوك نجاح الدخول في صفحتك (بدون تغيير كودك)
  function onSuccess() {
    const loginModal = document.getElementById('login-modal');
    const mainHeader = document.getElementById('main-header');
    const mainContent = document.getElementById('main-content');
    const setupChatInterface = document.getElementById('setup-chat-interface');
    const dashboardContainer = document.getElementById('dashboard-container');

    if (loginModal) loginModal.style.display = 'none';

    // منطق صفحتك الأصلي: لو موجود companyData اظهر الداشبورد، وإلا ابدأ الإعداد
    if (localStorage.getItem('companyData')) {
      mainContent?.classList.add('hidden');
      mainHeader?.classList.remove('hidden');
      dashboardContainer?.classList.remove('hidden');
      // استدعاء الدوال إن وُجدت
      try { window.renderRobotList && window.renderRobotList(); } catch(_) {}
      try { window.renderConversationsList && window.renderConversationsList(); } catch(_) {}
    } else {
      mainContent?.classList.add('hidden');
      mainHeader?.classList.add('hidden');
      setupChatInterface?.classList.remove('hidden');
      // حقن أول رسالة لو لم تُحقن من قبل
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

  function attachBridge() {
    const btn = document.getElementById('submit-login');
    const userEl = document.getElementById('username');
    const passEl = document.getElementById('password');
    const msgEl  = document.getElementById('login-message');
    if (!btn || !userEl || !passEl || !msgEl) return;

    // نلتقط الضغط قبل أي Listener آخر دون حذف مستمعاتك
    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();

      const username = (userEl.value || '').trim();
      const password = passEl.value || '';

      const ok = await canLogin(username, password);
      if (ok) {
        msgEl.textContent = 'تم تسجيل الدخول بنجاح!';
        msgEl.style.color = '#10b981';
        setTimeout(onSuccess, 400);
      } else {
        msgEl.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة.';
        msgEl.style.color = '#ef4444';
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', attachBridge);
})();
