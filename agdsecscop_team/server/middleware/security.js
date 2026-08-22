/**
 * Güvenlik başlıkları + statik dosya erişim kontrolü.
 * Harici bağımlılık (helmet) gerektirmez.
 */
const path = require("path");
const { isProd } = require("../config");

/**
 * İçerik Güvenliği Politikası.
 * Panel sayfaları inline <script>/<style> ve onclick kullandığı için 'unsafe-inline'
 * zorunlu; ancak object-src/base-uri/frame-ancestors kapatılarak en tehlikeli
 * saldırı yüzeyleri (plugin enjeksiyonu, base-tag hijack, clickjacking) engellenir.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // qrcode.js ve sınav gözetim modelleri (tfjs/blazeface) jsDelivr'dan yüklenir.
  // 'wasm-unsafe-eval': TensorFlow.js WASM backend'i için gerekli (eval yetkisi vermez).
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  // BlazeFace model ağırlıkları tfhub/googleapis üzerinden indirilir.
  "connect-src 'self' https://cdn.jsdelivr.net https://tfhub.dev https://storage.googleapis.com https://www.kaggle.com",
  "worker-src 'self' blob:",
  // Sayfa hiçbir üçüncü taraf iframe'i gömmez.
  "frame-src 'self'",
].join("; ");

function securityHeaders(req, res, next) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  if (isProd) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

/** API yanıtları asla önbelleğe alınmamalı (paylaşılan cihaz / proxy sızıntısı). */
function noStoreApi(req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  next();
}

/**
 * Sunulmasına izin verilen KÖK dizin dosyaları (tanıtım sitesi).
 * Bu listede olmayan hiçbir kök dosya servis edilmez —
 * böylece Database/*.sql, server/**, .env, .DS_Store gibi dosyalar dışarı açılmaz.
 */
const PUBLIC_ROOT_FILES = new Set([
  "index.html",
  "egitmen.html",
  "hizmetlerimiz.html",
  "misyonumuz.html",
  "vizyonumuz.html",
  "verify-certificate.html",
  "styles.css",
  "script.js",
]);

/** Panel klasöründe servis edilmesine izin verilen dosya uzantıları. */
const PANEL_ALLOWED_EXT = new Set([".html", ".css", ".js", ".map", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2"]);

function isAllowedPanelFile(urlPath) {
  const ext = path.extname(urlPath).toLowerCase();
  return PANEL_ALLOWED_EXT.has(ext);
}

module.exports = { securityHeaders, noStoreApi, PUBLIC_ROOT_FILES, isAllowedPanelFile };
