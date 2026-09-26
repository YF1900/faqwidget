// 開発・検証用のデモデータ（本番では使用しないでください）
// 教員 demo-teacher / 生徒 demo-student（パスワードはいずれも demo-pass-123）とクラス（参加コード DEMO2026）を作成します。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, now } from '../server/db.js';
import { hashPassword, newId } from '../server/auth.js';
import { loadContentDir, seedIfEmpty } from '../server/content.js';
import { PRIVACY_VERSION } from '../server/app.js';

if (process.env.NODE_ENV === 'production') { console.error('本番環境ではデモデータを作成できません'); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(process.env.DB_FILE || path.join(root, 'data', 'app.db'));
seedIfEmpty(db, loadContentDir(path.join(root, 'content')));
const pw = hashPassword('demo-pass-123');
let teacher = db.prepare("SELECT id FROM users WHERE login_id = 'demo-teacher'").get();
if (!teacher) {
  teacher = { id: newId('u_') };
  db.prepare('INSERT INTO users (id, role, login_id, display_name, pw_hash, created_at) VALUES (?,?,?,?,?,?)').run(teacher.id, 'teacher', 'demo-teacher', 'デモ先生', pw, now());
}
let cls = db.prepare("SELECT id FROM classes WHERE join_code = 'DEMO2026'").get();
if (!cls) {
  cls = { id: newId('c_') };
  db.prepare('INSERT INTO classes (id, name, join_code, join_open, teacher_id, created_at) VALUES (?,?,?,1,?,?)').run(cls.id, '1年A組（デモ）', 'DEMO2026', teacher.id, now());
}
if (!db.prepare("SELECT 1 FROM users WHERE login_id = 'demo-student'").get()) {
  const id = newId('u_');
  db.prepare('INSERT INTO users (id, role, login_id, display_name, pw_hash, privacy_version, privacy_agreed_at, created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, 'student', 'demo-student', 'デモ生徒', pw, PRIVACY_VERSION, now(), now());
  db.prepare('INSERT INTO enrollments (class_id, user_id, created_at) VALUES (?,?,?)').run(cls.id, id, now());
}
console.log('デモデータ: demo-teacher / demo-student（パスワード demo-pass-123）、クラス参加コード DEMO2026');
