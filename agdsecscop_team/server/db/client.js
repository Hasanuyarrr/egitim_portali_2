const { Pool } = require("pg");
const config = require("../config");

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  // Üretimde TLS zorunlu ve sertifika doğrulanır.
  ssl: config.isProd ? { rejectUnauthorized: true } : false,
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
