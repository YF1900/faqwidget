// 教員・管理者アカウントの作成（生徒はクラス参加コードで自分で登録します）
// 使い方: npm run create-user -- --role teacher --login t-sato --name "佐藤先生"
//   パスワードは対話入力（画面に表示されません）。CI などでは環境変数 NEW_PASSWORD でも指定できます。
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { openDb, now } from '../server/db.js';
import { hashPassword, newId, MIN_PASSWORD } from '../server/auth.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const role = args.role || 'teacher';
if (!['teacher', 'admin'].includes(role) || !args.login || !args.name) {
  console.error('使い方: npm run create-user -- --role teacher|admin --login <ログインID> --name <表示名>');
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]{3,32}$/.test(args.login)) { console.error('ログインIDは半角英数字と . _ - で3〜32文字'); process.exit(1); }

async function askPassword() {
  if (process.env.NEW_PASSWORD) return process.env.NEW_PASSWORD;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes('パスワード')) rl.output.write(s); };
  const pw = await new Promise((r) => rl.question('パスワード: ', r));
  rl.close(); process.stdout.write('\n');
  return pw;
}
const password = await askPassword();
if (password.length < MIN_PASSWORD) { console.error(`パスワードは${MIN_PASSWORD}文字以上`); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(process.env.DB_FILE || path.join(root, 'data', 'app.db'));
if (db.prepare('SELECT 1 FROM users WHERE login_id = ?').get(args.login)) { console.error('そのログインIDは既にあります'); process.exit(1); }
db.prepare('INSERT INTO users (id, role, login_id, display_name, pw_hash, created_at) VALUES (?,?,?,?,?,?)')
  .run(newId('u_'), role, args.login, args.name, hashPassword(password), now());
console.log(`${role} アカウント「${args.login}」を作成しました`);
