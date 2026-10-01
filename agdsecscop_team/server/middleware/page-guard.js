/**
 * Panel sayfalarının sunucu tarafında korunması.
 *
 * SORUN: /admin/** altındaki her dosya herkese açık servis ediliyordu.
 * Erişim kontrolü yalnızca admin-shared.js içindeki istemci tarafı
 * yönlendirmesiydi:
 *
 *     if (!_token || _user.role !== "admin") location.href = "login.html";
 *
 * Bu, JavaScript çalıştırmayan hiçbir istemciyi durdurmaz: `view-source:`,
 * `curl`, JS kapalı bir tarayıcı veya basit bir tarayıcı eklentisi tüm panel
 * iskeletini, element kimliklerini ve panel JS'ini indirebiliyordu. Veri
 * sızmıyordu (API ayrı olarak Bearer token istiyor) ama saldırgan için
 * eksiksiz bir keşif haritası oluşuyordu.
 *
 * ÇÖZÜM: Oturum açarken httpOnly bir çerez verilir ve panel dosyaları bu
 * çerez doğrulanmadan sunulmaz. Çerez SADECE sayfa sunumu içindir —
 * API yetkilendirmesi Bearer token ile devam eder, böylece mevcut kimlik
 * doğrulama modeli değişmez ve çerez bir CSRF vektörüne dönüşmez.
 */
const path = require("path");
const { resolvePageSession } = require("./auth");

/** Oturum çerezinin adı. */
const PAGE_COOKIE = "sp_session";

/**
 * Giriş yapmadan erişilebilmesi gereken panel dosyaları.
 * login.html yalnızca admin.css kullanır; başka hiçbir panel varlığına
 * giriş öncesi ihtiyaç yoktur.
 */
const PUBLIC_PANEL_FILES = new Set(["/login.html", "/admin.css"]);

/** Bağımlılık eklemeden çerez ayrıştırma. */
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Hangi rol hangi sayfayı görebilir.
 * Bir öğrencinin yönetim panelini indirebilmesi de bir bilgi ifşasıydı.
 */
function requiredRoleFor(urlPath) {
  const base = path.basename(urlPath);
  if (base.startsWith("admin-")) return "admin";
  if (base.startsWith("student-")) return "student";
  return null; // ortak varlıklar (css/js/i18n): her oturum açmış kullanıcı
}

function pageGuard() {
  return async function (req, res, next) {
    // Yalnızca GET/HEAD sayfa istekleri; diğerleri statik katmana düşmez.
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    let urlPath;
    try {
      urlPath = decodeURIComponent(req.path);
    } catch {
      return res.status(400).send("Bad request");
    }

    if (urlPath === "/" || PUBLIC_PANEL_FILES.has(urlPath)) return next();

    const user = await resolvePageSession(readCookie(req, PAGE_COOKIE));
    const isHtml = urlPath.toLowerCase().endsWith(".html");

    if (!user) {
      if (isHtml) return res.redirect(302, "/admin/login.html");
      // Varlıklar için yönlendirme yerine 404: panelin dosya yapısı
      // oturum açmamış istemciye sızmasın.
      return res.status(404).send("Not found");
    }

    const need = requiredRoleFor(urlPath);
    if (need && user.role !== need) {
      if (isHtml) {
        const hedef = user.role === "admin" ? "/admin/admin-dashboard.html" : "/admin/student-dashboard.html";
        return res.redirect(302, hedef);
      }
      return res.status(404).send("Not found");
    }

    // Panel sayfaları asla önbelleğe alınmamalı: çıkış sonrası geri tuşuyla
    // sayfanın yeniden gösterilmesini engeller.
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    next();
  };
}

/** Giriş sonrası oturum çerezini yazar. */
function setPageCookie(res, token, maxAgeSec, isProd) {
  const parts = [
    `${PAGE_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/admin",
    "HttpOnly",              // JavaScript okuyamaz → XSS ile çalınamaz
    "SameSite=Strict",       // başka sitelerden gelen isteklerde gönderilmez
    `Max-Age=${Math.max(1, Math.floor(maxAgeSec))}`,
  ];
  if (isProd) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

/** Çıkışta çerezi siler. */
function clearPageCookie(res, isProd) {
  const parts = [`${PAGE_COOKIE}=`, "Path=/admin", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isProd) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

module.exports = { pageGuard, setPageCookie, clearPageCookie, PAGE_COOKIE };
