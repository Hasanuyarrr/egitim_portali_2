const { Pool } = require("pg");
const config = require("../config");

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  // Üretimde TLS zorunlu ve sertifika doğrulanır.
  // RDS kullanıyorsanız DB_CA_CERT_PATH ile Amazon kök paketini verin;
  // aksi hâlde doğrulama Node'un gömülü kök listesine bakar ve
  // "self signed certificate in certificate chain" hatası alabilirsiniz.
  ssl: config.isProd
    ? { rejectUnauthorized: true, ...(config.DB_CA_CERT ? { ca: config.DB_CA_CERT } : {}) }
    : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Uzun süren sorgular bağlantı havuzunu kilitlemesin.
  statement_timeout: 15_000,
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

module.exports = pool;
