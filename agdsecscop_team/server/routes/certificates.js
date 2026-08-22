const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const pool = require("../db/client");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { guardNumericParams } = require("../lib/validate");

const router = express.Router();
guardNumericParams(router, ["id"]);

/**
 * Doğrulama endpoint'i kimlik doğrulaması istemez; bu yüzden kod deneme-yanılma
 * ile taranıp öğrenci ad-soyadları toplanabilir. IP başına sıkı sınır konur.
 */
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Çok fazla doğrulama denemesi. Lütfen daha sonra tekrar deneyin." },
});

pool
  .query(`
    CREATE TABLE IF NOT EXISTS certificates (
      id SERIAL PRIMARY KEY,
      verification_code VARCHAR(40) UNIQUE NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(500) NOT NULL,
      subtitle TEXT,
      description TEXT,
      issuer_signature VARCHAR(200),
      issued_at TIMESTAMPTZ DEFAULT NOW(),
      issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `)
  .catch((err) => console.warn("certificates table migration:", err.message));

pool
  .query(`ALTER TABLE certificates ADD COLUMN IF NOT EXISTS issuer_signature VARCHAR(200)`)
  .catch((err) => console.warn("certificates issuer_signature migration:", err.message));

function generateVerificationCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (n) =>
    Array.from({ length: n }, () => chars[crypto.randomInt(chars.length)]).join("");
  return `EDU-${part(4)}-${part(4)}-${part(4)}`;
}

async function insertWithUniqueCode(client, fields) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateVerificationCode();
    try {
      const { rows } = await client.query(
        `INSERT INTO certificates (verification_code, user_id, title, subtitle, description, issued_by, issuer_signature)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          code,
          fields.user_id,
          fields.title,
          fields.subtitle,
          fields.description,
          fields.issued_by,
          fields.issuer_signature ?? null,
        ]
      );
      return rows[0];
    } catch (e) {
      if (e.code !== "23505") throw e;
    }
  }
  throw new Error("Kod üretilemedi.");
}

// ── Public: doğrulama (token gerekmez) ───────────────────
router.get("/verify/:code", verifyLimiter, async (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!code || code.length < 8) {
      return res.status(400).json({ ok: false, error: "Geçersiz doğrulama kodu." });
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.title, c.subtitle, c.description, c.issued_at, c.verification_code,
              c.issuer_signature,
              u.name AS recipient_name,
              issuer.name AS issuer_name
       FROM certificates c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN users issuer ON issuer.id = c.issued_by
       WHERE UPPER(TRIM(c.verification_code)) = $1`,
      [code]
    );
    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: "Sertifika bulunamadı veya kod geçersiz." });
    }
    const r = rows[0];
    res.json({
      ok: true,
      verification_code: r.verification_code,
      title: r.title,
      subtitle: r.subtitle,
      description: r.description,
      issued_at: r.issued_at,
      recipient_name: r.recipient_name,
      issuer_signature: r.issuer_signature,
      issuer_name: r.issuer_name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

router.use(authenticate);

// GET / — öğrenci: kendi; admin: tümü (?user_id=)
router.get("/", async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    if (isAdmin) {
      const uid = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
      const { rows } = await pool.query(
        `SELECT c.*,
                u.name AS recipient_name, u.email AS recipient_email,
                issuer.name AS issuer_name
         FROM certificates c
         JOIN users u ON u.id = c.user_id
         LEFT JOIN users issuer ON issuer.id = c.issued_by
         WHERE ($1::int IS NULL OR c.user_id = $1)
         ORDER BY c.issued_at DESC`,
        [Number.isFinite(uid) && uid > 0 ? uid : null]
      );
      return res.json(rows);
    }
    if (req.user.role !== "student") {
      return res.status(403).json({ error: "Yetkisiz." });
    }
    const { rows } = await pool.query(
      `SELECT c.*, u.name AS recipient_name, issuer.name AS issuer_name
       FROM certificates c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN users issuer ON issuer.id = c.issued_by
       WHERE c.user_id = $1
       ORDER BY c.issued_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// GET /:id — tek kayıt (sahip veya admin), yalnızca sayısal id
router.get("/:id(\\d+)", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Geçersiz id." });
    const { rows } = await pool.query(
      `SELECT c.*, u.name AS recipient_name, u.email AS recipient_email,
              issuer.name AS issuer_name
       FROM certificates c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN users issuer ON issuer.id = c.issued_by
       WHERE c.id = $1`,
      [id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "Bulunamadı." });
    if (req.user.role !== "admin" && row.user_id !== req.user.id) {
      return res.status(403).json({ error: "Yetkisiz." });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  const { user_id, user_ids, title, subtitle, description, issuer_signature } = req.body;
  let ids = [];
  if (Array.isArray(user_ids) && user_ids.length > 0) {
    ids = [...new Set(user_ids.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0))];
  } else if (user_id != null && user_id !== "") {
    const uid = parseInt(user_id, 10);
    if (Number.isFinite(uid) && uid > 0) ids = [uid];
  }
  if (!ids.length) {
    return res.status(400).json({ error: "En az bir öğrenci seçin." });
  }
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "Sertifika başlığı zorunludur." });
  }
  const titleS = String(title).trim().slice(0, 500);
  const subS = subtitle ? String(subtitle).trim().slice(0, 2000) : null;
  const descS = description ? String(description).trim().slice(0, 4000) : null;
  const sigS =
    issuer_signature != null && String(issuer_signature).trim()
      ? String(issuer_signature).trim().slice(0, 200)
      : null;

  try {
    const { rows: okStudents } = await pool.query(
      "SELECT id FROM users WHERE role = 'student' AND id = ANY($1::int[])",
      [ids]
    );
    if (okStudents.length !== ids.length) {
      return res.status(400).json({ error: "Bazı öğrenciler bulunamadı veya geçersiz." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = [];
      for (const uid of ids) {
        const row = await insertWithUniqueCode(client, {
          user_id: uid,
          title: titleS,
          subtitle: subS,
          description: descS,
          issued_by: req.user.id,
          issuer_signature: sigS,
        });
        created.push(row);
      }
      await client.query("COMMIT");
      res.status(201).json({ created, count: created.length });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Kaydedilemedi." });
  }
});

// PUT /:id — admin: başlık / alt başlık / açıklama / alıcı güncelle
router.put("/:id(\\d+)", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Geçersiz id." });
  const { title, subtitle, description, user_id, issuer_signature } = req.body;

  try {
    const ex = await pool.query("SELECT id FROM certificates WHERE id = $1", [id]);
    if (!ex.rows[0]) return res.status(404).json({ error: "Bulunamadı." });

    const updates = [];
    const vals = [];
    let n = 1;

    if (title !== undefined) {
      const t = String(title).trim();
      if (!t) return res.status(400).json({ error: "Başlık boş olamaz." });
      updates.push(`title = $${n++}`);
      vals.push(t.slice(0, 500));
    }
    if (subtitle !== undefined) {
      updates.push(`subtitle = $${n++}`);
      vals.push(subtitle ? String(subtitle).trim().slice(0, 2000) : null);
    }
    if (description !== undefined) {
      updates.push(`description = $${n++}`);
      vals.push(description ? String(description).trim().slice(0, 4000) : null);
    }
    if (user_id !== undefined && user_id !== null) {
      const uid = parseInt(user_id, 10);
      if (!Number.isFinite(uid) || uid < 1) {
        return res.status(400).json({ error: "Geçerli öğrenci seçin." });
      }
      const uq = await pool.query("SELECT id FROM users WHERE id = $1 AND role = 'student'", [uid]);
      if (!uq.rows[0]) return res.status(400).json({ error: "Öğrenci bulunamadı." });
      updates.push(`user_id = $${n++}`);
      vals.push(uid);
    }
    if (issuer_signature !== undefined) {
      updates.push(`issuer_signature = $${n++}`);
      vals.push(
        issuer_signature == null || String(issuer_signature).trim() === ""
          ? null
          : String(issuer_signature).trim().slice(0, 200)
      );
    }

    if (!updates.length) {
      return res.status(400).json({ error: "Güncellenecek alan belirtin." });
    }

    vals.push(id);
    await pool.query(`UPDATE certificates SET ${updates.join(", ")} WHERE id = $${n}`, vals);

    const { rows } = await pool.query(
      `SELECT c.*, u.name AS recipient_name, u.email AS recipient_email,
              issuer.name AS issuer_name
       FROM certificates c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN users issuer ON issuer.id = c.issued_by
       WHERE c.id = $1`,
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Güncellenemedi." });
  }
});

router.delete("/:id(\\d+)", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rowCount } = await pool.query("DELETE FROM certificates WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Bulunamadı." });
    res.json({ message: "Silindi." });
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

module.exports = router;
