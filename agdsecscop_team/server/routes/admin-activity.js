const express = require("express");
const pool = require("../db/client");
const { authenticate, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// Lightweight migration (runs once on server start)
pool
  .query(`
    CREATE TABLE IF NOT EXISTS admin_activity_events (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      actor_name VARCHAR(120),
      actor_email VARCHAR(255),
      event_type VARCHAR(64) NOT NULL,

      challenge_id INTEGER,
      challenge_title VARCHAR(255),

      module_id INTEGER,
      module_title VARCHAR(255),
      lesson_index INTEGER,
      lesson_title VARCHAR(255),

      exam_score INTEGER,
      passed BOOLEAN,

      points INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      meta JSONB DEFAULT '{}'::jsonb
    );
  `)
  .catch((err) => console.warn("admin_activity_events migration:", err.message));

pool
  .query(`
    CREATE INDEX IF NOT EXISTS idx_admin_activity_created_at
      ON admin_activity_events(created_at DESC, id DESC);
  `)
  .catch(() => {});

// GET /api/admin/activity/events — admin feed
router.get("/events", requireAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || "12", 10)));
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10));
    const qRaw = req.query.q != null ? String(req.query.q).trim() : "";
    const typeRaw = req.query.type != null ? String(req.query.type).trim() : "";

    const sortRaw = req.query.sort != null ? String(req.query.sort).trim() : "time";
    const dirRaw = req.query.dir != null ? String(req.query.dir).trim() : "desc";

    const dir = dirRaw === "asc" ? "asc" : "desc";
    const sort = sortRaw === "name" ? "name" : "time";

    const typeAllowed = new Set([
      "ctf_correct",
      "lesson_completed",
      "module_completed",
      "exam_passed",
      "exam_failed",
      "general_exam_passed",
      "general_exam_failed",
    ]);
    const type = typeAllowed.has(typeRaw) ? typeRaw : "";

    const sortExpr = sort === "name"
      ? `COALESCE(actor_name, actor_email) ${dir}, created_at ${dir}, id ${dir}`
      : `created_at ${dir}, id ${dir}`;

    const { rows } = await pool.query(
      `
      SELECT
        id,
        actor_name,
        actor_email,
        event_type,
        challenge_title,
        module_title,
        lesson_index,
        lesson_title,
        exam_score,
        passed,
        points,
        meta,
        created_at
      FROM admin_activity_events
      WHERE ($3::text = '' OR actor_name ILIKE '%' || $3 || '%' OR actor_email ILIKE '%' || $3 || '%')
        AND ($4::text = '' OR event_type = $4)
      ORDER BY ${sortExpr}
      LIMIT $1 OFFSET $2
    `,
      [limit, offset, qRaw, type]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /api/admin/activity/events error:", err.message);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

module.exports = router;

