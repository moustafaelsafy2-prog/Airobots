/**
 * admin-sync.js
 * طبقة مزامنة/عرض “غير مكسِّرة” لصفحة الأدمن
 * - تحييد أي رُسوم أو مستمعات قديمة (renderUsers/setUsers/onclicks)
 * - اعتماد localStorage كمصدر الحقيقة (app_users)
 * - دعم إضافة/تعديل/حذف فورياً بدون إعادة تحميل
 * - الحفاظ على الفلاتر/الفرز/البحث وتحديث الجدول مباشرة
 * - عدم تغيير طريقة عمل بقية الصفحة أو الـ HTML
 */

(function () {
  "use strict";

  // ====== عناصر واجهة متوقعة موجودة في admin.html ======
  const panel     = document.getElementById("admin-panel");
  const tbody     = document.querySelector("#users-table tbody");
  const resultsEl = document.getElementById("resultsCount");
  const addBtn    = document.getElementById("add-user-btn");
  const searchInp = document.getElementById("q");
  const roleSel   = document.getElementById("roleFilter");
  const exportBtn = document.getElementById("exportCsv");

  const modal          = document.getElementById("modal");
  const modalTitle     = document.getElementById("modal-title");
  const m_username     = document.getElementById("m_username");
  const m_email        = document.getElementById("m_email");
  const m_pass         = document.getElementById("m_pass");
  const m_role         = document.getElementById("m_role");
  const btnSaveOrig    = document.getElementById("save-user");
  const btnCancelOrig  = document.getElementById("cancel-user");

  if (!panel || !tbody) {
    // الصفحة لم تُحمّل بعد أو ليست صفحة الأدمن
    return;
  }

  // ====== حالة داخلية ======
  const LS_KEY = "app_users";
  let STATE = {
    q: "",
    role: "",
    sortKey: "",
    sortDir: "asc",
    editingId: null, // يُحدد إن كنا نحرر مستخدمًا موجودًا
  };

  // ====== أدوات مساعدة ======
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const debounce = (fn, ms = 250) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  function toast(msg, type = "ok") {
    const box = document.getElementById("toasts");
    if (!box) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.style.borderColor = type === "err" ? "#dc2626" : "#10b981";
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function uid() {
    return "u_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function readUsers() {
    try {
      const arr = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
      if (!Array.isArray(arr)) return [];
      // تأكد من وجود مُعرّف داخلي ثابت لكل مستخدم
      let changed = false;
      arr.forEach(u => {
        if (!u._id) {
          u._id = uid();
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem(LS_KEY, JSON.stringify(arr));
      }
      return arr;
    } catch {
      return [];
    }
  }

  function writeUsers(arr) {
    localStorage.setItem(LS_KEY, JSON.stringify(arr || []));
  }

  function upsertUser(user) {
    const list = readUsers();
    // منع تكرار اسم المستخدم لغير نفس السجل
    const duplicate = list.find(u => u.username === user.username && u._id !== user._id);
    if (duplicate) {
      throw new Error("⚠️ اسم المستخدم موجود مسبقًا");
    }

    const idx = list.findIndex(u => u._id === user._id);
    if (idx >= 0) {
      list[idx] = user;
    } else {
      user._id = user._id || uid();
      list.push(user);
    }
    writeUsers(list);
    return user._id;
  }

  function deleteUserById(id) {
    const list = readUsers();
    const idx = list.findIndex(u => u._id === id);
    if (idx >= 0) {
      list.splice(idx, 1);
      writeUsers(list);
    }
  }

  function toCSV(rows) {
    const head = ["username", "email", "role"];
    const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const body = rows.map(r => head.map(h => esc(r[h] || "")).join(",")).join("\n");
    return head.join(",") + "\n" + body;
  }

  function download(filename, content) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // ====== تصفية/فرز/عرض ======
  function getFilteredSorted() {
    const users = readUsers();
    const q = STATE.q.trim().toLowerCase();
    const role = STATE.role.trim();

    let out = users.filter(u => {
      const inRole = !role || (String(u.role || "").trim() === role);
      if (!q) return inRole;
      const hay = [u.username, u.email, u.role].map(v => String(v || "").toLowerCase()).join(" ");
      return inRole && hay.includes(q);
    });

    if (STATE.sortKey) {
      const k = STATE.sortKey;
      const dir = STATE.sortDir === "asc" ? 1 : -1;
      out.sort((a, b) => (String(a[k] || "").localeCompare(String(b[k] || ""))) * dir);
    }
    return out;
  }

  function renderTable() {
    // تحييد أي محتوى/مستمعات قديمة
    tbody.innerHTML = "";

    const data = getFilteredSorted();
    data.forEach(u => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(u.username || "")}</td>
        <td>${escapeHtml(u.email || "")}</td>
        <td>${escapeHtml(u.role || "مستخدم")}</td>
        <td class="row-actions"></td>
      `;
      const actions = tr.querySelector(".row-actions");

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn-ghost btn-edit";
      btnEdit.textContent = "✏️ تعديل";
      btnEdit.addEventListener("click", () => openEditModal(u._id));

      const btnDel = document.createElement("button");
      btnDel.className = "btn-ghost btn-del";
      btnDel.textContent = "🗑️ حذف";
      btnDel.addEventListener("click", () => {
        if (!confirm("هل تريد حذف هذا المستخدم؟")) return;
        deleteUserById(u._id);
        toast("تم الحذف");
        renderTable();
      });

      actions.appendChild(btnEdit);
      actions.appendChild(btnDel);
      tbody.appendChild(tr);
    });

    if (resultsEl) resultsEl.textContent = `النتائج: ${data.length}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ====== المودال: إضافة/تعديل ======
  function openAddModal() {
    STATE.editingId = null;
    modalTitle.textContent = "إضافة مستخدم";
    m_username.value = "";
    m_email.value = "";
    m_pass.value = "";
    m_role.value = "مستخدم";
    showModal(true);
  }

  function openEditModal(id) {
    const u = readUsers().find(x => x._id === id);
    if (!u) return;
    STATE.editingId = id;
    modalTitle.textContent = "تعديل مستخدم";
    m_username.value = u.username || "";
    m_email.value = u.email || "";
    m_pass.value = u.pass || "";
    m_role.value = u.role || "مستخدم";
    showModal(true);
  }

  function showModal(v) {
    if (!modal) return;
    modal.classList.toggle("hidden", !v);
  }

  function saveCurrentModal() {
    const username = m_username.value.trim();
    const email    = m_email.value.trim();
    const pass     = m_pass.value; // قد يكون فارغاً إذا لم يرغب بتغييره
    const role     = m_role.value.trim() || "مستخدم";

    if (!username) { alert("⚠️ يجب إدخال اسم المستخدم"); return; }

    let u = {
      _id: STATE.editingId || uid(),
      username,
      email,
      // إن كان تحريرًا وترك كلمة المرور فارغة، لا نغير الموجود
      pass: pass || (STATE.editingId ? (readUsers().find(x => x._id === STATE.editingId)?.pass || "") : ""),
      role
    };

    try {
      upsertUser(u);
      toast(STATE.editingId ? "تم تعديل المستخدم" : "تمت إضافة المستخدم");
      STATE.editingId = null;
      showModal(false);
      renderTable();
    } catch (e) {
      alert(e && e.message ? e.message : String(e));
    }
  }

  // ====== ربط عناصر التحكم (مع تحييد المستمعات القديمة) ======
  function replaceNodeWithClone(node) {
    if (!node) return node;
    const clone = node.cloneNode(true);
    node.parentNode.replaceChild(clone, node);
    return clone;
  }

  function wireControls() {
    // تحييد أي مستمعات قديمة على الأزرار (يُعالج مشكلة إضافة مستخدم بدل تعديل)
    const btnSave   = replaceNodeWithClone(btnSaveOrig);
    const btnCancel = replaceNodeWithClone(btnCancelOrig);
    const btnAdd    = replaceNodeWithClone(addBtn);

    if (btnAdd) btnAdd.addEventListener("click", openAddModal);
    if (btnCancel) btnCancel.addEventListener("click", () => {
      STATE.editingId = null;
      showModal(false);
    });
    if (btnSave) btnSave.addEventListener("click", saveCurrentModal);

    if (searchInp) searchInp.addEventListener("input", debounce((e) => {
      STATE.q = e.target.value || "";
      renderTable();
    }, 200));

    if (roleSel) roleSel.addEventListener("change", (e) => {
      STATE.role = e.target.value || "";
      renderTable();
    });

    if (exportBtn) exportBtn.addEventListener("click", () => {
      const rows = getFilteredSorted();
      if (!rows.length) { toast("لا توجد بيانات لتصديرها","err"); return; }
      download("users.csv", toCSV(rows));
      toast("تم تصدير CSV");
    });

    // رؤوس الفرز
    $$("#users-table thead th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort");
        STATE.sortDir = (STATE.sortKey === key && STATE.sortDir === "asc") ? "desc" : "asc";
        STATE.sortKey = key;
        // مؤشّر بسيط
        $$("#users-table thead th").forEach(h => h.innerText = h.innerText.replace(/[\s▲▼]+$/,""));
        th.innerText = th.innerText.replace(/[\s▲▼]+$/,"") + (STATE.sortDir === "asc" ? " ▲" : " ▼");
        renderTable();
      });
    });
  }

  // ====== تحييد وظائف قديمة قد تعيد رسم الجدول أو تغيّر البيانات ======
  function neutralizeLegacy() {
    try {
      if (typeof window.renderUsers === "function") {
        window.renderUsers = function () { /* no-op */ };
      }
      if (typeof window.setUsers === "function") {
        // نلفّ setUsers القديم إن وُجد لكن لا نتركه يظل بلا إعادة رسمنا
        const old = window.setUsers;
        window.setUsers = function (arr) {
          old(arr);       // يحفظ كما كان
          renderTable();  // ثم نعيد الرسم بطبقتنا
        };
      }
      // إزالة أي onclicks قديمة قد تكون رُبطت inline
      $$("#users-table .row-actions button").forEach(b => {
        b.replaceWith(b.cloneNode(true));
      });
    } catch {}
  }

  // ====== تفعيل عند ظهور لوحة الأدمن ======
  function init() {
    neutralizeLegacy();
    wireControls();
    renderTable();
  }

  // في حال كانت اللوحة ظاهرة بالفعل (سيناريو تطوير)
  if (!panel.classList.contains("hidden")) {
    init();
  } else {
    // نراقب تبدّل حالة اللوحة من hidden -> ظاهر (بعد تسجيل الدخول)
    const mo = new MutationObserver(() => {
      if (!panel.classList.contains("hidden")) {
        init();
        mo.disconnect();
      }
    });
    mo.observe(panel, { attributes: true, attributeFilter: ["class"] });
  }

})();
