const express = require("express");
const path    = require("path");
const fs      = require("fs");
const multer  = require("multer");
const pool    = require("../db/client");
const config  = require("../config");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { guardNumericParams } = require("../lib/validate");

const router = express.Router();
guardNumericParams(router, ["id", "aid"]);
router.use(authenticate);

// Backward-compatible lightweight migration for existing environments.
pool.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS lessons JSONB DEFAULT '[]'::jsonb`)
  .catch((err) => console.warn("modules.lessons migration skipped:", err.message));
pool.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS exam JSONB DEFAULT '{}'::jsonb`)
  .catch((err) => console.warn("modules.exam migration skipped:", err.message));
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

function stripNotesIfStudent(row, req) {
  if (req.user.role === "admin") return row;
  const o = { ...row };
  delete o.notes;
  if (Array.isArray(o.lessons)) {
    o.lessons = o.lessons.map((l) => ({ ...l, notes: "" }));
  }
  if (o.exam && typeof o.exam === "object" && Array.isArray(o.exam.questions)) {
    o.exam = {
      enabled: !!o.exam.enabled,
      pass_score: Number(o.exam.pass_score || 70),
      max_attempts: Number(o.exam.max_attempts || 0),
      questions: o.exam.questions.map((q) => ({
        question: q.question || "",
        options: Array.isArray(q.options) ? q.options : [],
      })),
    };
  }
  return o;
}

const UPLOAD_DIR = path.join(config.UPLOAD_ROOT, "modules");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const crypto  = require("crypto");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = crypto.randomBytes(16).toString("hex");
    const ext    = path.extname(file.originalname).toLowerCase();
    cb(null, `${unique}${ext}`);
  },
});
const MAX_DOC_MB   = 80;
const MAX_VIDEO_MB = 500;

// İzin verilen modül dosya uzantıları
const MODULE_ALLOWED_EXT = new Set([
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
  ".txt", ".md",
  ".zip", ".tar", ".gz",
  ".png", ".jpg", ".jpeg", ".gif", ".svg",
  ".mp4", ".webm", ".mov", ".mkv", ".m4v",
]);

/** Kullanıcıdan gelen dosya adındaki tehlikeli karakterleri temizler */
function sanitizeFilename(name) {
  return path.basename(name)
    .replace(/[^\w\s.\-()[\]]/g, "_")
    .slice(0, 200);
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ext || !MODULE_ALLOWED_EXT.has(ext)) {
      return cb(new Error(`İzin verilmeyen dosya türü: ${ext || "(uzantısız)"}`));
    }
    cb(null, true);
  },
});

function normalizeTopics(topics) {
  if (!topics) return [];
  if (typeof topics === "string") {
    try {
      const j = JSON.parse(topics);
      if (Array.isArray(j)) return normalizeTopicsArray(j);
    } catch {
      /* legacy: satır satır */
    }
    return topics
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => ({ title: line, description: "" }));
  }
  if (Array.isArray(topics)) return normalizeTopicsArray(topics);
  return [];
}

function normalizeTopicsArray(arr) {
  return arr
    .filter((x) => x && (x.title || x.description))
    .map((x) => ({
      title: String(x.title || "").trim().slice(0, 300),
      description: String(x.description || "").trim().slice(0, 4000),
    }))
    .filter((x) => x.title || x.description);
}

function normalizeLinks(links) {
  if (!links) return [];
  if (Array.isArray(links)) {
    return links
      .filter((x) => x && (x.url || x.title))
      .map((x) => ({
        title: String(x.title || x.url || "Link").slice(0, 200),
        url: String(x.url || "").trim(),
        kind: x.kind === "video" ? "video" : "link",
      }))
      .filter((x) => x.url);
  }
  return [];
}

function normalizeLessonLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .filter((x) => x && (x.url || x.title))
    .map((x) => ({
      title: String(x.title || x.url || "Dosya").trim().slice(0, 200),
      url: String(x.url || "").trim(),
    }))
    .filter((x) => x.url);
}

function normalizeLessons(lessons) {
  if (!Array.isArray(lessons)) return [];
  return lessons
    .map((l, idx) => {
      const settings = l && typeof l.settings === "object" ? l.settings : {};
      return {
        title: String((l && l.title) || "").trim().slice(0, 300),
        content: String((l && l.content) || "").trim().slice(0, 12000),
        notes: String((l && l.notes) || "").trim().slice(0, 6000),
        files: normalizeLessonLinks(l && l.files),
        settings: {
          order: Number.isFinite(Number(settings.order)) ? Number(settings.order) : idx + 1,
          duration_min: Number.isFinite(Number(settings.duration_min)) ? Number(settings.duration_min) : 0,
          is_locked: !!settings.is_locked,
        },
      };
    })
    .filter((l) => l.title || l.content || l.files.length);
}

function normalizeExam(exam) {
  if (!exam || typeof exam !== "object") {
    return { enabled: false, pass_score: 70, max_attempts: 0, questions: [] };
  }
  const questions = Array.isArray(exam.questions) ? exam.questions : [];
  return {
    enabled: !!exam.enabled,
    pass_score: Math.max(0, Math.min(100, Number(exam.pass_score || 70))),
    max_attempts: Math.max(0, Number(exam.max_attempts || 0)),
    questions: questions.map((q) => {
      const opts = Array.isArray(q.options) ? q.options.map((o) => String(o || "").trim().slice(0, 400)) : [];
      const options = opts.filter(Boolean).slice(0, 6);
      const correct = Number.isFinite(Number(q.correct_index)) ? Number(q.correct_index) : 0;
      return {
        question: String(q.question || "").trim().slice(0, 1000),
        options,
        correct_index: Math.max(0, Math.min(options.length - 1, correct)),
      };
    }).filter((q) => q.question && q.options.length >= 2),
  };
}

function attachmentKindFromUpload(req) {
  const bodyKind = req.body && req.body.kind;
  if (bodyKind === "video") return "video";
  if (bodyKind === "document") return "document";
  const mt = req.file && req.file.mimetype;
  if (mt && String(mt).startsWith("video/")) return "video";
  return "document";
}

function assertAttachmentSize(req, kind) {
  const bytes = req.file && req.file.size;
  if (!bytes) return null;
  const max = kind === "video" ? MAX_VIDEO_MB * 1024 * 1024 : MAX_DOC_MB * 1024 * 1024;
  if (bytes > max) {
    const mb = kind === "video" ? MAX_VIDEO_MB : MAX_DOC_MB;
    return `Dosya çok büyük (maks. ${mb} MB).`;
  }
  return null;
}

// ── GET /api/modules — list + progress ────────────────────
router.get("/", async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    const { rows } = await pool.query(`
      SELECT
        m.id,
        m.order_num,
        m.title,
        m.description,
        m.total_lessons,
        m.is_locked,
        m.summary,
        m.information,
        m.notes,
        m.topics,
        m.lessons,
        m.exam,
        m.links,
        COALESCE(a.cnt, 0)::int AS attachment_count,
        COALESCE(doc.cnt, 0)::int AS document_count,
        COALESCE(vid.cnt, 0)::int AS video_count,
        COALESCE(p.completed_lessons, 0) AS completed_lessons,
        CASE WHEN m.total_lessons = 0 THEN 0
             ELSE ROUND(100.0 * COALESCE(p.completed_lessons, 0) / m.total_lessons)::int
        END AS progress_pct
      FROM modules m
      LEFT JOIN progress p ON p.module_id = m.id AND p.user_id = $1
      LEFT JOIN (
        SELECT module_id, COUNT(*)::int AS cnt FROM module_attachments GROUP BY module_id
      ) a ON a.module_id = m.id
      LEFT JOIN (
        SELECT module_id, COUNT(*)::int AS cnt FROM module_attachments WHERE kind = 'document' GROUP BY module_id
      ) doc ON doc.module_id = m.id
      LEFT JOIN (
        SELECT module_id, COUNT(*)::int AS cnt FROM module_attachments WHERE kind = 'video' GROUP BY module_id
      ) vid ON vid.module_id = m.id
      WHERE ($2::text = 'admin' OR m.is_locked = FALSE)
      ORDER BY m.order_num
    `, [req.user.id, isAdmin ? "admin" : "student"]);
    res.json(rows.map((r) => stripNotesIfStudent(r, req)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

const VIDEO_MIME = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".m4v": "video/x-m4v",
};

// ── GET /api/modules/:id/attachments/:aid/download ──────
router.get("/:id/attachments/:aid/download", async (req, res) => {
  try {
    if (req.user.role === "student") {
      const vis = await pool.query("SELECT id FROM modules WHERE id = $1 AND is_locked = FALSE", [req.params.id]);
      if (!vis.rows[0]) return res.status(404).json({ error: "Modül bulunamadı." });
    }
    const { rows } = await pool.query(
      `SELECT ma.file_path, ma.file_name, ma.module_id, ma.kind
       FROM module_attachments ma
       WHERE ma.id = $1 AND ma.module_id = $2`,
      [req.params.aid, req.params.id]
    );
    const row = rows[0];
    if (!row || !row.file_path) return res.status(404).json({ error: "Dosya bulunamadı." });
    // Path traversal koruması: dosya yalnızca modül yükleme dizininde olmalı
    const resolvedPath = path.resolve(row.file_path);
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
      return res.status(403).json({ error: "Erişim reddedildi." });
    }
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: "Dosya diskte yok." });

    const ext = path.extname(row.file_name).toLowerCase();
    // Yalnızca gerçek video dosyaları tarayıcıda inline oynatılır.
    // Aksi hâlde ?inline=1 ile yüklenen bir .svg/.html aynı origin'de
    // çalıştırılabilir hâle gelir (depolanmış XSS).
    const asVideo = row.kind === "video" && Object.prototype.hasOwnProperty.call(VIDEO_MIME, ext);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (asVideo) {
      res.setHeader("Content-Type", VIDEO_MIME[ext]);
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
      return fs.createReadStream(resolvedPath).pipe(res);
    }
    // Diğer her şey indirilir, açılmaz.
    res.setHeader("Content-Type", "application/octet-stream");
    res.download(resolvedPath, row.file_name);
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── GET /api/modules/:id — detail + attachments list ───────
router.get("/:id", async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    const { rows } = await pool.query(`
      SELECT m.*,
             COALESCE(p.completed_lessons, 0) AS completed_lessons,
             CASE WHEN m.total_lessons = 0 THEN 0
                  ELSE ROUND(100.0 * COALESCE(p.completed_lessons, 0) / m.total_lessons)::int
             END AS progress_pct
      FROM modules m
      LEFT JOIN progress p ON p.module_id = m.id AND p.user_id = $1
      WHERE m.id = $2
        AND ($3::text = 'admin' OR m.is_locked = FALSE)
    `, [req.user.id, req.params.id, isAdmin ? "admin" : "student"]);
    if (!rows[0]) return res.status(404).json({ error: "Modül bulunamadı." });

    const mod = rows[0];
    const att = await pool.query(
      `SELECT id, file_name, kind, uploaded_at FROM module_attachments WHERE module_id = $1 ORDER BY kind, id`,
      [req.params.id]
    );
    mod.attachments = att.rows;
    res.json(stripNotesIfStudent(mod, req));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── GET /api/modules/:id/exam — student-safe exam + attempts ─────
router.get("/:id/exam", async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    const { rows } = await pool.query(
      `SELECT id, title, exam FROM modules WHERE id = $1 AND ($2::text = 'admin' OR is_locked = FALSE)`,
      [req.params.id, isAdmin ? "admin" : "student"]
    );
    const mod = rows[0];
    if (!mod) return res.status(404).json({ error: "Modül bulunamadı." });
    const exam = normalizeExam(mod.exam);
    const safeExam = {
      enabled: !!exam.enabled,
      pass_score: exam.pass_score,
      max_attempts: exam.max_attempts,
      questions: exam.questions.map((q) => ({ question: q.question, options: q.options })),
    };
    const att = await pool.query(
      `SELECT id, score, passed, attempted_at
       FROM module_exam_attempts
       WHERE user_id = $1 AND module_id = $2
       ORDER BY attempted_at DESC`,
      [req.user.id, req.params.id]
    );
    res.json({
      module_id: mod.id,
      module_title: mod.title,
      exam: safeExam,
      attempts: att.rows,
    });
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── GET /api/modules/:id/exam/stats — admin exam analytics ───────
router.get("/:id/exam/stats", requireAdmin, async (req, res) => {
  try {
    const modQ = await pool.query(`SELECT id, title, exam FROM modules WHERE id = $1`, [req.params.id]);
    const mod = modQ.rows[0];
    if (!mod) return res.status(404).json({ error: "Modül bulunamadı." });
    const exam = normalizeExam(mod.exam);
    const attQ = await pool.query(
      `SELECT
         a.id,
         a.score,
         a.passed,
         a.attempted_at,
         u.id AS user_id,
         u.name,
         u.email
       FROM module_exam_attempts a
       JOIN users u ON u.id = a.user_id
       WHERE a.module_id = $1
       ORDER BY a.attempted_at DESC`,
      [req.params.id]
    );
    const attempts = attQ.rows;
    const totalAttempts = attempts.length;
    const uniqueUsers = new Set(attempts.map((a) => a.user_id)).size;
    const passedAttempts = attempts.filter((a) => a.passed).length;
    const avgScore = totalAttempts
      ? Math.round(attempts.reduce((s, a) => s + Number(a.score || 0), 0) / totalAttempts)
      : 0;
    res.json({
      module_id: mod.id,
      module_title: mod.title,
      exam: {
        enabled: exam.enabled,
        pass_score: exam.pass_score,
        max_attempts: exam.max_attempts,
        question_count: exam.questions.length,
      },
      summary: {
        total_attempts: totalAttempts,
        unique_users: uniqueUsers,
        passed_attempts: passedAttempts,
        pass_rate: totalAttempts ? Math.round((passedAttempts / totalAttempts) * 100) : 0,
        average_score: avgScore,
      },
      attempts,
    });
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── POST /api/modules/:id/exam/submit — score attempt ────────────
router.post("/:id/exam/submit", async (req, res) => {
  try {
    if (req.user.role !== "student") return res.status(403).json({ error: "Sadece öğrenciler sınava girebilir." });
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const modQ = await pool.query(
      `SELECT id, title, total_lessons, exam FROM modules WHERE id = $1 AND is_locked = FALSE`,
      [req.params.id]
    );
    const mod = modQ.rows[0];
    if (!mod) return res.status(404).json({ error: "Modül bulunamadı." });
    const progQ = await pool.query(
      `SELECT completed_lessons FROM progress WHERE user_id = $1 AND module_id = $2`,
      [req.user.id, req.params.id]
    );
    const completed = Number(progQ.rows[0]?.completed_lessons || 0);
    if (completed < Number(mod.total_lessons || 0)) {
      return res.status(400).json({ error: "Sınava girmek için önce modülü tamamlayın." });
    }

    const exam = normalizeExam(mod.exam);
    if (!exam.enabled || !exam.questions.length) return res.status(400).json({ error: "Bu modül için aktif sınav yok." });
    const prev = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM module_exam_attempts WHERE user_id=$1 AND module_id=$2`,
      [req.user.id, req.params.id]
    );
    const usedAttempts = Number(prev.rows[0]?.cnt || 0);
    if (exam.max_attempts > 0 && usedAttempts >= exam.max_attempts) {
      return res.status(400).json({ error: "Maksimum sınav deneme hakkı doldu." });
    }

    let correct = 0;
    for (let i = 0; i < exam.questions.length; i++) {
      if (Number(answers[i]) === Number(exam.questions[i].correct_index)) correct += 1;
    }
    const total = exam.questions.length;
    const score = total ? Math.round((correct / total) * 100) : 0;
    const passed = score >= Number(exam.pass_score || 70);
    const ins = await pool.query(
      `INSERT INTO module_exam_attempts (user_id, module_id, score, passed, answers)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       RETURNING id, score, passed, attempted_at`,
      [req.user.id, req.params.id, score, passed, JSON.stringify(answers)]
    );

    // Admin feed: exam pass/fail
    pool.query(
      `
        INSERT INTO admin_activity_events
          (actor_user_id, actor_name, actor_email, event_type,
           module_id, module_title, exam_score, passed)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `,
      [
        req.user.id,
        req.user.name,
        req.user.email,
        passed ? "exam_passed" : "exam_failed",
        Number(req.params.id),
        mod.title,
        Number(score || 0),
        !!passed,
      ]
    ).catch(() => {});

    res.json({
      module_id: Number(req.params.id),
      score,
      passed,
      pass_score: exam.pass_score,
      correct_count: correct,
      total_questions: total,
      attempt: ins.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── PUT /api/modules/:id — update (admin) ───────────────
router.put("/:id", requireAdmin, async (req, res) => {
  const b = req.body;
  try {
    const { rows: curRows } = await pool.query("SELECT * FROM modules WHERE id=$1", [req.params.id]);
    if (!curRows[0]) return res.status(404).json({ error: "Modül bulunamadı." });
    const c = curRows[0];

    const order_num     = b.order_num     !== undefined ? b.order_num     : c.order_num;
    const title         = b.title         !== undefined ? b.title         : c.title;
    const description   = b.description   !== undefined ? b.description   : c.description;
    const total_lessons = b.total_lessons !== undefined ? b.total_lessons : c.total_lessons;
    const is_locked     = b.is_locked     !== undefined ? b.is_locked     : c.is_locked;
    const summary       = b.summary       !== undefined ? b.summary       : c.summary;
    const information   = b.information   !== undefined ? b.information   : c.information;
    const notes         = b.notes         !== undefined ? b.notes         : c.notes;
    const topicsArr     = b.topics !== undefined ? normalizeTopics(b.topics) : normalizeTopics(c.topics);
    const lessonsArr    = b.lessons !== undefined ? normalizeLessons(b.lessons) : normalizeLessons(c.lessons);
    const examObj       = b.exam !== undefined ? normalizeExam(b.exam) : normalizeExam(c.exam);
    const linksArr      = b.links !== undefined ? normalizeLinks(b.links) : normalizeLinks(c.links);

    const { rows } = await pool.query(
      `UPDATE modules SET
        order_num=$1, title=$2, description=$3, total_lessons=$4, is_locked=$5,
        summary=$6, information=$7, notes=$8, topics=$9::jsonb, lessons=$10::jsonb, exam=$11::jsonb, links=$12::jsonb
      WHERE id=$13 RETURNING *`,
      [
        order_num,
        title,
        description,
        total_lessons,
        is_locked,
        summary,
        information,
        notes,
        JSON.stringify(topicsArr),
        JSON.stringify(lessonsArr),
        JSON.stringify(examObj),
        JSON.stringify(linksArr),
        req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── POST /api/modules — create (admin) ──────────────────
router.post("/", requireAdmin, async (req, res) => {
  const { order_num, title, description, total_lessons, is_locked, summary, information, notes, topics, lessons, exam, links } = req.body;
  if (!title) return res.status(400).json({ error: "Modül başlığı zorunludur." });

  const lj = JSON.stringify(normalizeLinks(links));
  const tj = JSON.stringify(normalizeTopics(topics));
  const le = JSON.stringify(normalizeLessons(lessons));
  const ex = JSON.stringify(normalizeExam(exam));

  try {
    const { rows } = await pool.query(
      `INSERT INTO modules (order_num, title, description, total_lessons, is_locked, summary, information, notes, topics, lessons, exam, links)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb) RETURNING *`,
      [
        order_num || 99,
        title,
        description || "",
        total_lessons || 0,
        is_locked || false,
        summary || null,
        information || null,
        notes || null,
        tj,
        le,
        ex,
        lj,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── POST /api/modules/:id/attachments — upload file ───────
router.post("/:id/attachments", requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Dosya gerekli." });
  try {
    const mod = await pool.query("SELECT id FROM modules WHERE id=$1", [req.params.id]);
    if (!mod.rows[0]) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: "Modül bulunamadı." });
    }
    const kind = attachmentKindFromUpload(req);
    const sizeErr = assertAttachmentSize(req, kind);
    if (sizeErr) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: sizeErr });
    }
    const { rows } = await pool.query(
      `INSERT INTO module_attachments (module_id, file_path, file_name, kind)
       VALUES ($1,$2,$3,$4) RETURNING id, file_name, kind, uploaded_at`,
      [req.params.id, req.file.path, sanitizeFilename(req.file.originalname), kind]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── DELETE /api/modules/:id/attachments/:aid ──────────────
router.delete("/:id/attachments/:aid", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM module_attachments WHERE id=$1 AND module_id=$2 RETURNING file_path",
      [req.params.aid, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Ek bulunamadı." });
    if (rows[0].file_path && fs.existsSync(rows[0].file_path)) fs.unlinkSync(rows[0].file_path);
    res.json({ message: "Silindi." });
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// ── DELETE /api/modules/:id — modülü tamamen sil (admin) ───
router.delete("/:id", requireAdmin, async (req, res) => {
  const moduleId = parseInt(req.params.id, 10);
  if (!Number.isFinite(moduleId) || moduleId < 1) {
    return res.status(400).json({ error: "Geçersiz modül." });
  }
  try {
    const { rows: pathRows } = await pool.query(
      "SELECT file_path FROM module_attachments WHERE module_id = $1",
      [moduleId]
    );
    const del = await pool.query("DELETE FROM modules WHERE id = $1 RETURNING id, title", [moduleId]);
    if (!del.rows[0]) return res.status(404).json({ error: "Modül bulunamadı." });
    for (const p of pathRows) {
      if (p.file_path && fs.existsSync(p.file_path)) {
        try {
          fs.unlinkSync(p.file_path);
        } catch (e) {
          console.warn("Ek dosya silinemedi:", p.file_path, e.message);
        }
      }
    }
    res.json({ message: "Modül silindi.", id: del.rows[0].id, title: del.rows[0].title });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

module.exports = router;
