const express = require("express");
const pool = require("../db/client");
const { authenticate, requireAdmin, requireStudent } = require("../middleware/auth");
const { guardNumericParams } = require("../lib/validate");

const router = express.Router();
guardNumericParams(router, ["id"]);
router.use(authenticate);

// Lightweight migrations (startup safe). Must run in order — FK deps + parallel races caused
// "relation does not exist" when ALTER ran before CREATE finished.
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS general_exams (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        is_published BOOLEAN NOT NULL DEFAULT FALSE,
        duration_minutes INTEGER NOT NULL DEFAULT 30,
        pass_score INTEGER NOT NULL DEFAULT 70,
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        proctor JSONB NOT NULL DEFAULT '{}'::jsonb,
        questions JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err) {
    console.warn("general_exams migration skipped:", err.message);
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS general_exam_attempts (
        id SERIAL PRIMARY KEY,
        exam_id INTEGER NOT NULL REFERENCES general_exams(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        submitted_at TIMESTAMPTZ,
        score INTEGER NOT NULL DEFAULT 0,
        passed BOOLEAN NOT NULL DEFAULT FALSE,
        answers JSONB NOT NULL DEFAULT '[]'::jsonb,
        violations_count INTEGER NOT NULL DEFAULT 0,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
  } catch (err) {
    console.warn("general_exam_attempts migration skipped:", err.message);
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS general_exam_proctor_events (
        id SERIAL PRIMARY KEY,
        attempt_id INTEGER NOT NULL REFERENCES general_exam_attempts(id) ON DELETE CASCADE,
        event_type VARCHAR(64) NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err) {
    console.warn("general_exam_proctor_events migration skipped:", err.message);
    return;
  }
  await Promise.all([
    pool.query(`CREATE INDEX IF NOT EXISTS idx_gen_exam_pub ON general_exams(is_published, starts_at, ends_at, id DESC)`),
    pool.query(`CREATE INDEX IF NOT EXISTS idx_gen_exam_attempts_user ON general_exam_attempts(user_id, exam_id, started_at DESC)`),
    pool.query(`CREATE INDEX IF NOT EXISTS idx_gen_exam_attempts_exam ON general_exam_attempts(exam_id, started_at DESC)`),
  ]).catch(() => {});

  try {
    await pool.query(`
      ALTER TABLE general_exams ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3
    `);
  } catch (err) {
    console.warn("general_exams max_attempts migration skipped:", err.message);
  }
})();

function parseJsonbField(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === "object") return val;
  if (typeof val === "string") {
    try {
      const j = JSON.parse(val);
      return j != null ? j : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeExamRow(row) {
  const proctorRaw = parseJsonbField(row && row.proctor, {});
  const proctor = proctorRaw && typeof proctorRaw === "object" ? proctorRaw : {};
  const qsRaw = parseJsonbField(row && row.questions, []);
  const qs = Array.isArray(qsRaw) ? qsRaw : [];
  return {
    id: Number(row.id),
    title: row.title || "",
    description: row.description || "",
    is_published: !!row.is_published,
    duration_minutes: Math.max(1, Number(row.duration_minutes || 30)),
    pass_score: Math.max(0, Math.min(100, Number(row.pass_score || 70))),
    max_attempts: Math.max(1, Number(row.max_attempts != null ? row.max_attempts : 3)),
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    proctor: {
      require_camera: !!proctor.require_camera,
      require_fullscreen: !!proctor.require_fullscreen,
      block_copy_paste: proctor.block_copy_paste !== false, // default true
      max_violations: Math.max(0, Number(proctor.max_violations || 3)),
      auto_submit_on_violation: proctor.auto_submit_on_violation !== false, // default true
    },
    questions: qs
      .filter((q) => q && typeof q === "object")
      .map((q) => ({
        question: String(q.question || ""),
        options: Array.isArray(q.options) ? q.options.map((x) => String(x || "")) : [],
        correct_index: Number.isFinite(Number(q.correct_index)) ? Number(q.correct_index) : 0,
      }))
      .filter((q) => q.question.trim() && q.options.length >= 2),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function safeExamForStudent(ex) {
  return {
    id: ex.id,
    title: ex.title,
    description: ex.description,
    duration_minutes: ex.duration_minutes,
    pass_score: ex.pass_score,
    max_attempts: ex.max_attempts,
    starts_at: ex.starts_at,
    ends_at: ex.ends_at,
    proctor: ex.proctor,
    questions: ex.questions.map((q) => ({ question: q.question, options: q.options })),
  };
}

function isExamAvailableNow(ex) {
  if (!ex.is_published) return false;
  const now = Date.now();
  const s = ex.starts_at ? new Date(ex.starts_at).getTime() : null;
  const e = ex.ends_at ? new Date(ex.ends_at).getTime() : null;
  if (s && Number.isFinite(s) && now < s) return false;
  if (e && Number.isFinite(e) && now > e) return false;
  return true;
}

// ── Admin endpoints ───────────────────────────────────────────────
router.get("/", requireAdmin, async (_req, res) => {
  try {
    const q = await pool.query(`SELECT * FROM general_exams ORDER BY id DESC`);
    res.json(q.rows.map(normalizeExamRow));
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (!title) return res.status(400).json({ error: "Başlık gerekli." });

    const duration = Math.max(1, Number(b.duration_minutes || 30));
    const passScore = Math.max(0, Math.min(100, Number(b.pass_score || 70)));
    const maxAttempts = Math.max(1, Number(b.max_attempts != null ? b.max_attempts : 3));
    const isPublished = !!b.is_published;
    const startsAt = b.starts_at ? new Date(b.starts_at) : null;
    const endsAt = b.ends_at ? new Date(b.ends_at) : null;

    const proctor = b.proctor && typeof b.proctor === "object" ? b.proctor : {};
    const qs = Array.isArray(b.questions) ? b.questions : [];

    const ins = await pool.query(
      `
        INSERT INTO general_exams
          (title, description, is_published, duration_minutes, pass_score, max_attempts, starts_at, ends_at, proctor, questions, created_by)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
        RETURNING *
      `,
      [
        title,
        String(b.description || ""),
        isPublished,
        duration,
        passScore,
        maxAttempts,
        startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt.toISOString() : null,
        endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt.toISOString() : null,
        JSON.stringify(proctor),
        JSON.stringify(qs),
        req.user.id,
      ]
    );
    res.json(normalizeExamRow(ins.rows[0]));
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Geçersiz id." });

    const cur = await pool.query(`SELECT * FROM general_exams WHERE id = $1`, [id]);
    if (!cur.rows[0]) return res.status(404).json({ error: "Sınav bulunamadı." });

    const b = req.body || {};
    const title = b.title != null ? String(b.title || "").trim() : cur.rows[0].title;
    if (!title) return res.status(400).json({ error: "Başlık gerekli." });

    const duration = b.duration_minutes != null ? Math.max(1, Number(b.duration_minutes || 30)) : cur.rows[0].duration_minutes;
    const passScore = b.pass_score != null ? Math.max(0, Math.min(100, Number(b.pass_score || 70))) : cur.rows[0].pass_score;
    const maxAttempts =
      b.max_attempts != null ? Math.max(1, Number(b.max_attempts || 1)) : Number(cur.rows[0].max_attempts != null ? cur.rows[0].max_attempts : 3);
    const isPublished = b.is_published != null ? !!b.is_published : cur.rows[0].is_published;
    const startsAt = b.starts_at !== undefined ? (b.starts_at ? new Date(b.starts_at) : null) : (cur.rows[0].starts_at ? new Date(cur.rows[0].starts_at) : null);
    const endsAt = b.ends_at !== undefined ? (b.ends_at ? new Date(b.ends_at) : null) : (cur.rows[0].ends_at ? new Date(cur.rows[0].ends_at) : null);

    const proctor = b.proctor !== undefined ? (b.proctor && typeof b.proctor === "object" ? b.proctor : {}) : cur.rows[0].proctor;
    const qs = b.questions !== undefined ? (Array.isArray(b.questions) ? b.questions : []) : cur.rows[0].questions;
    const description = b.description !== undefined ? String(b.description || "") : (cur.rows[0].description || "");

    const up = await pool.query(
      `
        UPDATE general_exams
        SET title=$2, description=$3, is_published=$4, duration_minutes=$5, pass_score=$6, max_attempts=$7,
            starts_at=$8, ends_at=$9, proctor=$10::jsonb, questions=$11::jsonb, updated_at=NOW()
        WHERE id=$1
        RETURNING *
      `,
      [
        id,
        title,
        description,
        isPublished,
        duration,
        passScore,
        maxAttempts,
        startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt.toISOString() : null,
        endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt.toISOString() : null,
        JSON.stringify(proctor),
        JSON.stringify(qs),
      ]
    );
    res.json(normalizeExamRow(up.rows[0]));
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Geçersiz id." });
    await pool.query(`DELETE FROM general_exams WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

/** Admin: tüm öğrencilerin tamamlanmış genel sınav denemeleri. ?exam_id= ile sınav filtresi. */
router.get("/attempts", requireAdmin, async (req, res) => {
  try {
    const examId = req.query.exam_id != null && req.query.exam_id !== "" ? Number(req.query.exam_id) : null;
    const base = `
      SELECT
        a.id AS attempt_id,
        a.exam_id,
        e.title AS exam_title,
        a.user_id,
        u.name AS user_name,
        u.email,
        a.score,
        a.passed,
        a.started_at,
        a.submitted_at,
        a.violations_count
      FROM general_exam_attempts a
      JOIN users u ON u.id = a.user_id AND u.role = 'student'
      JOIN general_exams e ON e.id = a.exam_id
      WHERE a.submitted_at IS NOT NULL`;
    if (Number.isFinite(examId) && examId > 0) {
      const q = await pool.query(
        `${base} AND a.exam_id = $1 ORDER BY a.submitted_at DESC LIMIT 800`,
        [examId]
      );
      return res.json({ attempts: q.rows });
    }
    const q = await pool.query(`${base} ORDER BY a.submitted_at DESC LIMIT 800`);
    res.json({ attempts: q.rows });
  } catch (err) {
    console.error("GET /exams/attempts:", err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── Student endpoints ─────────────────────────────────────────────
router.get("/available", requireStudent, async (req, res) => {
  try {
    const userId = req.user.id;
    const q = await pool.query(
      `SELECT e.*, ac.attempts_used,
          lr.score AS last_score, lr.passed AS last_passed, lr.submitted_at AS last_submitted_at
       FROM general_exams e
       CROSS JOIN LATERAL (
         SELECT COUNT(*)::int AS attempts_used FROM general_exam_attempts a WHERE a.exam_id = e.id AND a.user_id = $1
       ) ac
       LEFT JOIN LATERAL (
         SELECT score, passed, submitted_at FROM general_exam_attempts a
         WHERE a.exam_id = e.id AND a.user_id = $1 AND a.submitted_at IS NOT NULL
         ORDER BY a.submitted_at DESC
         LIMIT 1
       ) lr ON TRUE
       WHERE e.is_published = TRUE
       ORDER BY e.id DESC`,
      [userId]
    );
    const list = q.rows
      .map((row) => {
        const lastResult =
          row.last_submitted_at != null
            ? {
                score: Number(row.last_score || 0),
                passed: !!row.last_passed,
                submitted_at: row.last_submitted_at,
              }
            : null;
        const e = normalizeExamRow(row);
        e.attempts_used = Number(row.attempts_used || 0);
        return { e, lastResult };
      })
      .filter((x) => isExamAvailableNow(x.e));
    res.json(
      list.map(({ e, lastResult }) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        duration_minutes: e.duration_minutes,
        pass_score: e.pass_score,
        max_attempts: e.max_attempts,
        attempts_used: e.attempts_used,
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        proctor: e.proctor,
        last_result: lastResult,
      }))
    );
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

/** Most recent completed attempt (any published exam), for student exams tab summary. */
router.get("/last-result", requireStudent, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT a.exam_id, e.title AS exam_title, a.score, a.passed, a.submitted_at
       FROM general_exam_attempts a
       JOIN general_exams e ON e.id = a.exam_id
       WHERE a.user_id = $1 AND a.submitted_at IS NOT NULL
       ORDER BY a.submitted_at DESC
       LIMIT 1`,
      [req.user.id]
    );
    const row = q.rows[0];
    if (!row) return res.json({ last: null });
    res.json({
      last: {
        exam_id: Number(row.exam_id),
        exam_title: row.exam_title || "",
        score: Number(row.score || 0),
        passed: !!row.passed,
        submitted_at: row.submitted_at,
      },
    });
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

router.get("/:id", requireStudent, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const q = await pool.query(`SELECT * FROM general_exams WHERE id = $1`, [id]);
    const row = q.rows[0];
    if (!row) return res.status(404).json({ error: "Sınav bulunamadı." });
    const ex = normalizeExamRow(row);
    if (!isExamAvailableNow(ex)) return res.status(403).json({ error: "Bu sınav şu an erişilebilir değil." });

    const atQ = await pool.query(
      `SELECT id, score, passed, started_at, submitted_at, violations_count
       FROM general_exam_attempts
       WHERE exam_id = $1 AND user_id = $2
       ORDER BY started_at DESC`,
      [id, req.user.id]
    );
    res.json({
      exam: safeExamForStudent(ex),
      attempts: atQ.rows,
      attempts_used: atQ.rows.length,
      max_attempts: ex.max_attempts,
    });
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

router.post("/:id/start", requireStudent, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const q = await pool.query(`SELECT * FROM general_exams WHERE id = $1`, [id]);
    const row = q.rows[0];
    if (!row) return res.status(404).json({ error: "Sınav bulunamadı." });
    const ex = normalizeExamRow(row);
    if (!isExamAvailableNow(ex)) return res.status(403).json({ error: "Bu sınav şu an erişilebilir değil." });

    const cntQ = await pool.query(
      `SELECT COUNT(*)::int AS c FROM general_exam_attempts WHERE exam_id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    const used = Number(cntQ.rows[0].c || 0);
    if (used >= ex.max_attempts) {
      return res.status(403).json({
        error: "Deneme hakkınız doldu.",
        attempts_used: used,
        max_attempts: ex.max_attempts,
      });
    }

    const meta = req.body && typeof req.body.meta === "object" ? req.body.meta : {};
    const ins = await pool.query(
      `INSERT INTO general_exam_attempts (exam_id, user_id, meta) VALUES ($1,$2,$3::jsonb) RETURNING id, started_at`,
      [id, req.user.id, JSON.stringify(meta)]
    );
    const attempt = ins.rows[0];
    const startedAt = new Date(attempt.started_at);
    const deadlineMs = startedAt.getTime() + ex.duration_minutes * 60 * 1000;

    res.json({
      attempt_id: attempt.id,
      started_at: attempt.started_at,
      deadline_at: new Date(deadlineMs).toISOString(),
      duration_minutes: ex.duration_minutes,
      proctor: ex.proctor,
    });
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

router.post("/:id/proctor", requireStudent, async (req, res) => {
  try {
    const examId = Number(req.params.id);
    const attemptId = Number(req.body?.attempt_id);
    const eventType = String(req.body?.event_type || "").trim();
    const details = req.body && typeof req.body.details === "object" ? req.body.details : {};
    const isViolation = req.body?.is_violation === true;

    if (!Number.isFinite(examId) || !Number.isFinite(attemptId) || !eventType) {
      return res.status(400).json({ error: "Eksik parametre." });
    }

    const atQ = await pool.query(
      `SELECT a.*, e.proctor
       FROM general_exam_attempts a
       JOIN general_exams e ON e.id = a.exam_id
       WHERE a.id = $1 AND a.exam_id = $2 AND a.user_id = $3`,
      [attemptId, examId, req.user.id]
    );
    const at = atQ.rows[0];
    if (!at) return res.status(404).json({ error: "Deneme bulunamadı." });
    if (at.submitted_at) return res.json({ ok: true, ignored: true });

    await pool.query(
      `INSERT INTO general_exam_proctor_events (attempt_id, event_type, details) VALUES ($1,$2,$3::jsonb)`,
      [attemptId, eventType, JSON.stringify(details)]
    );

    let violations = Number(at.violations_count || 0);
    if (isViolation) {
      violations += 1;
      await pool.query(`UPDATE general_exam_attempts SET violations_count = $2 WHERE id = $1`, [attemptId, violations]);
    }

    const proctor = at.proctor && typeof at.proctor === "object" ? at.proctor : {};
    const maxV = Math.max(0, Number(proctor.max_violations || 3));
    res.json({ ok: true, violations_count: violations, max_violations: maxV });
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

router.post("/:id/submit", requireStudent, async (req, res) => {
  try {
    const examId = Number(req.params.id);
    const attemptId = Number(req.body?.attempt_id);
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];

    if (!Number.isFinite(examId) || !Number.isFinite(attemptId)) {
      return res.status(400).json({ error: "Eksik parametre." });
    }

    const exQ = await pool.query(`SELECT * FROM general_exams WHERE id = $1`, [examId]);
    const exRow = exQ.rows[0];
    if (!exRow) return res.status(404).json({ error: "Sınav bulunamadı." });
    const ex = normalizeExamRow(exRow);

    const atQ = await pool.query(
      `SELECT * FROM general_exam_attempts WHERE id=$1 AND exam_id=$2 AND user_id=$3`,
      [attemptId, examId, req.user.id]
    );
    const at = atQ.rows[0];
    if (!at) return res.status(404).json({ error: "Deneme bulunamadı." });
    if (at.submitted_at) {
      return res.json({
        attempt_id: attemptId,
        score: Number(at.score || 0),
        passed: !!at.passed,
        already_submitted: true,
      });
    }

    let correct = 0;
    for (let i = 0; i < ex.questions.length; i++) {
      if (Number(answers[i]) === Number(ex.questions[i].correct_index)) correct += 1;
    }
    const total = ex.questions.length;
    const score = total ? Math.round((correct / total) * 100) : 0;
    const passed = score >= Number(ex.pass_score || 70);

    const up = await pool.query(
      `
        UPDATE general_exam_attempts
        SET submitted_at = NOW(), score = $2, passed = $3, answers = $4::jsonb
        WHERE id = $1
        RETURNING id, started_at, submitted_at, score, passed, violations_count
      `,
      [attemptId, score, passed, JSON.stringify(answers)]
    );

    const examTitle = String(ex.title || "").trim();
    pool
      .query(
        `INSERT INTO admin_activity_events
          (actor_user_id, actor_name, actor_email, event_type, exam_score, passed, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          req.user.id,
          req.user.name,
          req.user.email,
          passed ? "general_exam_passed" : "general_exam_failed",
          Number(score || 0),
          !!passed,
          JSON.stringify({ exam_id: examId, exam_title: examTitle }),
        ]
      )
      .catch(() => {});

    res.json({
      exam_id: examId,
      attempt: up.rows[0],
      score,
      passed,
      pass_score: ex.pass_score,
      correct_count: correct,
      total_questions: total,
    });
  } catch {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

module.exports = router;

