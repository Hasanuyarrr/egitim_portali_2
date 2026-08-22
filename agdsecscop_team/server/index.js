const config    = require("./config");   // .env yükler + doğrular (fail-fast)
const express   = require("express");
const cors      = require("cors");
const path      = require("path");
const rateLimit = require("express-rate-limit");

const {
  securityHeaders,
  noStoreApi,
  PUBLIC_ROOT_FILES,
  isAllowedPanelFile,
} = require("./middleware/security");

const app = express();

// Sunucu teknolojisini ifşa etme
app.disable("x-powered-by");
// Rate limit'in gerçek istemci IP'sini görmesi için (reverse proxy arkasında)
app.set("trust proxy", config.TRUST_PROXY);

// ── Güvenlik başlıkları ───────────────────────────────────
app.use(securityHeaders);

// ── CORS ──────────────────────────────────────────────────
// Üretimde yalnızca CORS_ORIGINS listesindeki tam origin'ler.
// Geliştirmede ek olarak localhost/127.0.0.1 (herhangi bir port) kabul edilir.
// "null" origin (file:// veya sandbox'lı iframe) ARTIK KABUL EDİLMEZ:
// credentials:true ile birlikte bu, herhangi bir yerel HTML dosyasının
// oturum açmış kullanıcının verisini okumasına izin veriyordu.
function isAllowedOrigin(origin) {
  if (config.CORS_ORIGINS.includes(origin)) return true;
  if (config.isProd) return false;
  try {
    const u = new URL(origin);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

app.use(cors({
  origin: (origin, cb) => {
    // Origin başlığı yok = tarayıcı dışı istemci (curl/Postman). Tarayıcı
    // kaynaklı bir CSRF riski taşımaz; token yine de zorunludur.
    if (!origin) return cb(null, true);
    cb(null, isAllowedOrigin(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 600,
}));

// ── Gövde boyutu sınırı (bellek tüketimi / DoS) ───────────
app.use(express.json({ limit: "1mb" }));

// ── Genel API hız sınırı ──────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,                     // IP başına dakikada 300 istek
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Çok fazla istek gönderildi. Lütfen biraz bekleyin." },
});
app.use("/api", apiLimiter, noStoreApi);

// ── Routes ────────────────────────────────────────────────
app.use("/api/auth",           require("./routes/auth"));
app.use("/api/students",       require("./routes/students"));
app.use("/api/modules",        require("./routes/modules"));
app.use("/api/progress",       require("./routes/progress"));
app.use("/api/announcements",  require("./routes/announcements"));
app.use("/api/leaderboard",    require("./routes/leaderboard"));
app.use("/api/ctf",            require("./routes/ctf"));
app.use("/api/certificates",   require("./routes/certificates"));
app.use("/api/admin/activity", require("./routes/admin-activity"));
app.use("/api/exams",          require("./routes/exams"));

// ── Health check ──────────────────────────────────────────
// Sürüm/ortam bilgisi sızdırmaz.
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ── 404 — yalnızca /api/* ─────────────────────────────────
app.use("/api", (req, res) => res.status(404).json({ error: `${req.method} ${req.path} bulunamadı.` }));

// ══════════════════════════════════════════════════════════
//  STATİK DOSYALAR — SIKI İZİN LİSTESİ
//
//  Önceden `express.static(ROOT)` ile TÜM proje kökü yayınlanıyordu; bu
//  yüzden aşağıdakiler kimlik doğrulaması olmadan indirilebiliyordu:
//    /Database/edunova.sql   → kullanıcı e-postaları, bcrypt hash'leri, CTF flag'leri
//    /server/.env            → veritabanı şifresi ve JWT_SECRET
//    /server/routes/*.js     → tüm sunucu kaynak kodu
//    /server/uploads/**      → yetkisiz dosya erişimi
//
//  Artık yalnızca aşağıda açıkça listelenen dosyalar servis edilir.
// ══════════════════════════════════════════════════════════
const ROOT      = path.join(__dirname, "..");
const PANEL_DIR = path.join(ROOT, "admin");

const STATIC_OPTS = {
  index: false,
  dotfiles: "deny",
  redirect: false,
  etag: true,
  maxAge: "5m",
};

// /admin ve /admin/ → giriş sayfası
app.get(["/admin", "/admin/"], (_req, res) => res.redirect(302, "/admin/login.html"));

// Panel varlıkları (yalnızca izin verilen uzantılar)
app.use("/admin", (req, res, next) => {
  if (!isAllowedPanelFile(req.path)) return res.status(404).send("Not found");
  next();
}, express.static(PANEL_DIR, STATIC_OPTS));

// Kök seviyedeki tanıtım sayfaları — sabit izin listesi (path traversal imkânsız)
app.get(/^\/(?:[^/]*)$/, (req, res, next) => {
  let name;
  try {
    name = decodeURIComponent(req.path).replace(/^\/+/, "");
  } catch {
    return res.status(400).send("Bad request");
  }
  if (name === "") name = "index.html";
  if (!PUBLIC_ROOT_FILES.has(name)) return next();
  res.sendFile(path.join(ROOT, name));
});

// Geriye kalan her şey (Database/, server/, uploads/, .env, .DS_Store …)
app.use((_req, res) => res.status(404).send("Not found"));

// ── Hata yakalayıcı ───────────────────────────────────────
// Yığın izi (stack trace) asla istemciye gönderilmez.
app.use((err, req, res, _next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Gönderilen veri çok büyük." });
  }
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err.stack || err);
  res.status(500).json({ error: "Beklenmeyen bir hata oluştu." });
});

// ── Başlat ────────────────────────────────────────────────
const server = app.listen(config.PORT, () => {
  console.log(`EduNova API → http://localhost:${config.PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n✗ Port ${config.PORT} zaten kullanımda.`);
    console.error(`  Çözmek için: lsof -ti :${config.PORT} | xargs kill -9\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
