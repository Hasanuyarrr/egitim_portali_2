const express = require("express");
const pool    = require("../db/client");
const { authenticate } = require("../middleware/auth");
const { guardNumericParams } = require("../lib/validate");

const router = express.Router();
guardNumericParams(router, ["moduleId"]);
router.use(authenticate);

pool
  .query(`
    CREATE TABLE IF NOT EXISTS module_lesson_completions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
      lesson_index INTEGER NOT NULL CHECK (lesson_index >= 0),
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, module_id, lesson_index)
    )
  `)
  .catch((err) => console.warn("module_lesson_completions migration:", err.message));

pool
  .query(`
    CREATE INDEX IF NOT EXISTS idx_mlc_module ON module_lesson_completions(module_id);
    CREATE INDEX IF NOT EXISTS idx_mlc_user ON module_lesson_completions(user_id);
    CREATE INDEX IF NOT EXISTS idx_mlc_completed ON module_lesson_completions(completed_at DESC);
  `)
  .catch(() => {});

/** Mevcut progress satırlarından ders adımlarını bir kerelik doldurur (tarih: progress.updated_at). */
pool
  .query(`
    INSERT INTO module_lesson_completions (user_id, module_id, lesson_index, completed_at)
    SELECT p.user_id, p.module_id, gs.i::int, p.updated_at
    FROM progress p
    JOIN modules m ON m.id = p.module_id
    CROSS JOIN LATERAL generate_series(
      0,
      GREATEST(LEAST(p.completed_lessons, m.total_lessons) - 1, -1)
    ) AS gs(i)
    WHERE m.total_lessons > 0
      AND p.completed_lessons > 0
    ON CONFLICT (user_id, module_id, lesson_index) DO NOTHING
  `)
  .catch((err) => console.warn("module_lesson_completions backfill:", err.message));

function sanitizeExamForStudent(exam) {
  if (!exam || typeof exam !== "object") return null;
  const questions = Array.isArray(exam.questions) ? exam.questions : [];
  return {
    enabled: !!exam.enabled,
    pass_score: Number(exam.pass_score || 70),
    max_attempts: Number(exam.max_attempts || 0),
    questions: questions.map((q) => ({
      question: q.question || "",
      options: Array.isArray(q.options) ? q.options : [],
    })),
  };
}

// GET /api/progress — caller's full progress summary
router.get("/", async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    const { rows } = await pool.query(`
      SELECT
        m.id AS module_id,
        m.title,
        m.description,
        m.summary,
        m.information,
        m.topics,
        m.lessons,
        m.exam,
        m.links,
        m.total_lessons,
        m.order_num,
        COALESCE(a.cnt, 0)::int AS attachment_count,
        COALESCE(p.completed_lessons, 0) AS completed_lessons,
        CASE WHEN m.total_lessons = 0 THEN 0
             ELSE ROUND(100.0 * COALESCE(p.completed_lessons,0) / m.total_lessons)::int
        END AS pct,
        p.updated_at
      FROM modules m
      LEFT JOIN progress p ON p.module_id = m.id AND p.user_id = $1
      LEFT JOIN (
        SELECT module_id, COUNT(*)::int AS cnt FROM module_attachments GROUP BY module_id
      ) a ON a.module_id = m.id
      WHERE ($2::text = 'admin' OR m.is_locked = FALSE)
      ORDER BY m.order_num
    `, [req.user.id, isAdmin ? "admin" : "student"]);

    const withFiles = await Promise.all(rows.map(async (r) => {
      const { rows: att } = await pool.query(
        `SELECT id, file_name, kind FROM module_attachments WHERE module_id = $1 ORDER BY kind, id`,
        [r.module_id]
      );
      return { ...r, files: att.rows, exam: sanitizeExamForStudent(r.exam) };
    }));

    // overall %
    const totalLessons    = withFiles.reduce((s, r) => s + r.total_lessons, 0);
    const completedLessons = withFiles.reduce((s, r) => s + parseInt(r.completed_lessons), 0);
    const overall_pct      = totalLessons
      ? Math.round((completedLessons / totalLessons) * 100)
      : 0;

    res.json({ overall_pct, modules: withFiles });
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// PUT /api/progress/:moduleId — update completed_lessons
router.put("/:moduleId", async (req, res) => {
  const { completed_lessons } = req.body;
  const moduleId = parseInt(req.params.moduleId);

  if (completed_lessons === undefined || isNaN(completed_lessons)) {
    return res.status(400).json({ error: "completed_lessons alanı zorunludur." });
  }

  try {
    // Verify module exists + get total + titles (for admin activity feed)
    const mod = req.user.role === "admin"
      ? await pool.query("SELECT total_lessons, title, lessons FROM modules WHERE id=$1", [moduleId])
      : await pool.query("SELECT total_lessons, title, lessons FROM modules WHERE id=$1 AND is_locked = FALSE", [moduleId]);
    if (!mod.rows[0]) return res.status(404).json({ error: "Modül bulunamadı." });

    const modRow = mod.rows[0];
    const totalLessons = Number(modRow.total_lessons) || 0;
    const moduleTitle = modRow.title || "";
    let lessonsArr = modRow.lessons;
    if (typeof lessonsArr === "string") {
      try { lessonsArr = JSON.parse(lessonsArr); } catch { lessonsArr = []; }
    }
    if (!Array.isArray(lessonsArr)) lessonsArr = [];
    const capped = Math.min(Math.max(0, parseInt(completed_lessons, 10)), totalLessons);

    const prevQ = await pool.query(
      "SELECT completed_lessons FROM progress WHERE user_id = $1 AND module_id = $2",
      [req.user.id, moduleId]
    );
    const oldVal = Number(prevQ.rows[0]?.completed_lessons ?? 0);

    const { rows } = await pool.query(`
      INSERT INTO progress (user_id, module_id, completed_lessons, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, module_id)
      DO UPDATE SET completed_lessons = $3, updated_at = NOW()
      RETURNING *
    `, [req.user.id, moduleId, capped]);

    if (totalLessons > 0) {
      if (capped < oldVal) {
        await pool.query(
          `DELETE FROM module_lesson_completions
           WHERE user_id = $1 AND module_id = $2 AND lesson_index >= $3`,
          [req.user.id, moduleId, capped]
        );
      } else {
        const shouldLog = req.user.role === "student";
        for (let idx = oldVal; idx < capped; idx++) {
          const ins = await pool.query(
            `INSERT INTO module_lesson_completions (user_id, module_id, lesson_index, completed_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (user_id, module_id, lesson_index) DO NOTHING
             RETURNING lesson_index`,
            [req.user.id, moduleId, idx]
          );

          if (shouldLog && ins.rows[0]) {
            const lessonTitle =
              (lessonsArr[idx] && (lessonsArr[idx].title || lessonsArr[idx].name)) ||
              `Ders ${Number(idx) + 1}`;
            pool
              .query(
                `
                INSERT INTO admin_activity_events
                  (actor_user_id, actor_name, actor_email, event_type,
                   module_id, module_title, lesson_index, lesson_title)
                VALUES ($1,$2,$3,'lesson_completed',$4,$5,$6,$7)
              `,
                [req.user.id, req.user.name, req.user.email, moduleId, moduleTitle, idx, lessonTitle]
              )
              .catch(() => {});
          }
        }

        // Module completed event (crossing from not-completed -> completed)
        if (shouldLog && oldVal < totalLessons && capped === totalLessons) {
          pool
            .query(
              `
              INSERT INTO admin_activity_events
                (actor_user_id, actor_name, actor_email, event_type,
                 module_id, module_title, points)
              VALUES ($1,$2,$3,'module_completed',$4,$5,NULL)
            `,
              [req.user.id, req.user.name, req.user.email, moduleId, moduleTitle]
            )
            .catch(() => {});
        }
      }
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

module.exports = router;
