-- =========================================================
--  EduNova Akademi — PostgreSQL Schema + Seed Data
-- =========================================================

-- Drop existing tables (safe re-run)
DROP TABLE IF EXISTS ctf_solves       CASCADE;
DROP TABLE IF EXISTS ctf_challenges   CASCADE;
DROP TABLE IF EXISTS module_lesson_completions CASCADE;
DROP TABLE IF EXISTS progress         CASCADE;
DROP TABLE IF EXISTS certificates     CASCADE;
DROP TABLE IF EXISTS announcements    CASCADE;
DROP TABLE IF EXISTS module_attachments CASCADE;
DROP TABLE IF EXISTS modules          CASCADE;
DROP TABLE IF EXISTS users            CASCADE;

-- ── USERS ────────────────────────────────────────────────
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('student', 'admin')),
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ
);

-- ── MODULES ──────────────────────────────────────────────
CREATE TABLE modules (
  id             SERIAL PRIMARY KEY,
  order_num      INTEGER NOT NULL,
  title          VARCHAR(255) NOT NULL,
  description    TEXT,
  total_lessons  INTEGER DEFAULT 0,
  is_locked      BOOLEAN DEFAULT FALSE,
  summary        TEXT,
  notes          TEXT,
  information    TEXT,
  topics         JSONB DEFAULT '[]'::jsonb,
  lessons        JSONB DEFAULT '[]'::jsonb,
  exam           JSONB DEFAULT '{}'::jsonb,
  links          JSONB DEFAULT '[]'::jsonb
);

-- Modül ek dosyaları (PDF, slayt, video kayıtları vb.)
CREATE TABLE module_attachments (
  id          SERIAL PRIMARY KEY,
  module_id   INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  kind        VARCHAR(20) NOT NULL DEFAULT 'document'
              CHECK (kind IN ('document', 'video')),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── PROGRESS ─────────────────────────────────────────────
CREATE TABLE progress (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  module_id          INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  completed_lessons  INTEGER DEFAULT 0,
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, module_id)
);

-- Ders adımı tamamlanma zamanları (liderlik / rapor)
CREATE TABLE module_lesson_completions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id      INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  lesson_index   INTEGER NOT NULL CHECK (lesson_index >= 0),
  completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, module_id, lesson_index)
);

-- ── MODULE EXAM ATTEMPTS ────────────────────────────────
CREATE TABLE module_exam_attempts (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id     INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  score         INTEGER NOT NULL DEFAULT 0,
  passed        BOOLEAN NOT NULL DEFAULT FALSE,
  answers       JSONB DEFAULT '[]'::jsonb,
  attempted_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── CTF CHALLENGES ───────────────────────────────────────
CREATE TABLE ctf_challenges (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  category      VARCHAR(100),
  difficulty    VARCHAR(50)  CHECK (difficulty IN ('easy','medium','hard','expert')),
  points        INTEGER DEFAULT 0,
  flag          VARCHAR(255) NOT NULL,
  flag_format   VARCHAR(255) DEFAULT 'flag{...}',
  max_attempts  INTEGER NOT NULL DEFAULT 0,
  is_published  BOOLEAN NOT NULL DEFAULT TRUE,
  file_path     TEXT,
  file_name     VARCHAR(255)
);

-- ── CTF SOLVES ───────────────────────────────────────────
CREATE TABLE ctf_solves (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
  challenge_id INTEGER NOT NULL REFERENCES ctf_challenges(id)  ON DELETE CASCADE,
  solved_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, challenge_id)
);

-- ── CTF ATTEMPTS ─────────────────────────────────────────
CREATE TABLE ctf_attempts (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  challenge_id   INTEGER NOT NULL REFERENCES ctf_challenges(id) ON DELETE CASCADE,
  submitted_flag VARCHAR(255),
  is_correct     BOOLEAN NOT NULL DEFAULT FALSE,
  attempted_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── CERTIFICATES ─────────────────────────────────────────
CREATE TABLE certificates (
  id                 SERIAL PRIMARY KEY,
  verification_code  VARCHAR(40) UNIQUE NOT NULL,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              VARCHAR(500) NOT NULL,
  subtitle           TEXT,
  description        TEXT,
  issuer_signature   VARCHAR(200),
  issued_at          TIMESTAMPTZ DEFAULT NOW(),
  issued_by          INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- ── ANNOUNCEMENTS ────────────────────────────────────────
CREATE TABLE announcements (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data is handled programmatically by db/init.js
