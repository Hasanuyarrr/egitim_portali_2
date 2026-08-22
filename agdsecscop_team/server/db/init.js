/**
 * Run once to create tables and seed data:
 *   node db/init.js
 */
const fs     = require("fs");
const path   = require("path");
const bcrypt = require("bcryptjs");
const pool   = require("./client");

async function init() {
  // 1. Create schema (tables only, no inserts)
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("✓ Tables created.");

  // 2. Hash passwords and insert users
  // Sabit varsayilan sifre YOK: depoyu goren herkesin bildigi bir parola
  // ile admin hesabi acilmasin diye, ortam degiskeni verilmediginde
  // kriptografik rastgele bir sifre uretilir ve bir kez ekrana yazilir.
  const crypto = require("crypto");
  const randomPassword = () => crypto.randomBytes(12).toString("base64url") + "9a";

  const adminGenerated   = !process.env.SEED_ADMIN_PASSWORD;
  const studentGenerated = !process.env.SEED_STUDENT_PASSWORD;
  const adminPassword   = process.env.SEED_ADMIN_PASSWORD   || randomPassword();
  const studentPassword = process.env.SEED_STUDENT_PASSWORD || randomPassword();
  const [adminHash, studentHash] = await Promise.all([
    bcrypt.hash(adminPassword,   12),
    bcrypt.hash(studentPassword, 12),
  ]);

  await pool.query(`
    INSERT INTO users (email, password_hash, name, role) VALUES
    ($1, $2, 'Admin',          'admin'),
    ($3, $4, 'Selin Erdoğan',  'student'),
    ($5, $4, 'Ali Kaya',       'student'),
    ($6, $4, 'Zeynep Demir',   'student'),
    ($7, $4, 'Mert Yıldız',    'student'),
    ($8, $4, 'Emre Çelik',     'student')
    ON CONFLICT (email) DO NOTHING
  `, [
    "admin@edunova.com",  adminHash,
    "selin@edunova.com",  studentHash,
    "ali@edunova.com",
    "zeynep@edunova.com",
    "mert@edunova.com",
    "emre@edunova.com",
  ]);
  console.log("✓ Users seeded.");
  if (adminGenerated || studentGenerated) {
    console.log(
      "\n  UYARI: Aşağıdaki şifreler yalnızca ŞİMDİ gösteriliyor — kaydedin:"
    );
    if (adminGenerated)   console.log("    admin@edunova.com : " + adminPassword);
    if (studentGenerated) console.log("    öğrenci hesapları : " + studentPassword);
    console.log(
      "    (Sabitlemek için SEED_ADMIN_PASSWORD / SEED_STUDENT_PASSWORD ortam değişkenlerini kullanın.)\n"
    );
  }

  // 3. Seed modules
  await pool.query(`
    INSERT INTO modules (order_num, title, description, total_lessons, is_locked) VALUES
    (1, 'Network Temelleri',   'OSI modeli, TCP/IP, DNS, HTTP, paket analizi',             32, false),
    (2, 'Web Güvenliği',       'OWASP Top10, XSS, SQL Injection, CSRF, güvenli kodlama',   32, false),
    (3, 'Ağ İçi Saldırılar',  'ARP Spoofing, MitM, Sniffing, VLAN hopping',               28, true),
    (4, 'OS & Toollar',        'Kali Linux, Nmap, Burp Suite, Metasploit temelleri',        24, true),
    (5, 'CTF & Zafiyetler',    'Binary exploitation, reverse engineering, CTF metodolojisi',30, true),
    (6, 'Cloud Güvenliği',     'AWS/GCP güvenli mimari, IAM, güvenlik grupları, log izleme',20, true)
    ON CONFLICT DO NOTHING
  `);
  console.log("✓ Modules seeded.");

  // 4. Seed progress (need user ids)
  const users = await pool.query("SELECT id, email FROM users WHERE role='student' ORDER BY id");
  const mods  = await pool.query("SELECT id, order_num FROM modules ORDER BY order_num");
  const uid   = (email) => users.rows.find(u => u.email === email)?.id;
  const mid   = (num)   => mods.rows.find(m => m.order_num === num)?.id;

  const progressRows = [
    [uid("selin@edunova.com"),  mid(1), 32],
    [uid("selin@edunova.com"),  mid(2), 29],
    [uid("ali@edunova.com"),    mid(1), 32],
    [uid("ali@edunova.com"),    mid(2), 18],
    [uid("zeynep@edunova.com"), mid(1), 25],
    [uid("zeynep@edunova.com"), mid(2),  8],
    [uid("mert@edunova.com"),   mid(1), 12],
    [uid("emre@edunova.com"),   mid(1),  4],
  ].filter(r => r[0] && r[1]);

  for (const [userId, moduleId, completed] of progressRows) {
    await pool.query(
      `INSERT INTO progress (user_id, module_id, completed_lessons)
       VALUES ($1,$2,$3) ON CONFLICT (user_id, module_id) DO NOTHING`,
      [userId, moduleId, completed]
    );
  }
  console.log("✓ Progress seeded.");

  // 5. Seed CTF challenges
  await pool.query(`
    INSERT INTO ctf_challenges (title, description, category, difficulty, points, flag, file_path, file_name) VALUES
    ('SQLi Basics',     'Basit SQL enjeksiyon açığını bulup istismar et.', 'web',       'easy',   50,  'flag{sql_injection_101}', NULL, NULL),
    ('ARP Spoof Lab',   'Ağ içinde ARP zehirleme saldırısı gerçekleştir.', 'network',   'medium', 120, 'flag{arp_mitm_success}', NULL, NULL),
    ('RSA Break',       'Küçük üs saldırısı ile RSA şifreli metni çöz.',  'crypto',    'hard',   250, 'flag{rsa_small_e_attack}', NULL, NULL),
    ('PCAP Analysis',   'PCAP dosyasındaki gizli mesajı ortaya çıkar.',   'forensics', 'medium', 180, 'flag{wireshark_pro}', NULL, NULL),
    ('Buffer Overflow', 'Stack üzerindeki buffer overflow açığını kullan.','pwn',       'expert', 400, 'flag{stack_smashed}', NULL, NULL)
    ON CONFLICT DO NOTHING
  `);

  const chals = await pool.query("SELECT id FROM ctf_challenges ORDER BY id");
  const cid   = (i) => chals.rows[i]?.id;

  // Helper: past date offset by N days + random hours
  const daysAgo = (days, hourOffset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(d.getHours() - hourOffset);
    return d.toISOString();
  };

  // Solve events spread across the last 3 weeks — [userId, chalId, timestamp]
  const solveEvents = [
    // Week 1 — Selin starts first, quickly solves easy challenges
    [uid("selin@edunova.com"),  cid(0), daysAgo(20, 2)],   // SQLi Basics    day-20
    [uid("ali@edunova.com"),    cid(0), daysAgo(19, 5)],   // SQLi Basics    day-19
    [uid("zeynep@edunova.com"), cid(0), daysAgo(18, 3)],   // SQLi Basics    day-18

    // Week 2 — Medium challenges
    [uid("selin@edunova.com"),  cid(1), daysAgo(14, 1)],   // ARP Spoof Lab  day-14
    [uid("mert@edunova.com"),   cid(1), daysAgo(13, 6)],   // ARP Spoof Lab  day-13
    [uid("ali@edunova.com"),    cid(1), daysAgo(11, 4)],   // ARP Spoof Lab  day-11

    // Week 3 — Hard challenge, only Selin
    [uid("selin@edunova.com"),  cid(2), daysAgo(5, 2)],    // RSA Break      day-5
  ].filter(r => r[0] && r[1]);

  for (const [userId, chalId, solvedAt] of solveEvents) {
    await pool.query(
      `INSERT INTO ctf_solves (user_id, challenge_id, solved_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [userId, chalId, solvedAt]
    );
  }
  console.log("✓ CTF challenges and solves seeded.");

  // 6. Seed announcements
  const adminId = (await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1")).rows[0]?.id;
  await pool.query(`
    INSERT INTO announcements (title, body, created_by) VALUES
    ('CTF Yarışması Açıklandı 🚩',
     'Nisan ayı CTF yarışması 15 Nisan''da başlıyor. İlk 3''e sertifika verilecek. Katılmak için kayıt formunu doldurun.',
     $1),
    ('Yeni Lab Eklendi',
     'Active Directory saldırı senaryosu müfredata eklendi. Modül 4 tamamlayanlar hemen başlayabilir.',
     $1),
    ('Bug Bounty Takımı',
     'Genel ilerleme puanı %70 ve üzerinde olan öğrenciler bug bounty takımına başvurabilir.',
     $1)
  `, [adminId]);
  console.log("✓ Announcements seeded.");

  console.log(`\n✅ Database ready!\n   Admin:    admin@edunova.com / ${adminPassword}\n   Öğrenci:  selin@edunova.com / ${studentPassword}`);
  await pool.end();
}

init().catch(err => {
  console.error("✗ Init failed:", err.message);
  process.exit(1);
});
