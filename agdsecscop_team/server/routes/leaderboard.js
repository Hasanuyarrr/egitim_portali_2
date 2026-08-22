const express = require("express");
const pool    = require("../db/client");
const { authenticate, requireAdmin } = require("../middleware/auth");

function lessonTitlesFromJson(lessons) {
  if (lessons == null) return [];
  let arr = lessons;
  if (typeof lessons === "string") {
    try {
      arr = JSON.parse(lessons);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((l, i) => (l && (l.title || l.name)) || `Ders ${i + 1}`);
}

const router = express.Router();
router.use(authenticate);

// GET /api/leaderboard — ranked by CTF score, then progress
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH base AS (
        SELECT
          u.id,
          u.name,
          u.email,
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
              SELECT COUNT(*)::int
              FROM ctf_solves cs
              WHERE cs.user_id = u.id
            ),
            0
          ) AS solve_count,
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
      SELECT
        id,
        name,
        email,
        ctf_score,
        solve_count,
        progress_pct,
        RANK() OVER (ORDER BY ctf_score DESC, progress_pct DESC, id ASC)::int AS rank
      FROM base
      ORDER BY rank, id
    `);

    // Öğrenciler için e-posta gizlenir: liderlik tablosu tüm sınıfın
    // e-posta adreslerini herkese açmamalı (KVKK / veri minimizasyonu).
    const isAdmin = req.user.role === "admin";
    const result = rows.map((r) => {
      const isMe = r.id === req.user.id;
      const row = { ...r, is_me: isMe };
      if (!isAdmin && !isMe) delete row.email;
      return row;
    });

    res.json(result);
  } catch (err) {
    console.error("GET /api/leaderboard error:", err.message);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// GET /api/leaderboard/timeline — all CTF solves ordered by time
router.get("/timeline", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        cs.solved_at,
        u.id        AS user_id,
        u.name      AS user_name,
        c.id        AS challenge_id,
        c.title     AS challenge_title,
        c.category,
        c.difficulty,
        c.points
      FROM ctf_solves cs
      JOIN users          u ON u.id = cs.user_id
      JOIN ctf_challenges c ON c.id = cs.challenge_id
      WHERE u.role = 'student'
      ORDER BY cs.solved_at ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// GET /api/leaderboard/progress-stats — admin: modül ve ders bazlı özet
router.get("/progress-stats", requireAdmin, async (req, res) => {
  try {
    const { rows: modRows } = await pool.query(`
      SELECT
        m.id AS module_id,
        m.title,
        m.order_num,
        m.total_lessons,
        m.lessons,
        COUNT(p.user_id)::int AS opened_count,
        COUNT(*) FILTER (
          WHERE m.total_lessons > 0 AND p.completed_lessons >= m.total_lessons
        )::int AS completed_count,
        COALESCE(
          ROUND(
            AVG(
              CASE
                WHEN m.total_lessons > 0 THEN 100.0 * p.completed_lessons / m.total_lessons
              END
            )
          )::int,
          0
        ) AS avg_pct
      FROM modules m
      LEFT JOIN progress p ON p.module_id = m.id
      GROUP BY m.id, m.title, m.order_num, m.total_lessons, m.lessons
      ORDER BY m.order_num
    `);

    const { rows: bucketRows } = await pool.query(`
      SELECT
        m.id AS module_id,
        m.title,
        m.total_lessons,
        p.completed_lessons AS at_lesson,
        COUNT(*)::int AS student_count,
        COALESCE(
          json_agg(
            json_build_object('id', u.id, 'name', u.name, 'email', u.email)
            ORDER BY u.name
          ),
          '[]'::json
        ) AS students
      FROM progress p
      JOIN modules m ON m.id = p.module_id
      JOIN users u ON u.id = p.user_id AND u.role = 'student'
      WHERE m.total_lessons > 0
      GROUP BY m.id, m.title, m.order_num, m.total_lessons, p.completed_lessons
      ORDER BY m.order_num, p.completed_lessons
    `);

    const bucketsByModule = {};
    for (const r of bucketRows) {
      const id = r.module_id;
      if (!bucketsByModule[id]) bucketsByModule[id] = [];
      let students = r.students;
      if (typeof students === "string") {
        try {
          students = JSON.parse(students);
        } catch {
          students = [];
        }
      }
      if (!Array.isArray(students)) students = [];
      bucketsByModule[id].push({
        at_lesson: Number(r.at_lesson),
        student_count: Number(r.student_count),
        students,
      });
    }

    const modules = modRows.map((r) => ({
      module_id: r.module_id,
      title: r.title,
      order_num: r.order_num,
      total_lessons: Number(r.total_lessons) || 0,
      lesson_titles: lessonTitlesFromJson(r.lessons),
      opened_count: Number(r.opened_count) || 0,
      completed_count: Number(r.completed_count) || 0,
      avg_pct: Number(r.avg_pct) || 0,
      lesson_buckets: bucketsByModule[r.module_id] || [],
    }));

    res.json({ modules });
  } catch (err) {
    console.error("GET /leaderboard/progress-stats:", err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// GET /api/leaderboard/ctf-challenge-solvers — admin: görev başına kim çözdü
router.get("/ctf-challenge-solvers", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id AS challenge_id,
        c.title,
        c.category,
        c.difficulty,
        c.points,
        COALESCE(
          json_agg(
            json_build_object(
              'user_id', u.id,
              'name', u.name,
              'email', u.email,
              'solved_at', cs.solved_at
            ) ORDER BY cs.solved_at ASC
          ) FILTER (WHERE cs.id IS NOT NULL),
          '[]'::json
        ) AS solvers
      FROM ctf_challenges c
      LEFT JOIN ctf_solves cs ON cs.challenge_id = c.id
      LEFT JOIN users u ON u.id = cs.user_id AND u.role = 'student'
      GROUP BY c.id, c.title, c.category, c.difficulty, c.points
      ORDER BY c.id
    `);

    const challenges = rows.map((r) => {
      let solvers = r.solvers;
      if (typeof solvers === "string") {
        try {
          solvers = JSON.parse(solvers);
        } catch {
          solvers = [];
        }
      }
      if (!Array.isArray(solvers)) solvers = [];
      return {
        challenge_id: r.challenge_id,
        title: r.title,
        category: r.category,
        difficulty: r.difficulty,
        points: Number(r.points) || 0,
        solvers,
      };
    });

    res.json({ challenges });
  } catch (err) {
    console.error("GET /leaderboard/ctf-challenge-solvers:", err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// GET /api/leaderboard/learning-activity — admin: modül/ders tamamlama zamanları
router.get("/learning-activity", requireAdmin, async (req, res) => {
  try {
    const { rows: mcRows } = await pool.query(`
      SELECT
        m.id AS module_id,
        m.title AS module_title,
        u.id AS user_id,
        u.name AS user_name,
        u.email,
        MAX(mlc.completed_at) AS completed_at
      FROM module_lesson_completions mlc
      JOIN modules m ON m.id = mlc.module_id
      JOIN users u ON u.id = mlc.user_id
      WHERE u.role = 'student' AND m.total_lessons > 0
      GROUP BY m.id, m.title, m.total_lessons, u.id, u.name, u.email
      HAVING COUNT(DISTINCT mlc.lesson_index) >= m.total_lessons
      ORDER BY MAX(mlc.completed_at) DESC NULLS LAST
    `);

    const { rows: evRows } = await pool.query(`
      SELECT
        mlc.id,
        mlc.user_id,
        u.name AS user_name,
        u.email,
        mlc.module_id,
        m.title AS module_title,
        m.lessons,
        m.total_lessons,
        mlc.lesson_index,
        mlc.completed_at
      FROM module_lesson_completions mlc
      JOIN modules m ON m.id = mlc.module_id
      JOIN users u ON u.id = mlc.user_id
      WHERE u.role = 'student'
      ORDER BY mlc.completed_at DESC
      LIMIT 800
    `);

    const lesson_events = evRows.map((r) => {
      const titles = lessonTitlesFromJson(r.lessons);
      const li = Number(r.lesson_index);
      return {
        id: r.id,
        user_id: r.user_id,
        user_name: r.user_name,
        email: r.email,
        module_id: r.module_id,
        module_title: r.module_title,
        lesson_index: li,
        lesson_title: titles[li] || `Ders ${li + 1}`,
        completed_at: r.completed_at,
      };
    });

    const module_completions = mcRows.map((r) => ({
      module_id: r.module_id,
      module_title: r.module_title,
      user_id: r.user_id,
      user_name: r.user_name,
      email: r.email,
      completed_at: r.completed_at,
    }));

    res.json({ module_completions, lesson_events });
  } catch (err) {
    console.error("GET /leaderboard/learning-activity:", err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// GET /api/leaderboard/exam-results — admin: modül sınav denemeleri
router.get("/exam-results", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        a.id,
        a.attempted_at,
        a.score,
        a.passed,
        u.id AS user_id,
        u.name AS user_name,
        u.email,
        m.id AS module_id,
        m.title AS module_title
      FROM module_exam_attempts a
      JOIN users u ON u.id = a.user_id AND u.role = 'student'
      JOIN modules m ON m.id = a.module_id
      ORDER BY a.attempted_at DESC
      LIMIT 800
    `);
    res.json({ attempts: rows });
  } catch (err) {
    console.error("GET /leaderboard/exam-results:", err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

module.exports = router;
