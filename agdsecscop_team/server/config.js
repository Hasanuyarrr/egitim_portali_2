/**
 * Merkezi ortam değişkeni yükleme + doğrulama.
 * Güvenlik açısından kritik ayarlar eksik/zayıfsa sunucu HİÇ AÇILMAZ (fail-fast).
 */
require("dotenv").config();

const crypto = require("crypto");

const isProd = process.env.NODE_ENV === "production";

/** Örnek dosyadaki yer tutucu değerler — üretimde kabul edilemez. */
const PLACEHOLDER_SECRETS = new Set([
  "change_this_to_a_long_random_secret",
  "secret",
  "changeme",
  "jwt_secret",
]);

const errors = [];

// ── JWT_SECRET ────────────────────────────────────────────
const JWT_SECRET = (process.env.JWT_SECRET || "").trim();
if (!JWT_SECRET) {
  errors.push("JWT_SECRET tanımlı değil.");
} else if (PLACEHOLDER_SECRETS.has(JWT_SECRET.toLowerCase())) {
  errors.push("JWT_SECRET hâlâ .env.example'daki yer tutucu değer. Yeni bir sır üretin.");
} else if (JWT_SECRET.length < 32) {
  errors.push("JWT_SECRET en az 32 karakter olmalı (öneri: `openssl rand -hex 32`).");
}

// ── DATABASE_URL ──────────────────────────────────────────
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) {
  errors.push("DATABASE_URL tanımlı değil.");
}

// ── CORS ──────────────────────────────────────────────────
// Virgülle ayrılmış tam origin listesi: "https://portal.example.com,https://admin.example.com"
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (isProd && CORS_ORIGINS.length === 0) {
  errors.push("Üretimde CORS_ORIGINS zorunludur (izin verilen origin listesi).");
}

if (errors.length) {
  console.error("\n✗ Yapılandırma hatası — sunucu başlatılmadı:\n");
  for (const e of errors) console.error("  • " + e);
  console.error(
    "\n  Yeni bir JWT_SECRET üretmek için:\n" +
      "    node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"\n"
  );
  process.exit(1);
}

/**
 * RDS TLS kök sertifikası.
 * Amazon RDS kendi ara CA'larını kullanır; Node'un gömülü kök listesiyle
 * doğrulama sürüme/bölgeye göre başarısız olabilir. Bundle'ı açıkça vermek
 * hem güvenli hem deterministiktir:
 *   DB_CA_CERT_PATH=/etc/ssl/certs/rds-global-bundle.pem
 * İndirme: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
 */
const DB_CA_CERT_PATH = (process.env.DB_CA_CERT_PATH || "").trim();
let DB_CA_CERT = null;
if (DB_CA_CERT_PATH) {
  try {
    DB_CA_CERT = require("fs").readFileSync(DB_CA_CERT_PATH, "utf8");
  } catch (e) {
    console.error(`
✗ DB_CA_CERT_PATH okunamadı (${DB_CA_CERT_PATH}): ${e.message}
`);
    process.exit(1);
  }
}

/**
 * Yüklenen dosyaların kök dizini.
 * Varsayılan `server/uploads` kod dizininin içindedir; her deploy'da kaybolur.
 * Üretimde kalıcı bir birime (EBS mount, EFS) yönlendirin:
 *   UPLOAD_ROOT=/var/lib/secscop/uploads
 */
const UPLOAD_ROOT = (process.env.UPLOAD_ROOT || require("path").join(__dirname, "uploads")).trim();

module.exports = {
  isProd,
  PORT: Number(process.env.PORT || 3001),
  DATABASE_URL,
  DB_CA_CERT,
  UPLOAD_ROOT,
  JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "12h",
  CORS_ORIGINS,
  /** Reverse proxy arkasındaysa gerçek istemci IP'si için (rate limit doğruluğu). */
  TRUST_PROXY: process.env.TRUST_PROXY || (isProd ? "1" : "loopback"),
  /** Sabit zamanlı karşılaştırma yardımcı fonksiyonu. */
  timingSafeEqual(a, b) {
    const bufA = Buffer.from(String(a ?? ""), "utf8");
    const bufB = Buffer.from(String(b ?? ""), "utf8");
    // Uzunluk farkı sızmasın diye önce sabit uzunlukta özet al.
    const hashA = crypto.createHash("sha256").update(bufA).digest();
    const hashB = crypto.createHash("sha256").update(bufB).digest();
    return crypto.timingSafeEqual(hashA, hashB);
  },
};
