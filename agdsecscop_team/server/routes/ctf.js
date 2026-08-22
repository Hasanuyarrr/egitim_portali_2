const express = require("express");
const path    = require("path");
const fs      = require("fs");
const crypto  = require("crypto");
const multer  = require("multer");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const pool    = require("../db/client");
const config  = require("../config");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { guardNumericParams } = require("../lib/validate");

const router = express.Router();
guardNumericParams(router, ["id"]);
router.use(authenticate);

/** Flag brute-force'unu sınırlar (max_attempts=0 olan görevler için de geçerli). */
const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // Kimlik doğrulanmış kullanıcı bazlı; kimlik yoksa IPv6-güvenli IP anahtarı.
  keyGenerator: (req) => (req.user?.id ? `ctf:u${req.user.id}` : `ctf:${ipKeyGenerator(req.ip)}`),
  message: { error: "Çok hızlı flag gönderiyorsunuz. Biraz bekleyip tekrar deneyin." },
});
pool.query(`ALTER TABLE ctf_challenges ADD COLUMN IF NOT EXISTS flag_format VARCHAR(255) DEFAULT 'flag{...}'`)
  .catch((err) => console.warn("ctf.flag_format migration skipped:", err.message));
pool.query(`ALTER TABLE ctf_challenges ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 0`)
  .catch((err) => console.warn("ctf.max_attempts migration skipped:", err.message));
pool.query(`ALTER TABLE ctf_challenges ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE`)
  .catch((err) => console.warn("ctf.is_published migration skipped:", err.message));
pool.query(`
  CREATE TABLE IF NOT EXISTS ctf_attempts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge_id INTEGER NOT NULL REFERENCES ctf_challenges(id) ON DELETE CASCADE,
    submitted_flag VARCHAR(255),
    is_correct BOOLEAN NOT NULL DEFAULT FALSE,
    attempted_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch((err) => console.warn("ctf_attempts migration skipped:", err.message));

// ── Multer config ─────────────────────────────────────
const UPLOAD_DIR = path.join(config.UPLOAD_ROOT, "ctf");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = crypto.randomBytes(16).toString("hex");
    const ext    = path.extname(file.originalname).toLowerCase();
    cb(null, `${unique}${ext}`);
  },
});

// İzin verilen CTF dosya uzantıları
const CTF_ALLOWED_EXT = new Set([
  ".zip", ".tar", ".gz", ".7z", ".rar",
  ".pdf", ".txt", ".md",
  ".py", ".c", ".cpp", ".js", ".rb", ".php",
  ".pcap", ".pcapng",
  ".png", ".jpg", ".jpeg", ".gif",
  ".exe", ".elf", ".bin",
]);

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ext || !CTF_ALLOWED_EXT.has(ext)) {
      return cb(new Error(`İzin verilmeyen dosya türü: ${ext || "(uzantısız)"}`));
    }
    cb(null, true);
  },
});

/** Kullanıcıdan gelen dosya adındaki tehlikeli karakterleri temizler */
function sanitizeFilename(name) {
  return path.basename(name)          // path traversal engelle
    .replace(/[^\w\s.\-()[\]]/g, "_") // özel karakterleri _ yap
    .slice(0, 200);
}

// ── GET /api/ctf — challenges + solved status for caller ──
router.get("/", async (req, res) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.title,
        c.description,
        c.category,
        c.difficulty,
        c.points,
        COALESCE(c.flag_format, 'flag{...}') AS flag_format,
        COALESCE(c.max_attempts, 0)::int AS max_attempts,
        COALESCE(c.is_published, TRUE) AS is_published,
        c.file_name,
        CASE WHEN c.file_path IS NOT NULL THEN true ELSE false END AS has_file,
        CASE WHEN cs.id IS NOT NULL THEN true ELSE false END        AS solved,
        cs.solved_at,
        COALESCE(ua.attempt_count, 0)::int                           AS attempt_count,
        COUNT(ALL_SOLVES.id)::int                                   AS solve_count,
        (SELECT COUNT(*) FROM users WHERE role = 'student')::int    AS total_students
      FROM ctf_challenges c
      LEFT JOIN ctf_solves cs         ON cs.challenge_id = c.id AND cs.user_id = $1
      LEFT JOIN ctf_solves ALL_SOLVES ON ALL_SOLVES.challenge_id = c.id
      LEFT JOIN (
        SELECT challenge_id, user_id, COUNT(*)::int AS attempt_count
        FROM ctf_attempts
        GROUP BY challenge_id, user_id
      ) ua ON ua.challenge_id = c.id AND ua.user_id = $1
      WHERE ($2::text = 'admin' OR COALESCE(c.is_published, TRUE) = TRUE)
      GROUP BY c.id, cs.id, cs.solved_at, ua.attempt_count
      ORDER BY c.difficulty DESC, c.points DESC
    `, [req.user.id, isAdmin ? "admin" : "student"]);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/ctf error:", err.message);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── POST /api/ctf — create challenge with optional file (admin only) ──
router.post("/", requireAdmin, upload.single("file"), async (req, res) => {
  const { title, description, category, difficulty, points, flag, flag_format, max_attempts, is_published } = req.body;

  if (!title || !flag || !difficulty || !points) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Başlık, zorluk, puan ve flag zorunludur." });
  }
  const VALID_DIFF = ["easy", "medium", "hard", "expert"];
  if (!VALID_DIFF.includes(difficulty)) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Geçersiz zorluk seviyesi." });
  }

  const file_path = req.file ? req.file.path : null;
  const file_name = req.file ? sanitizeFilename(req.file.originalname) : null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO ctf_challenges
         (title, description, category, difficulty, points, flag, flag_format, max_attempts, is_published, file_path, file_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, title, description, category, difficulty, points, flag_format, max_attempts, is_published, file_name,
                 (file_path IS NOT NULL) AS has_file`,
      [
        title.trim(),
        description?.trim() || null,
        category?.trim()    || "misc",
        difficulty,
        parseInt(points),
        flag.trim(),
        (flag_format || "flag{...}").trim().slice(0, 255),
        Math.max(0, parseInt(max_attempts || 0, 10) || 0),
        String(is_published) !== "false",
        file_path,
        file_name,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── GET /api/ctf/:id/file — download challenge file ──
router.get("/:id/file", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT file_path, file_name, COALESCE(is_published, TRUE) AS is_published FROM ctf_challenges WHERE id=$1",
      [req.params.id]
    );
    const ch = rows[0];
    if (!ch || !ch.file_path) {
      return res.status(404).json({ error: "Bu görev için dosya bulunamadı." });
    }
    // Öğrenciler yayımlanmamış görevlerin dosyalarına erişemez
    if (req.user.role !== "admin" && !ch.is_published) {
      return res.status(404).json({ error: "Bu görev için dosya bulunamadı." });
    }
    // Path traversal koruması: dosya yalnızca CTF yükleme dizininde olmalı
    const resolvedPath = path.resolve(ch.file_path);
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
      return res.status(403).json({ error: "Erişim reddedildi." });
    }
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: "Dosya sunucuda bulunamadı." });
    }
    res.download(resolvedPath, ch.file_name || "challenge-file");
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── GET /api/ctf/stats — overall stats for all challenges (admin only) ──
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.title,
        c.category,
        c.difficulty,
        c.points,
        COALESCE(c.max_attempts, 0)::int                              AS max_attempts,
        COALESCE(c.is_published, TRUE)                                AS is_published,
        COUNT(cs.id)::int                                          AS solve_count,
        (SELECT COUNT(*) FROM users WHERE role='student')::int     AS total_students,
        ROUND(100.0 * COUNT(cs.id) /
          NULLIF((SELECT COUNT(*) FROM users WHERE role='student'),0), 1)::float AS solve_rate,
        MIN(cs.solved_at)                                          AS first_solve_at,
        MAX(cs.solved_at)                                          AS last_solve_at
      FROM ctf_challenges c
      LEFT JOIN ctf_solves cs ON cs.challenge_id = c.id
      GROUP BY c.id
      ORDER BY c.difficulty DESC, c.points DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── GET /api/ctf/:id/solvers — who solved this challenge (admin only) ──
router.get("/:id/solvers", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        cs.solved_at,
        c.points,
        RANK() OVER (ORDER BY cs.solved_at ASC)::int AS solve_rank
      FROM ctf_solves cs
      JOIN users u           ON u.id = cs.user_id
      JOIN ctf_challenges c  ON c.id = cs.challenge_id
      WHERE cs.challenge_id = $1
      ORDER BY cs.solved_at ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── GET /api/ctf/:id — single challenge with flag (admin only) ──
router.get("/:id", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, category, difficulty, points, flag,
              COALESCE(flag_format, 'flag{...}') AS flag_format,
              COALESCE(max_attempts, 0)::int AS max_attempts,
              COALESCE(is_published, TRUE) AS is_published,
              file_name, (file_path IS NOT NULL) AS has_file
       FROM ctf_challenges WHERE id=$1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Görev bulunamadı." });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── PUT /api/ctf/:id — update challenge (admin only) ──
router.put("/:id", requireAdmin, upload.single("file"), async (req, res) => {
  const { title, description, category, difficulty, points, flag, flag_format, max_attempts, is_published, remove_file } = req.body;

  if (!title || !flag || !difficulty || !points) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Başlık, zorluk, puan ve flag zorunludur." });
  }
  const VALID_DIFF = ["easy", "medium", "hard", "expert"];
  if (!VALID_DIFF.includes(difficulty)) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Geçersiz zorluk seviyesi." });
  }

  try {
    const old = await pool.query(
      "SELECT file_path, file_name FROM ctf_challenges WHERE id=$1", [req.params.id]
    );
    if (!old.rows[0]) return res.status(404).json({ error: "Görev bulunamadı." });

    let newFilePath = old.rows[0].file_path;
    let newFileName = old.rows[0].file_name;

    if (req.file) {
      // New file uploaded — remove old one from disk
      if (newFilePath && fs.existsSync(newFilePath)) fs.unlinkSync(newFilePath);
      newFilePath = req.file.path;
      newFileName = sanitizeFilename(req.file.originalname);
    } else if (remove_file === "true") {
      // Admin explicitly removed the file
      if (newFilePath && fs.existsSync(newFilePath)) fs.unlinkSync(newFilePath);
      newFilePath = null;
      newFileName = null;
    }

    const { rows } = await pool.query(
      `UPDATE ctf_challenges
       SET title=$1, description=$2, category=$3, difficulty=$4,
          points=$5, flag=$6, flag_format=$7, max_attempts=$8, is_published=$9, file_path=$10, file_name=$11
       WHERE id=$12
       RETURNING id, title, description, category, difficulty, points, flag_format, max_attempts, is_published, file_name,
                 (file_path IS NOT NULL) AS has_file`,
      [
        title.trim(),
        description?.trim() || null,
        category?.trim() || "misc",
        difficulty,
        parseInt(points),
        flag.trim(),
        (flag_format || "flag{...}").trim().slice(0, 255),
        Math.max(0, parseInt(max_attempts || 0, 10) || 0),
        String(is_published) !== "false",
        newFilePath,
        newFileName,
        req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── DELETE /api/ctf/:id — delete challenge + file (admin only) ──
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM ctf_challenges WHERE id=$1 RETURNING file_path",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Görev bulunamadı." });
    // Clean up the file from disk
    if (rows[0].file_path && fs.existsSync(rows[0].file_path)) {
      fs.unlinkSync(rows[0].file_path);
    }
    res.json({ message: "Görev silindi." });
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── POST /api/ctf/:id/submit — submit a flag ──
router.post("/:id/submit", submitLimiter, async (req, res) => {
  const flag = typeof req.body?.flag === "string" ? req.body.flag : "";
  const challengeId = parseInt(req.params.id);

  if (!flag.trim()) return res.status(400).json({ error: "Flag boş olamaz." });
  if (flag.length > 255) return res.status(400).json({ error: "Flag çok uzun." });
  if (!Number.isSafeInteger(challengeId) || challengeId <= 0) {
    return res.status(400).json({ error: "Geçersiz görev id." });
  }

  try {
    const ch = await pool.query(
      "SELECT id, title, points, flag, COALESCE(max_attempts, 0)::int AS max_attempts, COALESCE(is_published, TRUE) AS is_published FROM ctf_challenges WHERE id=$1",
      [challengeId]
    );
    if (!ch.rows[0]) return res.status(404).json({ error: "Görev bulunamadı." });
    if (req.user.role !== "admin" && !ch.rows[0].is_published) {
      return res.status(404).json({ error: "Görev bulunamadı." });
    }

    const already = await pool.query(
      "SELECT id FROM ctf_solves WHERE user_id=$1 AND challenge_id=$2",
      [req.user.id, challengeId]
    );
    if (already.rows[0]) {
      return res.status(409).json({ error: "Bu görevi zaten çözdünüz.", already_solved: true });
    }

    const usedQ = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM ctf_attempts WHERE user_id=$1 AND challenge_id=$2",
      [req.user.id, challengeId]
    );
    const usedAttempts = Number(usedQ.rows[0]?.cnt || 0);
    const maxAttempts = Number(ch.rows[0].max_attempts || 0);
    if (maxAttempts > 0 && usedAttempts >= maxAttempts) {
      return res.status(400).json({ error: "Bu görev için deneme hakkınız doldu.", attempts_left: 0, attempts_used: usedAttempts });
    }

    // Sabit zamanlı karşılaştırma: yanıt süresinden flag karakterleri sızmasın.
    const isCorrect = config.timingSafeEqual(flag.trim(), ch.rows[0].flag);
    await pool.query(
      "INSERT INTO ctf_attempts (user_id, challenge_id, submitted_flag, is_correct) VALUES ($1,$2,$3,$4)",
      [req.user.id, challengeId, flag.trim().slice(0, 255), isCorrect]
    );
    const attemptsUsedNow = usedAttempts + 1;
    const attemptsLeft = maxAttempts > 0 ? Math.max(0, maxAttempts - attemptsUsedNow) : null;

    if (!isCorrect) {
      return res.status(400).json({ error: "Yanlış flag!", correct: false, attempts_used: attemptsUsedNow, attempts_left: attemptsLeft });
    }

    await pool.query(
      "INSERT INTO ctf_solves (user_id, challenge_id) VALUES ($1,$2)",
      [req.user.id, challengeId]
    );

    // Admin feed: correct flag solve
    if (req.user.role === "student") {
      pool.query(
        `
          INSERT INTO admin_activity_events
            (actor_user_id, actor_name, actor_email, event_type, challenge_id, challenge_title, points)
          VALUES ($1,$2,$3,'ctf_correct',$4,$5,$6)
        `,
        [req.user.id, req.user.name, req.user.email, challengeId, ch.rows[0].title, Number(ch.rows[0].points || 0)]
      ).catch(() => {});
    }

    res.json({ correct: true, points: ch.rows[0].points, message: "Tebrikler! Bayrak doğru.", attempts_used: attemptsUsedNow, attempts_left: attemptsLeft });
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

module.exports = router;
