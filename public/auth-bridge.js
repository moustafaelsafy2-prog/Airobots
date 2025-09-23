(function(){
  function b64d(s){ try{ return atob(s||''); }catch(e){ return ''; } }

  async function loadGlobalUsers(){
    try{
      const res = await fetch('users.json', { cache: 'no-store' });
      if(!res.ok) return [];
      const arr = await res.json();
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  }

  function loadLocalUsers(){
    try{ return JSON.parse(localStorage.getItem('app_users')||'[]'); }catch(e){ return []; }
  }

  async function canLogin(u, p){
    if(!u) return false;
    const local = loadLocalUsers();
    let hit = local.find(x => (x.username||'').toLowerCase() === u.toLowerCase());
    if(hit) return (b64d(hit.pass||'') === p);

    const global = await loadGlobalUsers();
    hit = global.find(x => (x.username||'').toLowerCase() === u.toLowerCase());
    if(hit) return (b64d(hit.pass||'') === p);

    // احتفاظ بالحساب الافتراضي القديم (إن وُجد في صفحتك)
    return (u === 'Aiagent' && p === '2222');
  }

  function onSuccess(){
    // إعادة استخدام تدفّقك الأصلي: إظهار الداشبورد أو بدء الإعداد
    const loginModal = document.getElementById('login-modal');
    const mainHeader  = document.getElementById('main-header');
    const mainContent = document.getElementById('main-content');
    const setupChatInterface = document.getElementById('setup-chat-interface');

    if (loginModal) loginModal.style.display='none';
    if (localStorage.getItem('companyData')) {
      mainContent?.classList.add('hidden');
      mainHeader?.classList.remove('hidden');
      document.getElementById('dashboard-container')?.classList.remove('hidden');
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

  function patchLogin(){
    const loginBtn = document.getElementById('submit-login');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginMessage  = document.getElementById('login-message');
    if (!loginBtn || !usernameInput || !passwordInput || !loginMessage) return;

    // مستمع “لالتقاط” الضغط قبل كودك الأصلي
    loginBtn.addEventListener('click', async function(e){
      e.preventDefault();
      e.stopImmediatePropagation();

      const u = (usernameInput.value||'').trim();
      const p = passwordInput.value||'';

      const ok = await canLogin(u, p);
      if (ok){
        loginMessage.textContent = 'تم تسجيل الدخول بنجاح!';
        loginMessage.style.color = '#10b981';
        setTimeout(onSuccess, 500);
      } else {
        loginMessage.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة.';
        loginMessage.style.color = '#ef4444';
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', patchLogin);
})();
