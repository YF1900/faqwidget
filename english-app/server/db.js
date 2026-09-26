// データベース（SQLite / Node.js 組み込みの node:sqlite）
// 外部サービスには一切送信しない。ファイルは data/ 配下に保存される。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- User / Role
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('student','teacher','admin')),
  login_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  privacy_version TEXT,
  privacy_agreed_at TEXT,
  created_at TEXT NOT NULL,
  last_active_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Class / Enrollment
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  join_open INTEGER NOT NULL DEFAULT 1,
  teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS enrollments (
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (class_id, user_id)
);

-- ExamTarget
CREATE TABLE IF NOT EXISTS exam_targets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  exam TEXT NOT NULL CHECK (exam IN ('A2','B1','B2','undecided')),
  planned_month TEXT,
  updated_at TEXT NOT NULL
);

-- SkillProgress（技能ごとの学習レベルとその決定根拠。習熟度は mastery.js で毎回算出）
CREATE TABLE IF NOT EXISTS skill_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill TEXT NOT NULL CHECK (skill IN ('reading','listening','writing','speaking')),
  level TEXT NOT NULL CHECK (level IN ('A2','B1','B2')),
  level_source TEXT NOT NULL CHECK (level_source IN ('default','diagnostic','student','teacher')),
  set_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, skill)
);
CREATE TABLE IF NOT EXISTS diagnostic_results (
  id TEXT PRIMARY KEY,
  client_id TEXT UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 教材: LearningUnit / LearningObjective / Activity / Question / Rubric / ContentVersion
CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  theme TEXT NOT NULL,
  theme_label TEXT NOT NULL,
  level TEXT NOT NULL,
  exam TEXT NOT NULL,
  order_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  title_ja TEXT NOT NULL,
  estimated_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  skill TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  kind TEXT NOT NULL,
  skill TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  version INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  version INTEGER NOT NULL DEFAULT 1,
  level TEXT NOT NULL,
  skill TEXT NOT NULL,
  theme TEXT NOT NULL,
  exam TEXT NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 2,
  objective_id TEXT,
  focus TEXT,
  type TEXT NOT NULL CHECK (type IN ('mcq','text')),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  author_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (entity_type, entity_id, version)
);
CREATE TABLE IF NOT EXISTS rubrics (
  id TEXT PRIMARY KEY,
  skill TEXT NOT NULL,
  level TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL
);

-- Answer / Attempt（選択式・短答）。question_version で解答時の版を記録する
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  question_version INTEGER NOT NULL,
  activity_id TEXT,
  context TEXT NOT NULL CHECK (context IN ('unit','review','diagnostic')),
  response TEXT NOT NULL,
  correct INTEGER NOT NULL,
  support TEXT NOT NULL DEFAULT '{}',
  attempt_no INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_question ON attempts(question_id);

-- 提出済み回答（Writing / Speaking）。再提出は parent_id と revision で区別
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  activity_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('writing','speaking')),
  text TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  self_check TEXT NOT NULL DEFAULT '[]',
  self_scores TEXT NOT NULL DEFAULT '{}',
  recorded_locally INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT REFERENCES submissions(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id, created_at);

-- Feedback（教員評価）。source は将来 'ai-estimate' を追加する場合に区別するための列
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'teacher' CHECK (source IN ('teacher')),
  scores TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- DraftAnswer（下書き。提出とは別管理）
CREATE TABLE IF NOT EXISTS drafts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, activity_id)
);

CREATE TABLE IF NOT EXISTS activity_completions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  activity_version INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, activity_id)
);

-- 単語・熟語・構文カードの小テストの解答
CREATE TABLE IF NOT EXISTS card_attempts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  response TEXT NOT NULL,
  correct INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_attempts_user ON card_attempts(user_id, card_id, created_at);

-- スタンプ（理解の証）。問題またはカードごとに1つ。一度もらうと消えない
CREATE TABLE IF NOT EXISTS stamps (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('question','card')),
  item_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_type, item_id)
);

-- ReviewSchedule（間隔反復による復習予定）
CREATE TABLE IF NOT EXISTS review_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  box INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => new Date().toISOString();
