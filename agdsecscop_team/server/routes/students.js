const express  = require("express");
const crypto   = require("crypto");
const bcrypt   = require("bcryptjs");
const pool     = require("../db/client");
const { authenticate, requireAdmin, invalidateUser } = require("../middleware/auth");
const { passwordProblem, isValidEmail, cleanText, toId, guardNumericParams } = require("../lib/validate");

/** Güvenli rastgele şifre (giriş için yeterli karmaşıklık) */
function generateRandomPassword(len = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
  const buf = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return out;
}

const router = express.Router();
guardNumericParams(router, ["id"]);
router.use(authenticate, requireAdmin);

// Backward-compatible: exam attempts table may not exist in older setups.
pool.query(`
  CREATE TABLE IF NOT EXISTS module_exam_attempts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    score INTEGER NOT NULL DEFAULT 0,
    passed BOOLEAN NOT NULL DEFAULT FALSE,
    answers JSONB DEFAULT '[]'::jsonb,
    attempted_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch((err) => console.warn("module_exam_attempts migration skipped:", err.message));

// GET /api/students/export/csv — Excel uyumlu CSV (UTF-8 BOM)
// ?withPasswords=1 → her öğrenci için yeni rastgele şifre oluşturulur, veritabanı güncellenir, CSV’de Şifre sütunu
router.get("/export/csv", async (req, res) => {
  const withPasswords = req.query.withPasswords === "1" || req.query.withPasswords === "true";
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.name,
        u.created_at,
        COALESCE(
          u.last_seen_at,
          (SELECT MAX(updated_at) FROM progress WHERE user_id = u.id),
          (SELECT MAX(solved_at) FROM ctf_solves WHERE user_id = u.id),
          u.created_at
        ) AS last_seen_at,
        (
          COALESCE(
            u.last_seen_at,
            (SELECT MAX(updated_at) FROM progress WHERE user_id = u.id),
            (SELECT MAX(solved_at) FROM ctf_solves WHERE user_id = u.id),
            u.created_at
          ) > NOW() - INTERVAL '5 minutes'
        ) AS is_online,
        COALESCE(
          (
            SELECT ROUND(
              100.0 *
              COUNT(*) FILTER (
                WHERE m.total_lessons > 0 AND p.completed_lessons >= m.total_lessons
              ) /
              NULLIF(COUNT(*), 0)
            )::int
            FROM progress p
            JOIN modules m ON m.id = p.module_id
            WHERE p.user_id = u.id
          )
        , 0) AS progress_pct,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM progress p
            JOIN modules m ON m.id = p.module_id
            WHERE p.user_id = u.id
          )
        , 0) AS opened_modules,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM progress p
            JOIN modules m ON m.id = p.module_id
            WHERE p.user_id = u.id
              AND m.total_lessons > 0
              AND p.completed_lessons >= m.total_lessons
          )
        , 0) AS completed_modules,
        COALESCE(
          (
            SELECT SUM(c.points)::int
            FROM ctf_solves cs
            JOIN ctf_challenges c ON c.id = cs.challenge_id
            WHERE cs.user_id = u.id
          )
        , 0) AS ctf_score,
        COALESCE(
          (SELECT SUM(completed_lessons)::int FROM progress WHERE user_id = u.id)
        , 0) AS completed_lessons
        ,
        COALESCE(
          (SELECT COUNT(*)::int FROM module_exam_attempts a WHERE a.user_id = u.id)
        , 0) AS exam_attempt_count,
        COALESCE(
          (SELECT COUNT(*)::int FROM module_exam_attempts a WHERE a.user_id = u.id AND a.passed = TRUE)
        , 0) AS exam_pass_count,
        COALESCE(
          (SELECT ROUND(AVG(score))::int FROM module_exam_attempts a WHERE a.user_id = u.id)
        , 0) AS exam_avg_score
      FROM users u
      WHERE u.role = 'student'
      ORDER BY u.name ASC
    `);

    const esc = (v) => {
      const s = String(v ?? "");
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = withPasswords
      ? ["ID", "Ad Soyad", "E-posta", "Şifre", "İlerleme %", "CTF Puanı", "Tamamlanan ders", "Kayıt (UTC)"]
      : ["ID", "Ad Soyad", "E-posta", "İlerleme %", "CTF Puanı", "Tamamlanan ders", "Kayıt (UTC)"];
    const lines = [header.join(",")];

    for (const r of rows) {
      let plainPassword = "";
      if (withPasswords) {
        plainPassword = generateRandomPassword(12);
        const hash = await bcrypt.hash(plainPassword, 12);
        // token_version artisi: ogrencinin acik olan tum oturumlari kapanir,
        // yoksa eski token 12 saat daha gecerli kalirdi.
        await pool.query(
          "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 AND role = 'student'",
          [hash, r.id]
        );
        invalidateUser(r.id);
      }
      const created = r.created_at ? new Date(r.created_at).toISOString() : "";
      const row = withPasswords
        ? [
            esc(r.id),
            esc(r.name),
            esc(r.email),
            esc(plainPassword),
            esc(r.progress_pct),
            esc(r.ctf_score),
            esc(r.completed_lessons),
            esc(created),
          ]
        : [
            esc(r.id),
            esc(r.name),
            esc(r.email),
            esc(r.progress_pct),
            esc(r.ctf_score),
            esc(r.completed_lessons),
            esc(created),
          ];
      lines.push(row.join(","));
    }
    const BOM = "\uFEFF";
    const fname = withPasswords
      ? `ogrenciler_sifreli_${new Date().toISOString().slice(0, 10)}.csv`
      : `ogrenciler_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(BOM + lines.join("\r\n"));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Dışa aktarma başarısız." });
  }
});

// GET /api/students/stats/summary — MUST be before /:id to avoid param capture
router.get("/stats/summary", async (req, res) => {
  try {
    const [students, labs, ctf] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM users WHERE role='student'"),
      pool.query("SELECT COALESCE(SUM(completed_lessons),0) AS total FROM progress"),
      pool.query("SELECT COUNT(*) FROM ctf_solves"),
    ]);
    res.json({
      students:     parseInt(students.rows[0].count),
      labs:         parseInt(labs.rows[0].total),
      ctf_solves:   parseInt(ctf.rows[0].count),
      certificates: 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// GET /api/students — all students with progress & CTF stats
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.name,
        u.created_at,
        COALESCE(
          u.last_seen_at,
          (SELECT MAX(updated_at) FROM progress WHERE user_id = u.id),
          (SELECT MAX(solved_at) FROM ctf_solves WHERE user_id = u.id),
          u.created_at
        ) AS last_seen_at,
        (
          COALESCE(
            u.last_seen_at,
            (SELECT MAX(updated_at) FROM progress WHERE user_id = u.id),
            (SELECT MAX(solved_at) FROM ctf_solves WHERE user_id = u.id),
            u.created_at
          ) > NOW() - INTERVAL '5 minutes'
        ) AS is_online,

        -- completion % based on opened modules
        COALESCE(
          (
            SELECT ROUND(
              100.0 *
              COUNT(*) FILTER (
                WHERE m.total_lessons > 0 AND p.completed_lessons >= m.total_lessons
              ) /
              NULLIF(COUNT(*), 0)
            )::int
            FROM progress p
            JOIN modules m ON m.id = p.module_id
            WHERE p.user_id = u.id
          )
        , 0) AS progress_pct,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM progress p
            JOIN modules m ON m.id = p.module_id
            WHERE p.user_id = u.id
          )
        , 0) AS opened_modules,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM progress p
            JOIN modules m ON m.id = p.module_id
            WHERE p.user_id = u.id
              AND m.total_lessons > 0
              AND p.completed_lessons >= m.total_lessons
          )
        , 0) AS completed_modules,

        COALESCE(
          (
            SELECT json_agg(m.title ORDER BY m.order_num)
            FROM progress p
            JOIN modules m ON m.id = p.module_id
            WHERE p.user_id = u.id
              AND m.total_lessons > 0
              AND p.completed_lessons >= m.total_lessons
          ),
          '[]'::json
        ) AS completed_module_titles,

        -- CTF total score
        COALESCE(
          (
            SELECT SUM(c.points)::int
            FROM ctf_solves cs
            JOIN ctf_challenges c ON c.id = cs.challenge_id
            WHERE cs.user_id = u.id
          )
        , 0) AS ctf_score,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM ctf_solves cs
            WHERE cs.user_id = u.id
          )
        , 0) AS solve_count,

        -- completed labs count
        COALESCE(
          (SELECT SUM(completed_lessons)::int FROM progress WHERE user_id = u.id)
        , 0) AS completed_lessons
        ,
        COALESCE(
          (SELECT COUNT(*)::int FROM module_exam_attempts a WHERE a.user_id = u.id)
        , 0) AS exam_attempt_count,
        COALESCE(
          (SELECT COUNT(*)::int FROM module_exam_attempts a WHERE a.user_id = u.id AND a.passed = TRUE)
        , 0) AS exam_pass_count,
        COALESCE(
          (SELECT ROUND(AVG(score))::int FROM module_exam_attempts a WHERE a.user_id = u.id)
        , 0) AS exam_avg_score

      FROM users u
      WHERE u.role = 'student'
      ORDER BY ctf_score DESC, progress_pct DESC
    `);

    const { rows: rankRows } = await pool.query(`
      WITH base AS (
        SELECT
          u.id,
          COALESCE(
            (
              SELECT SUM(c.points)::int
              FROM ctf_solves cs
              JOIN ctf_challenges c ON c.id = cs.challenge_id
              WHERE cs.user_id = u.id
            ),
            0
          ) AS ctf_score,
          COALESCE(
            (
              SELECT ROUND(
                100.0 * SUM(p.completed_lessons) /
                NULLIF((SELECT SUM(total_lessons) FROM modules), 0)
              )::int
              FROM progress p
              WHERE p.user_id = u.id
            ),
            0
          ) AS progress_pct
        FROM users u
        WHERE u.role = 'student'
      )
      SELECT id, RANK() OVER (ORDER BY ctf_score DESC, progress_pct DESC, id ASC)::int AS ctf_rank
      FROM base
    `);
    const rankById = Object.fromEntries(rankRows.map((r) => [r.id, r.ctf_rank]));
    rows.forEach((r) => {
      r.ctf_rank = rankById[r.id] ?? null;
    });

    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// GET /api/students/:id — single student detail
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const user = await pool.query(
      `SELECT id, email, name, created_at,
              COALESCE(
                last_seen_at,
                (SELECT MAX(updated_at) FROM progress WHERE user_id = users.id),
                (SELECT MAX(solved_at) FROM ctf_solves WHERE user_id = users.id),
                created_at
              ) AS last_seen_at,
              (
                COALESCE(
                  last_seen_at,
                  (SELECT MAX(updated_at) FROM progress WHERE user_id = users.id),
                  (SELECT MAX(solved_at) FROM ctf_solves WHERE user_id = users.id),
                  created_at
                ) > NOW() - INTERVAL '5 minutes'
              ) AS is_online
       FROM users WHERE id=$1 AND role='student'`,
      [id]
    );
    if (!user.rows[0]) return res.status(404).json({ error: "Öğrenci bulunamadı." });

    const prog = await pool.query(`
      SELECT m.id, m.order_num, m.title, m.total_lessons,
             COALESCE(p.completed_lessons, 0) AS completed_lessons
      FROM modules m
      LEFT JOIN progress p ON p.module_id = m.id AND p.user_id = $1
      ORDER BY m.order_num
    `, [id]);

    const solves = await pool.query(`
      SELECT c.id, c.title, c.category, c.difficulty, c.points, cs.solved_at
      FROM ctf_solves cs
      JOIN ctf_challenges c ON c.id = cs.challenge_id
      WHERE cs.user_id = $1
      ORDER BY cs.solved_at DESC
    `, [id]);

    const examAttempts = await pool.query(`
      SELECT
        a.id,
        a.module_id,
        m.title AS module_title,
        a.score,
        a.passed,
        a.attempted_at
      FROM module_exam_attempts a
      JOIN modules m ON m.id = a.module_id
      WHERE a.user_id = $1
      ORDER BY a.attempted_at DESC
    `, [id]);

    res.json({
      ...user.rows[0],
      modules: prog.rows,
      ctf_solves: solves.rows,
      exam_attempts: examAttempts.rows,
    });
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// POST /api/students — add new student
router.post("/", async (req, res) => {
  const email    = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
  const name     = cleanText(req.body?.name, 120);
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !name || !password) {
    return res.status(400).json({ error: "email, name ve password zorunludur." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Geçerli bir e-posta adresi girin." });
  }
  const pwProblem = passwordProblem(password);
  if (pwProblem) return res.status(400).json({ error: pwProblem });

  try {
    const exists = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    if (exists.rows[0]) return res.status(409).json({ error: "Bu e-posta zaten kayıtlı." });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      "INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,'student') RETURNING id, email, name, created_at",
      [email, hash, name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Bu e-posta zaten kayıtlı." });
    console.error("POST /api/students:", err.message);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// PUT /api/students/:id/password — şifre güncelle (admin)
router.put("/:id/password", async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ error: "Geçersiz öğrenci id." });

  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  try {
    const hash = await bcrypt.hash(password, 12);
    // token_version artışı, öğrencinin mevcut oturumlarını anında geçersiz kılar.
    const { rows } = await pool.query(
      `UPDATE users SET password_hash = $1, token_version = token_version + 1
       WHERE id = $2 AND role = 'student'
       RETURNING id, email, name`,
      [hash, id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Öğrenci bulunamadı." });
    invalidateUser(id);   // öğrencinin açık oturumları anında kapanır
    res.json({ message: "Şifre güncellendi.", id: rows[0].id, email: rows[0].email, name: rows[0].name });
  } catch (err) {
    console.error("PUT /api/students/:id/password:", err.message);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// PUT /api/students/:id — ad / e-posta güncelle
router.put("/:id", async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ error: "Geçersiz öğrenci id." });

  const name  = req.body?.name  !== undefined ? cleanText(req.body.name, 120) : undefined;
  const email = req.body?.email !== undefined
    ? (typeof req.body.email === "string" ? req.body.email.toLowerCase().trim() : null)
    : undefined;

  if (name === undefined && email === undefined) {
    return res.status(400).json({ error: "Güncellenecek en az bir alan gerekli." });
  }
  if (name === null)  return res.status(400).json({ error: "Ad geçersiz (1-120 karakter)." });
  if (email !== undefined && !isValidEmail(email)) {
    return res.status(400).json({ error: "Geçerli bir e-posta adresi girin." });
  }

  try {
    const fields = [];
    const vals   = [];
    let   idx    = 1;
    if (name  !== undefined) { fields.push(`name=$${idx++}`);  vals.push(name); }
    if (email !== undefined) { fields.push(`email=$${idx++}`); vals.push(email); }
    vals.push(id);

    const { rows } = await pool.query(
      `UPDATE users SET ${fields.join(",")} WHERE id=$${idx} AND role='student' RETURNING id, email, name`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: "Öğrenci bulunamadı." });
    invalidateUser(id);   // ad/e-posta değişikliği önbellekte kalmasın
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Bu e-posta zaten kayıtlı." });
    console.error("PUT /api/students/:id:", err.message);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// DELETE /api/students/:id
router.delete("/:id", async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ error: "Geçersiz öğrenci id." });
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM users WHERE id=$1 AND role='student'",
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: "Öğrenci bulunamadı." });
    invalidateUser(id);
    res.json({ message: "Öğrenci silindi." });
  } catch (err) {
    console.error("DELETE /api/students/:id:", err.message);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

module.exports = router;
