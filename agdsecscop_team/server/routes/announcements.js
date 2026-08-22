const express = require("express");
const pool    = require("../db/client");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { guardNumericParams } = require("../lib/validate");

const router = express.Router();
guardNumericParams(router, ["id"]);
router.use(authenticate);

// GET /api/announcements
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.id, a.title, a.body, a.created_at,
             u.name AS author
      FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by
      ORDER BY a.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// POST /api/announcements — admin only
router.post("/", requireAdmin, async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: "Başlık ve içerik zorunludur." });
  }

  try {
    const { rows } = await pool.query(
      "INSERT INTO announcements (title, body, created_by) VALUES ($1,$2,$3) RETURNING *",
      [title.trim(), body.trim(), req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// DELETE /api/announcements/:id — admin only
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM announcements WHERE id=$1", [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Duyuru bulunamadı." });
    res.json({ message: "Duyuru silindi." });
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

module.exports = router;
