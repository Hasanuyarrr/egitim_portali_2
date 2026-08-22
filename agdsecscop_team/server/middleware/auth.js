const jwt = require("jsonwebtoken");
const pool = require("../db/client");
const config = require("../config");

// Oturum geçersiz kılma (şifre değişimi / admin şifre sıfırlama) için sürüm sütunu.
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`)
  .catch((err) => console.warn("users.last_seen_at migration skipped:", err.message));
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`)
  .catch((err) => console.warn("users.token_version migration skipped:", err.message));

/**
 * Yalnızca bu yollar Authorization başlığı yerine ?token= ile de erişilebilir.
 * Sebep: <video src> gibi tarayıcı istekleri özel başlık gönderemez.
 * Query string'deki token sunucu loglarına / tarayıcı geçmişine düşebildiği için:
 *   • istisna tek bir salt-okunur medya yoluna kısıtlıdır,
 *   • yalnızca POST /api/auth/media-token ile üretilen 5 dakikalık
 *     scope:"media" token'ı kabul edilir (12 saatlik oturum token'ı DEĞİL).
 */
const QUERY_TOKEN_ALLOWED = [
  /^\/\d+\/attachments\/\d+\/download$/,   // /api/modules/:id/attachments/:aid/download
];

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return { token: header.slice(7).trim(), viaQuery: false };
  }

  if (req.method === "GET" && req.query && req.query.token) {
    const allowed = QUERY_TOKEN_ALLOWED.some((re) => re.test(req.path));
    if (allowed) return { token: String(req.query.token), viaQuery: true };
  }
  return { token: null, viaQuery: false };
}

// ── Kullanıcı durumu önbelleği ────────────────────────────
// Kimliği her istekte veritabanından tazelemek doğrudur ama her API
// çağrısına bir sorgu ekler. Kısa TTL'li bellek içi önbellek yükü düşürür;
// şifre değişimi gibi iptal olaylarında invalidateUser() ile anında temizlenir.
const USER_TTL_MS = 10_000;
const SEEN_WRITE_MS = 60_000;   // last_seen_at yazımı kullanıcı başına en fazla dakikada bir
const userCache = new Map();    // id -> { user, tokenVersion, expiresAt, lastSeenWrittenAt }

/** Bir kullanıcının önbelleğini düşürür (şifre değişimi, rol değişimi, silme). */
function invalidateUser(id) {
  userCache.delete(Number(id));
}

/** Önbellek sınırsız büyümesin: periyodik temizlik. */
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of userCache) {
    if (entry.expiresAt <= now && (now - entry.lastSeenWrittenAt) > SEEN_WRITE_MS) {
      userCache.delete(id);
    }
  }
}, 60_000).unref?.();

async function loadUser(id) {
  const now = Date.now();
  const cached = userCache.get(id);
  if (cached && cached.expiresAt > now) return cached;

  const { rows } = await pool.query(
    "SELECT id, email, name, role, token_version FROM users WHERE id = $1",
    [id]
  );
  if (!rows[0]) {
    userCache.delete(id);
    return null;
  }
  const entry = {
    user: { id: rows[0].id, email: rows[0].email, name: rows[0].name, role: rows[0].role },
    tokenVersion: Number(rows[0].token_version || 0),
    expiresAt: now + USER_TTL_MS,
    lastSeenWrittenAt: cached ? cached.lastSeenWrittenAt : 0,
  };
  userCache.set(id, entry);
  return entry;
}

/**
 * Authorization: Bearer <token> doğrular.
 * Token'ın içeriğine körü körüne güvenmek yerine kullanıcı veritabanından
 * (kısa TTL'li önbellekle) tazelenir; böylece silinen kullanıcı, değiştirilen
 * rol veya iptal edilen oturum en geç 10 saniye içinde — iptal olayı bu
 * süreçte gerçekleştiyse anında — etkisini gösterir.
 * req.user = { id, email, name, role }
 */
async function authenticate(req, res, next) {
  const { token, viaQuery } = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Token gerekli." });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Geçersiz veya süresi dolmuş token." });
  }

  // Kapsam ayrımı: medya token'ı API'de, oturum token'ı da URL'de kullanılamaz.
  const isMediaToken = payload.scope === "media";
  if (viaQuery !== isMediaToken) {
    return res.status(401).json({ error: "Bu token bu istek için geçerli değil." });
  }

  const id = Number(payload.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(401).json({ error: "Geçersiz token." });
  }

  let entry;
  try {
    entry = await loadUser(id);
  } catch (err) {
    console.error("authenticate error:", err.message);
    return res.status(503).json({ error: "Servis geçici olarak kullanılamıyor." });
  }

  // Kullanıcı silinmiş ya da oturum iptal edilmiş (şifre değişimi vb.)
  if (!entry || entry.tokenVersion !== Number(payload.tv || 0)) {
    return res.status(401).json({ error: "Oturum geçersiz. Lütfen tekrar giriş yapın." });
  }

  req.user = entry.user;

  // Çevrimiçi/son görülme takibi — engellemeyen ve kullanıcı başına kısıtlı yazım.
  const now = Date.now();
  if (now - entry.lastSeenWrittenAt > SEEN_WRITE_MS) {
    entry.lastSeenWrittenAt = now;
    pool.query("UPDATE users SET last_seen_at = NOW() WHERE id = $1", [id]).catch(() => {});
  }

  next();
}

/** authenticate() sonrası kullanılmalı. Yalnızca role === 'admin'. */
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Bu işlem için admin yetkisi gerekli." });
  }
  next();
}

/** authenticate() sonrası kullanılmalı. Yalnızca role === 'student'. */
function requireStudent(req, res, next) {
  if (req.user?.role !== "student") {
    return res.status(403).json({ error: "Bu endpoint yalnızca öğrenciler içindir." });
  }
  next();
}

module.exports = { authenticate, requireAdmin, requireStudent, invalidateUser };
