/* =====================================================
   SeCScop Admin — Shared utilities
   Included in every admin page
   ===================================================== */

// Aynı origin üzerinden her zaman doğru API (localhost:3001 vs port değişimi)
const API = (location.protocol === "file:")
  ? "http://localhost:3001/api"
  : `${location.origin}/api`;

// ── Auth ──────────────────────────────────────────────
const _token = localStorage.getItem("token");
const _user  = (() => { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } })();

if (!_token || !_user || _user.role !== "admin") {
  window.location.href = "login.html";
}

// ── API fetch ─────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${_token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) logout();
  return res.json();
}

// ── XSS koruması ──────────────────────────────────────
/**
 * HTML metin içeriği için kaçış.
 * innerHTML ile birleştirilen HER sunucu verisi bundan geçmelidir.
 */
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** HTML öznitelik değerleri için kaçış (backtick dahil). */
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

/**
 * href/src için güvenli URL.
 * javascript:, data:, vbscript: gibi kod çalıştırabilen şemaları reddeder.
 */
var URL_SAFE_RE = new RegExp("^(https?://|mailto:|tel:|/|#|[.]{1,2}/)", "i");
function safeUrl(u) {
  var s = String(u === null || u === undefined ? "" : u).trim();
  return URL_SAFE_RE.test(s) ? escapeAttr(s) : "#";
}

/** onclick="fn('...')" gibi inline JS string literal'lerine gömmek için. */
var BS = String.fromCharCode(92); // ters bölü
function escapeJsString(s) {
  return String(s === null || s === undefined ? "" : s)
    .split(BS).join(BS + BS)
    .split("'").join(BS + "'")
    .split('"').join("&quot;")
    .split("<").join(BS + "x3C")
    .split(String.fromCharCode(13)).join(" ")
    .split(String.fromCharCode(10)).join(" ");
}

window.escapeHtml = escapeHtml;
window.escapeAttr = escapeAttr;
window.safeUrl = safeUrl;
window.escapeJsString = escapeJsString;

// ── Helpers ───────────────────────────────────────────
function initials(name) {
  return (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function avatarColor(name) {
  const c = ["#3a5dbf", "#c73050", "#1a9e6e", "#5040c8", "#d06820", "#888"];
  let h = 0;
  for (const ch of (name || "")) h = (h * 31 + ch.charCodeAt(0)) % c.length;
  return c[h];
}

function relativeTime(iso) {
  const d = Date.now() - new Date(iso).getTime(), m = Math.floor(d / 60000);
  const en = typeof window.getLang === "function" && window.getLang() === "en";
  if (m < 1) return typeof window.t === "function" ? window.t("rt.justNow") : "Az önce";
  if (m < 60) return en ? `${m}m ago` : `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return en ? `${h}h ago` : `${h} saat önce`;
  const days = Math.floor(h / 24);
  return en ? `${days}d ago` : `${days} gün önce`;
}

function formatDate(iso) {
  const locale = typeof window.getLang === "function" && window.getLang() === "en" ? "en-US" : "tr-TR";
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

function statusBadge(pct) {
  if (pct >= 70) return `<span class="badge badge-blue">${tSafe("admin.status.leader", "★ Lider")}</span>`;
  if (pct >= 30) return `<span class="badge badge-green">${tSafe("admin.status.active", "● Aktif")}</span>`;
  if (pct >= 5)  return `<span class="badge badge-orange">${tSafe("admin.status.slow", "● Yavaş")}</span>`;
  return `<span class="badge badge-gray">${tSafe("admin.status.passive", "Pasif")}</span>`;
}

const DIFF_BADGE = { easy: "badge-green", medium: "badge-blue", hard: "badge-orange", expert: "badge-red" };

function diffLabel(d) {
  const k = { easy: "admin.diff.easy", medium: "admin.diff.medium", hard: "admin.diff.hard", expert: "admin.diff.expert" }[d];
  return k ? tSafe(k, d) : d;
}

// ── i18n helper (theme-i18n.js yüklüyse) ────────────────
function tSafe(key, fallback) {
  if (typeof window.t === "function") return window.t(key);
  return fallback != null ? fallback : key;
}

// ── Topbar personalise ────────────────────────────────
function initTopbar(titleText) {
  const el = id => document.getElementById(id);
  if (el("topbarInitials")) {
    el("topbarInitials").textContent = initials(_user.name);
    el("topbarInitials").style.background = avatarColor(_user.name);
  }
  if (el("topbarName"))  el("topbarName").textContent  = _user.name;
  if (el("pageTitle") && titleText !== undefined && titleText !== "") {
    el("pageTitle").textContent = titleText;
  }
  const locale = typeof window.getLang === "function" && window.getLang() === "en" ? "en-US" : "tr-TR";
  if (el("topbarDate"))  el("topbarDate").textContent  =
    new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (typeof window.mountTopbarAppControls === "function") window.mountTopbarAppControls();
}

// ── Sidebar ───────────────────────────────────────────
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebarOverlay").classList.toggle("visible");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("visible");
}

// ── Modal helpers ─────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

function setupModalOverlayClose() {
  document.querySelectorAll(".modal-overlay").forEach(o => {
    o.addEventListener("click", e => { if (e.target === o) o.classList.remove("open"); });
  });
}

function showError(el, msg) {
  if (typeof el === "string") el = document.getElementById(el);
  el.textContent = msg;
  el.style.display = "block";
}
function hideError(el) {
  if (typeof el === "string") el = document.getElementById(el);
  el.style.display = "none";
}

// ── Toast notification ────────────────────────────────
function toast(msg, type = "success") {
  const t = document.createElement("div");
  t.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:999;
    background:${type === "success" ? "var(--green)" : "var(--red)"};
    color:#fff; padding:12px 18px; border-radius:10px;
    font-size:.88rem; font-weight:600; box-shadow:0 8px 24px rgba(0,0,0,.18);
    animation:fadeInUp .25s ease; pointer-events:none;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Logout ────────────────────────────────────────────
function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}

// ── Sidebar HTML builder ──────────────────────────────
function buildSidebar(activePage) {
  const items = [
    { page: "dashboard",     icon: "📊", labelKey: "admin.nav.dashboard",     href: "admin-dashboard.html" },
    { page: "students",      icon: "🎓", labelKey: "admin.nav.students",      href: "admin-students.html" },
    { page: "leaderboard",   icon: "🏆", labelKey: "admin.nav.leaderboard",   href: "admin-leaderboard.html" },
    { page: "results",       icon: "📈", labelKey: "admin.nav.results",       href: "admin-results.html" },
    { page: "exams",         icon: "🧪", labelKey: "admin.nav.exams",         href: "admin-exams.html" },
    { page: "modules",       icon: "📚", labelKey: "admin.nav.modules",       href: "admin-modules.html" },
    { page: "announcements", icon: "🔔", labelKey: "admin.nav.announcements", href: "admin-announcements.html" },
    { page: "certificates",  icon: "📜", labelKey: "admin.nav.certificates",  href: "admin-certificates.html" },
    { page: "ctf",           icon: "🚩", labelKey: "admin.nav.ctf",           href: "admin-ctf.html" },
  ];

  return `
    <div class="sidebar-brand">
      <div>
        <div class="logo-text">SeC<span>Scop</span></div>
        <div class="sidebar-role">${tSafe("admin.sidebar.role", "Admin Paneli")}</div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section-title">${tSafe("admin.nav.section.management", "Yönetim")}</div>
      ${items.slice(0, 5).map(i => `
        <a class="nav-item ${activePage === i.page ? "active" : ""}" href="${i.href}">
          <span class="nav-icon">${i.icon}</span> ${tSafe(i.labelKey, i.page)}
        </a>
      `).join("")}
      <div class="nav-section-title" style="margin-top:8px;">${tSafe("admin.nav.section.content", "İçerik")}</div>
      ${items.slice(5).map(i => `
        <a class="nav-item ${activePage === i.page ? "active" : ""}" href="${i.href}">
          <span class="nav-icon">${i.icon}</span> ${tSafe(i.labelKey, i.page)}
        </a>
      `).join("")}
      <div class="nav-section-title" style="margin-top:8px;">${tSafe("admin.nav.section.system", "Sistem")}</div>
      <a class="nav-item ${activePage === "settings" ? "active" : ""}" href="#">
        <span class="nav-icon">⚙️</span> ${tSafe("admin.nav.settings", "Ayarlar")}
      </a>

      <div class="sidebar-activity-icon">
        <a
          class="sidebar-activity-icon-link"
          href="admin-activity.html"
          title="${tSafe("admin.activity.sideTitle", "Öğrenci hareketleri")}"
        >
          <span class="nav-icon" style="width:auto;">🔔</span>
          <span class="badge badge-red" id="adminActivityBadge" style="display:none;"></span>
        </a>
      </div>
    </nav>
    <div class="sidebar-footer">
      <div class="nav-item" onclick="logout()" style="cursor:pointer;">
        <span class="nav-icon">🚪</span> ${tSafe("admin.nav.logout", "Çıkış Yap")}
      </div>
    </div>
  `;
}

// ── Shared topbar HTML ────────────────────────────────
function buildTopbar(titleText, searchPlaceholder) {
  const refreshTitle = tSafe("admin.topbar.refresh", "Yenile");
  return `
    <button class="hamburger" onclick="toggleSidebar()">
      <span></span><span></span><span></span>
    </button>
    <div>
      <div class="topbar-title" id="pageTitle">${titleText}</div>
      <div class="topbar-sub" id="topbarDate">—</div>
    </div>
    <div style="margin-left:auto;display:flex;align-items:center;gap:10px;" class="topbar-right">
      <div id="topbarAppControls" class="topbar-app-controls"></div>
      ${searchPlaceholder ? `
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input type="text" id="searchInput" placeholder="${searchPlaceholder}" oninput="onSearch(this.value)">
        </div>
      ` : ""}
      <button class="btn btn-ghost btn-sm" title="${refreshTitle.replace(/"/g, "&quot;")}" onclick="typeof reloadPage === 'function' && reloadPage()">↻</button>
      <div class="topbar-avatar">
        <div class="avatar" style="width:28px;height:28px;font-size:.7rem;" id="topbarInitials">—</div>
        <span class="topbar-avatar-name" id="topbarName">—</span>
      </div>
    </div>
  `;
}

// Inject keyframe for toast
const _style = document.createElement("style");
_style.textContent = `
  @keyframes fadeInUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  @keyframes spin { to { transform:rotate(360deg); } }
  .spinner { display:inline-block;width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--red);border-radius:50%;animation:spin .7s linear infinite; }
`;
document.head.appendChild(_style);

// ── Admin activity feed (sidebar) ──────────────────────
function tAct(key, vars, fallback) {
  if (typeof window.t === "function") return window.t(key, vars);
  return fallback != null ? fallback : key;
}

function renderAdminActivityFeed(events) {
  const listEl = document.getElementById("adminActivityList");
  const emptyEl = document.getElementById("adminActivityEmpty");
  // Sidebar'un alt verilerini (liste/boş durum) istemiyorsun.
  // Bu fonksiyon sadece öğeler varsa çalışır; badge refresh tek başına yeterli.
  if (!listEl || !emptyEl) return;

  if (!Array.isArray(events) || !events.length) {
    listEl.innerHTML = "";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function examTitleFromMeta(ev) {
    if (!ev || ev.meta == null) return esc("—");
    let o = ev.meta;
    if (typeof o === "string") {
      try {
        o = JSON.parse(o);
      } catch {
        return esc("—");
      }
    }
    if (!o || typeof o !== "object") return esc("—");
    const raw = String(o.exam_title || "").trim();
    return esc(raw || "—");
  }

  const msgFor = (e) => {
    const actor = esc(e.actor_name || e.actor_email || "—");
    const module = esc(e.module_title || "");
    const lesson = esc(e.lesson_title || "");
    const challenge = esc(e.challenge_title || "");
    const score = e.exam_score != null ? Number(e.exam_score) : 0;
    switch (e.event_type) {
      case "ctf_correct":
        return tAct("admin.activity.msg.ctfCorrect", { actor, challenge }, `${actor} doğru flag gönderdi: ${challenge}`);
      case "lesson_completed":
        return tAct(
          "admin.activity.msg.lessonCompleted",
          { actor, module, lesson },
          `${actor} ders tamamladı: ${module} / ${lesson}`
        );
      case "module_completed":
        return tAct("admin.activity.msg.moduleCompleted", { actor, module }, `${actor} modülü tamamladı: ${module}`);
      case "exam_passed":
        return tAct("admin.activity.msg.examPassed", { actor, module, score }, `${actor} sınav geçti: ${module} (${score} puan)`);
      case "exam_failed":
        return tAct("admin.activity.msg.examFailed", { actor, module, score }, `${actor} sınav kaldı: ${module} (${score} puan)`);
      case "general_exam_passed": {
        const exam = examTitleFromMeta(e);
        return tAct(
          "admin.activity.msg.generalExamPassed",
          { actor, exam, score },
          `${actor} genel sınavı geçti: ${exam} (${score} puan)`
        );
      }
      case "general_exam_failed": {
        const exam = examTitleFromMeta(e);
        return tAct(
          "admin.activity.msg.generalExamFailed",
          { actor, exam, score },
          `${actor} genel sınavda kaldı: ${exam} (${score} puan)`
        );
      }
      default:
        return `${actor} etkinlik: ${esc(e.event_type)}`;
    }
  };

  const iconFor = (type) => {
    switch (type) {
      case "ctf_correct":
      case "lesson_completed":
      case "module_completed":
      case "exam_passed":
      case "general_exam_passed":
        return "✅";
      case "exam_failed":
      case "general_exam_failed":
        return "❌";
      default:
        return "🔔";
    }
  };

  listEl.innerHTML = events
    .slice(0, 8)
    .map((e) => {
      const msg = msgFor(e);
      return `
        <div class="sidebar-activity-item" data-activity-id="${e.id}">
          <div class="sidebar-activity-line1">${iconFor(e.event_type)} ${msg}</div>
          <div class="sidebar-activity-meta">${relativeTime(e.created_at)}</div>
        </div>
      `;
    })
    .join("");
}

async function refreshAdminActivityFeed() {
  const badge = document.getElementById("adminActivityBadge");
  const lastId = window.__adminActivityLastId || 0;
  let events = [];
  try {
    const data = await apiFetch("/admin/activity/events?limit=12");
    events = Array.isArray(data) ? data : [];
  } catch {
    events = [];
  }

  if (!events.length) {
    renderAdminActivityFeed([]);
    if (badge) badge.style.display = "none";
    window.__adminActivityLastId = 0;
    return;
  }

  const maxId = Math.max(...events.map((e) => Number(e.id) || 0));
  const newCount = maxId > lastId ? events.filter((e) => Number(e.id) > lastId).length : 0;
  window.__adminActivityLastId = maxId;

  if (badge) {
    badge.textContent = newCount > 0 ? String(newCount) : "";
    badge.style.display = newCount > 0 ? "inline-flex" : "none";
  }

  // Top items bile değişmiş olabilir (eski idler dahil), bu yüzden maksimum id değişince re-render yap.
  if (maxId !== lastId || newCount > 0) {
    renderAdminActivityFeed(events);
  }
}

(function mountAdminActivityFeed() {
  if (window.__adminActivityMounted) return;

  const tryMount = () => {
    const badge = document.getElementById("adminActivityBadge");
    if (!badge) return false;
    window.__adminActivityMounted = true;
    refreshAdminActivityFeed();
    if (!window.__adminActivityTimer) {
      window.__adminActivityTimer = setInterval(refreshAdminActivityFeed, 12000);
    }
    return true;
  };

  if (tryMount()) return;

  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  const obs = new MutationObserver(() => {
    if (tryMount()) obs.disconnect();
  });
  obs.observe(sidebar, { childList: true, subtree: true });
})();

// ── Sort caret (all admin tables) ─────────────────────────
// Amaç: Admin paneldeki tüm `<table>` başlıklarına tıklanabilir sort caret eklemek.
// Sıralama: client-side, `data-sort` varsa onu kullanır; yoksa `td.textContent` üzerinden dener.
(function initAdminSortCarets() {
  if (window.__adminSortCaretsInit) return;
  window.__adminSortCaretsInit = true;

  function toText(v) {
    return String(v == null ? "" : v).trim();
  }

  function parseNumberMaybe(text) {
    const s = toText(text);
    if (!s) return NaN;
    // "1.234,56" / "1234.56" / "-12" gibi değerleri yakalamaya çalışır.
    const cleaned = s.replace(/[^0-9.,+\-]/g, "").replace(/,/g, ".");
    if (!cleaned || cleaned === "." || cleaned === "-" || cleaned === "+") return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function parseDateMaybe(text) {
    const s = toText(text);
    if (!s) return NaN;
    // En çok ISO / RFC formatlar parse olur; locale stringlerde başarısız olabilir (fallback: string).
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : NaN;
  }

  function getCellSortInfo(tr, colIndex) {
    const cell = tr && tr.children ? tr.children[colIndex] : null;
    if (!cell) return { type: "string", value: "" };

    const ds = cell.getAttribute("data-sort");
    if (ds != null) {
      const n = Number(ds);
      if (Number.isFinite(n)) return { type: "number", value: n };
      // ds ISO timestamp gibi string ise parse et.
      const d = parseDateMaybe(ds);
      if (Number.isFinite(d)) return { type: "number", value: d };
    }

    const text = toText(cell.textContent);
    const n = parseNumberMaybe(text);
    if (Number.isFinite(n)) return { type: "number", value: n };

    const d = parseDateMaybe(text);
    if (Number.isFinite(d)) return { type: "number", value: d };

    return { type: "string", value: text.toLowerCase() };
  }

  function detectColumnType(tbody, colIndex) {
    const rows = Array.from(tbody.querySelectorAll("tr")).slice(0, 25);
    let num = 0;
    let total = 0;
    for (const r of rows) {
      const info = getCellSortInfo(r, colIndex);
      if (info.type === "number") num += 1;
      total += 1;
    }
    if (total > 0 && num / total >= 0.6) return "number";
    return "string";
  }

  function sortTbody(tbody, colIndex, dir) {
    const rows = Array.from(tbody.querySelectorAll("tr"));
    if (rows.length <= 1) return;

    const type = detectColumnType(tbody, colIndex);
    const activeDir = dir === "asc" ? 1 : -1;

    const indexed = rows.map((row, idx) => {
      const info = getCellSortInfo(row, colIndex);
      return { row, idx, info };
    });

    indexed.sort((a, b) => {
      const av = a.info.value;
      const bv = b.info.value;

      if (type === "number") {
        const an = Number(av);
        const bn = Number(bv);
        const diff = (Number.isFinite(an) ? an : 0) - (Number.isFinite(bn) ? bn : 0);
        return diff * activeDir || a.idx - b.idx;
      }

      // string
      const as = String(av);
      const bs = String(bv);
      const cmp = as.localeCompare(bs, undefined, { sensitivity: "base" });
      return cmp * activeDir || a.idx - b.idx;
    });

    const frag = document.createDocumentFragment();
    indexed.forEach((x) => frag.appendChild(x.row));
    tbody.appendChild(frag);
  }

  function updateHeaderCarets(thead, activeTh) {
    const ths = Array.from(thead.querySelectorAll("th.sortable-th"));
    for (const th of ths) {
      const caret = th.querySelector(".sort-caret");
      if (!caret) continue;
      if (activeTh && th === activeTh) {
        const dir = th.dataset.sortDir || "desc";
        caret.textContent = dir === "asc" ? "▲" : "▼";
        th.classList.add("sort-active");
      } else {
        caret.textContent = "↕";
        th.classList.remove("sort-active");
      }
    }
  }

  function attachSortToTable(table) {
    if (table.dataset.adminSortCarets === "1") return;
    if (!table.tHead) return;
    if (!table.tBodies || !table.tBodies.length) return;

    const thead = table.tHead;
    const tbody = table.tBodies[0];
    if (!thead || !tbody) return;

    table.dataset.adminSortCarets = "1";

    const ths = Array.from(thead.querySelectorAll("th"));
    if (!ths.length) return;

    ths.forEach((th, colIndex) => {
      if (th.classList.contains("sortable-th")) return;
      if (th.querySelector(".sort-caret")) return;

      th.classList.add("sortable-th");
      const caret = document.createElement("span");
      caret.className = "sort-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = "↕";
      th.appendChild(document.createTextNode(" "));
      th.appendChild(caret);

      th.dataset.sortDir = "desc";
      th.dataset.sortColIndex = String(colIndex);

      const handler = () => {
        const col = Number(th.dataset.sortColIndex);
        if (!Number.isFinite(col)) return;

        const sameCol = table.dataset.sortActiveCol != null && Number(table.dataset.sortActiveCol) === col;
        if (sameCol) {
          th.dataset.sortDir = th.dataset.sortDir === "asc" ? "desc" : "asc";
        } else {
          table.dataset.sortActiveCol = String(col);
          th.dataset.sortDir = "desc"; // default newest->oldest gibi çoğu tabloda iyi hissettirir.
        }

        updateHeaderCarets(thead, th);
        sortTbody(tbody, col, th.dataset.sortDir);
      };

      th.addEventListener("click", handler);
      th.tabIndex = 0;
      th.setAttribute("role", "button");
      th.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handler();
        }
      });
    });
  }

  function setup(root) {
    const r = root || document;
    r.querySelectorAll("table").forEach((tbl) => attachSortToTable(tbl));
  }

  const boot = () => {
    setup(document);
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        setup(document);
      }, 120);
    };

    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.addedNodes && m.addedNodes.length) {
          schedule();
          break;
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
