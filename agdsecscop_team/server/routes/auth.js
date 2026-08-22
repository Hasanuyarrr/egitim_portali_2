const express   = require("express");
const bcrypt    = require("bcryptjs");
const jwt       = require("jsonwebtoken");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const pool      = require("../db/client");
const config    = require("../config");
const { passwordProblem } = require("../lib/validate");
const { authenticate, invalidateUser } = require("../middleware/auth");

const router = express.Router();

/**
 * Kullanıcı bulunamadığında da bcrypt maliyeti ödensin diye kullanılan sahte hash.
 * Aksi hâlde yanıt süresi farkından geçerli e-postalar tespit edilebilir.
 */
const DUMMY_HASH = bcrypt.hashSync("edunova-dummy-password", 12);

const TOO_MANY = { error: "Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin." };

/**
 * İki katmanlı brute-force koruması:
 *  1) IP başına toplam deneme — tek kaynaktan toplu saldırıyı durdurur.
 *  2) E-posta başına deneme — tek bir hesabın şifresinin denenmesini durdurur.
 * Sınıf/kurum gibi tek NAT arkasındaki kullanıcıların birbirini kilitlememesi
 * için IP sınırı geniş, hesap sınırı dar tutulur.
 */
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: TOO_MANY,
});

const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    return email ? `acct:${email}` : `acct-ip:${ipKeyGenerator(req.ip)}`;
  },
  message: TOO_MANY,
});

const loginLimiter = [loginIpLimiter, loginAccountLimiter];

const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." },
});

function signAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tv: Number(user.token_version || 0),
    },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );
}

// POST /api/auth/login
router.post("/login", loginLimiter, async (req, res) => {
  const email    = typeof req.body?.email === "string" ? req.body.email : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({ error: "E-posta ve şifre zorunludur." });
  }
  if (email.length > 255 || password.length > 200) {
    return res.status(400).json({ error: "E-posta veya şifre hatalı." });
  }

  try {
    const { rows } = await pool.query(
      "SELECT id, email, password_hash, name, role, token_version FROM users WHERE email = $1",
      [email.toLowerCase().trim()]
    );

    const user  = rows[0];
    const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

    // Kullanıcı yok veya şifre yanlış — her iki durumda aynı mesaj ve aynı maliyet.
    if (!user || !match) {
      return res.status(401).json({ error: "E-posta veya şifre hatalı." });
    }

    await pool.query("UPDATE users SET last_seen_at = NOW() WHERE id = $1", [user.id]);

    const token = signAccessToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// GET /api/auth/me — token'dan mevcut kullanıcıyı döner
router.get("/me", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, email, name, role, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

/**
 * POST /api/auth/media-token
 * <video src="…?token=…"> gibi Authorization başlığı gönderemeyen elementler için
 * KISA ÖMÜRLÜ (5 dk) ve YALNIZCA medya indirmede geçerli token üretir.
 * Böylece URL'de/loglarda 12 saatlik oturum token'ı dolaşmaz.
 */
router.post("/media-token", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT token_version FROM users WHERE id = $1", [req.user.id]);
    if (!rows[0]) return res.status(401).json({ error: "Oturum geçersiz." });
    const token = jwt.sign(
      { id: req.user.id, role: req.user.role, tv: Number(rows[0].token_version || 0), scope: "media" },
      config.JWT_SECRET,
      { expiresIn: "5m" }
    );
    res.json({ token, expires_in: 300 });
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// POST /api/auth/change-password
router.post("/change-password", passwordChangeLimiter, authenticate, async (req, res) => {
  const current_password = typeof req.body?.current_password === "string" ? req.body.current_password : "";
  const new_password     = typeof req.body?.new_password === "string" ? req.body.new_password : "";

  if (!current_password || !new_password) {
    return res.status(400).json({ error: "Mevcut ve yeni şifre zorunludur." });
  }
  const problem = passwordProblem(new_password);
  if (problem) return res.status(400).json({ error: problem });
  if (new_password === current_password) {
    return res.status(400).json({ error: "Yeni şifre mevcut şifreyle aynı olamaz." });
  }

  try {
    const { rows } = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [req.user.id]
    );
    if (!rows[0]) return res.status(401).json({ error: "Oturum geçersiz." });

    const match = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: "Mevcut şifre hatalı." });

    const hash = await bcrypt.hash(new_password, 12);
    // token_version artışı, eskiden çalınmış tüm token'ları anında geçersiz kılar.
    const upd = await pool.query(
      `UPDATE users SET password_hash = $1, token_version = token_version + 1
       WHERE id = $2
       RETURNING id, email, name, role, token_version`,
      [hash, req.user.id]
    );
    invalidateUser(req.user.id);   // eski token'lar anında geçersiz

    res.json({
      message: "Şifre başarıyla güncellendi.",
      token: signAccessToken(upd.rows[0]),   // istemci yeni token'ı saklamalı
    });
  } catch (err) {
    console.error("change-password error:", err.message);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

module.exports = router;
