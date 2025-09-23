/* auth-bridge-global.js
 * ربط تسجيل الدخول مع مستخدمي Netlify Blobs عبر الوظيفة: /.netlify/functions/users
 * لا يغيّر أي سطر داخل index.html؛ فقط يلتقط حدث الضغط ويتحقق.
 */
(function () {
  const API = '/.netlify/functions/users';

  // -------- Helpers --------
  function b64d(s){ try{ return atob(s || ''); } catch(_) { return ''; } }
  const norm = s => (s || '').trim().toLowerCase();
  const ok200 = r => r && r.ok;

  async function fetchUsersCloud(){
    try{
      const res = await fetch(API, { method:'GET', cache:'no-store' });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data.ok || !Array.isArray(data.users)) return [];
      return data.users;
    }catch(_){ return []; }
  }

  // تطابق كلمة المرور سواء مخزنة نصياً أو Base64
  function passMatch(stored, input){
    if (stored == null) return false;
    if (stored === input) return true;
    if (b64d(stored) === input) return true;
    return false;
  }

  async function canLogin(username, password){
    const u = norm(username);
    // 1) قراءة مباشرة من التخزين السحابي (Netlify Blobs عبر الوظيفة)
    const cloud = await fetchUsersCloud();
    const hit = cloud.find(x => norm(x.username) === u);
    if (hit && passMatch(hit.pass, password)) return true;

    // 2) احتياطي (لو أردت إبقاء الحساب الافتراضي القديم)
    if (username === 'Aiagent' && password === '2222') return true;

    return false;
  }

  // نفس سلوك نجاح الدخول في صفحتك (بدون تغيير بنية الصفحة)
  function onSuccess(){
    const loginModal = document.getElementById('login-modal');
    const mainHeader = document.getElementById('main-header');
    const mainContent = document.getElementById('main-content');
    const setupChatInterface = document.getElementById('setup-chat-interface');
    const dashboardContainer = document.getElementById('dashboard-container');
    const loginMessage = document.getElementById('login-message');

    if (loginModal) loginModal.style.display = 'none';
    if (loginMessage){ loginMessage.textContent = 'تم تسجيل الدخول بنجاح!'; loginMessage.style.color = '#10b981'; }

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
        div.className='chat-message ai-message';
        div.textContent='مرحباً بك! أنا مساعد الإعداد الذكي. قبل أن نبدأ، ما هو اسم شركتك؟';
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

    btn.addEventListener('click', async function(e){
      e.preventDefault();
      e.stopImmediatePropagation();

      const u = (userEl.value || '').trim();
      const p = passEl.value || '';

      const ok = await canLogin(u, p);
      if (ok){
        msgEl.textContent = 'جاري تسجيل الدخول...';
        msgEl.style.color = '#10b981';
        setTimeout(onSuccess, 300);
      } else {
        msgEl.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة.';
        msgEl.style.color = '#ef4444';
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', attach);
})();
