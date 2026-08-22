/**
 * Öğrenci paneli: kimlik doğrulama, üst çubuk (duyuru zili, avatar), duyuru yoklaması.
 * Sayfada <script src="student-shared.js"></script> sonrası initStudentShell({ pageLabel: "…" }) çağırın.
 */
(function () {
  const API = location.protocol === "file:" ? "http://localhost:3001/api" : `${location.origin}/api`;
  const token = localStorage.getItem("token");
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    user = null;
  }

  if (!token || !user || user.role !== "student") {
    window.location.href = "login.html";
    return;
  }

  // Geriye donuk ad: tirnak karakterlerini de kacisan guclu surume yonlendirilir.
  const escapeHtmlStr = escapeHtml;

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

  function initials(name) {
    return (name || "?")
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function avatarColor(name) {
    const colors = ["#3a5dbf", "#c73050", "#1a9e6e", "#5040c8", "#d06820"];
    let h = 0;
    for (const c of name || "") h = (h * 31 + c.charCodeAt(0)) % colors.length;
    return colors[h];
  }

  function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    const en = typeof window.getLang === "function" && window.getLang() === "en";
    const t = typeof window.t === "function" ? window.t : () => "";
    if (m < 1) return window.t ? t("rt.justNow") : "Az önce";
    if (m < 60) return en ? `${m}m ago` : `${m} dk önce`;
    const h = Math.floor(m / 60);
    if (h < 24) return en ? `${h}h ago` : `${h} saat önce`;
    const days = Math.floor(h / 24);
    return en ? `${days}d ago` : `${days} gün önce`;
  }

  function apiFetch(path) {
    return fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => {
      if (r.status === 401) logout();
      return r.json();
    });
  }

  let latestAnnouncements = [];
  let unseenAnnouncementCount = 0;
  let lastSeenUnseenCount = 0;
  let isFirstAnnouncementLoad = true;
  const annLastSeenIdKey = `ann_last_seen_id_${user?.id || "student"}`;

  function markAnnouncementsSeenUpToMax() {
    if (!latestAnnouncements.length) return;
    const maxId = Math.max(...latestAnnouncements.map((a) => Number(a.id) || 0));
    if (maxId > 0) localStorage.setItem(annLastSeenIdKey, String(maxId));
  }

  async function loadAnnouncements() {
    const anns = await apiFetch("/announcements");
    if (!anns || anns.error) return;
    latestAnnouncements = Array.isArray(anns) ? anns : [];
    const maxId = latestAnnouncements.length
      ? Math.max(...latestAnnouncements.map((a) => Number(a.id) || 0))
      : 0;

    if (isFirstAnnouncementLoad) {
      isFirstAnnouncementLoad = false;
      if (localStorage.getItem(annLastSeenIdKey) == null && maxId > 0) {
        localStorage.setItem(annLastSeenIdKey, String(maxId));
      }
      const lastSeenId = parseInt(localStorage.getItem(annLastSeenIdKey) || "0", 10) || 0;
      unseenAnnouncementCount = latestAnnouncements.filter((a) => (Number(a.id) || 0) > lastSeenId).length;
      lastSeenUnseenCount = unseenAnnouncementCount;
    } else {
      const lastSeenId = parseInt(localStorage.getItem(annLastSeenIdKey) || "0", 10) || 0;
      unseenAnnouncementCount = latestAnnouncements.filter((a) => (Number(a.id) || 0) > lastSeenId).length;
      if (unseenAnnouncementCount > lastSeenUnseenCount && unseenAnnouncementCount > 0) {
        const delta = unseenAnnouncementCount - lastSeenUnseenCount;
        const msg =
          delta === 1
            ? typeof window.t === "function"
              ? window.t("student.notif.newOne")
              : "🔔 Yeni bir duyuru yayınlandı"
            : typeof window.t === "function"
              ? window.t("student.notif.newMany").replace("{n}", String(delta))
              : `🔔 ${delta} yeni duyuru yayınlandı`;
        showMiniToast(msg);
      }
      lastSeenUnseenCount = unseenAnnouncementCount;
    }

    renderNotifPanel();

    const annBadge = document.getElementById("annBadge");
    if (annBadge) {
      if (!anns.length) annBadge.textContent = "";
      else if (typeof window.t === "function")
        annBadge.textContent = window.t("student.ann.badge").replace("{n}", String(anns.length));
      else annBadge.textContent = `${anns.length} duyuru`;
    }

    const announcementsList = document.getElementById("announcementsList");
    if (announcementsList && Array.isArray(anns)) {
      const dots = ["var(--red)", "var(--blue)", "var(--green)", "var(--orange)"];
      announcementsList.innerHTML = anns
        .map(
          (a, i) => `
      <div class="announcement">
        <div class="ann-dot" style="background:${dots[i % dots.length]};"></div>
        <div>
          <div class="ann-title">${escapeHtmlStr(a.title)}</div>
          <div class="ann-body">${escapeHtmlStr((a.body || "").slice(0, 120))}${(a.body || "").length > 120 ? "…" : ""}</div>
          <div class="ann-time">${relativeTime(a.created_at)}</div>
        </div>
      </div>`
        )
        .join("");
    }
  }

  function renderNotifPanel() {
    const badge = document.getElementById("notifBadge");
    const notifBtn = document.getElementById("notifBtn");
    const list = document.getElementById("notifList");
    if (badge) {
      if (unseenAnnouncementCount > 0) {
        badge.style.display = "inline-flex";
        badge.textContent = unseenAnnouncementCount > 9 ? "9+" : String(unseenAnnouncementCount);
        if (notifBtn) notifBtn.classList.add("notif-btn--has-new");
      } else {
        badge.style.display = "none";
        badge.textContent = "";
        if (notifBtn) notifBtn.classList.remove("notif-btn--has-new");
      }
    }
    if (list) {
      list.innerHTML = latestAnnouncements.length
        ? latestAnnouncements
            .slice(0, 6)
            .map(
              (a) => `
        <div class="notif-item">
          <div class="notif-title">${escapeHtmlStr(a.title || "")}</div>
          <div class="notif-time">${relativeTime(a.created_at)}</div>
        </div>`
            )
            .join("")
        : `<div style="padding:12px;font-size:.8rem;color:var(--text-3);">${typeof window.t === "function" ? window.t("student.notif.empty") : "Duyuru yok."}</div>`;
    }
  }

  function toggleNotifPanel() {
    const panel = document.getElementById("notifPanel");
    if (!panel) return;
    const open = panel.classList.toggle("open");
    if (open) {
      unseenAnnouncementCount = 0;
      lastSeenUnseenCount = 0;
      markAnnouncementsSeenUpToMax();
      renderNotifPanel();
    }
  }

  function showMiniToast(message) {
    const t = document.createElement("div");
    t.className = "toast-mini";
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  function toggleSidebar() {
    document.getElementById("sidebar")?.classList.toggle("open");
    document.getElementById("sidebarOverlay")?.classList.toggle("visible");
  }

  function closeSidebar() {
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("sidebarOverlay")?.classList.remove("visible");
  }

  function logout() {
    localStorage.clear();
    window.location.href = "login.html";
  }

  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("notifWrap");
    const panel = document.getElementById("notifPanel");
    if (!wrap || !panel) return;
    if (!wrap.contains(e.target)) panel.classList.remove("open");
  });

  function initStudentShell(opts) {
    opts = opts || {};
    if (opts.activePage && typeof window.buildStudentSidebar === "function") {
      const sb = document.getElementById("sidebar");
      if (sb) sb.innerHTML = window.buildStudentSidebar(opts.activePage);
    }
    const pageLabel =
      opts.pageLabelKey && typeof window.t === "function"
        ? window.t(opts.pageLabelKey)
        : opts.pageLabel || "";
    const hint = document.getElementById("studentPageHint");
    if (hint) {
      hint.textContent = pageLabel;
      hint.style.display = pageLabel ? "" : "none";
    }
    const topbarSub = document.getElementById("topbarSub");
    if (topbarSub && user) topbarSub.textContent = user.email || "";
    const av = document.getElementById("avatarInitials");
    const nm = document.getElementById("avatarName");
    if (user && av && nm) {
      av.textContent = initials(user.name);
      nm.textContent = user.name || "Öğrenci";
      av.style.background = avatarColor(user.name);
      av.style.color = "#fff";
    }
    loadAnnouncements();
    setInterval(loadAnnouncements, 12000);
    if (typeof window.mountStudentTopbarControls === "function") window.mountStudentTopbarControls();
    if (typeof window.applyStudentUiI18n === "function") window.applyStudentUiI18n();
  }

  window.API = API;
  window.token = token;
  window.user = user;
  window.apiFetch = apiFetch;
  window.initials = initials;
  window.avatarColor = avatarColor;
  window.relativeTime = relativeTime;
  window.escapeHtmlStr = escapeHtml;   // eski ad, ayni guclu kacis
  window.escapeHtml = escapeHtml;
  window.escapeAttr = escapeAttr;
  window.escapeAttrStr = escapeAttr;   // eski ad
  window.safeUrl = safeUrl;
  window.escapeJsString = escapeJsString;
  window.toggleSidebar = toggleSidebar;
  window.closeSidebar = closeSidebar;
  window.logout = logout;
  window.toggleNotifPanel = toggleNotifPanel;
  window.loadAnnouncements = loadAnnouncements;
  window.initStudentShell = initStudentShell;
})();
