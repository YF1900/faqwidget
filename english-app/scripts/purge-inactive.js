// 保存期間を過ぎた生徒アカウントとその学習データを削除します（データ最小化・保存期間の管理）
// 使い方: npm run purge-inactive -- --days 400 [--dry-run]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { deleteUserCompletely } from '../server/app.js';

const argv = process.argv.slice(2);
const days = Number(argv[argv.indexOf('--days') + 1]);
const dry = argv.includes('--dry-run');
if (!argv.includes('--days') || !Number.isFinite(days) || days < 30) { console.error('使い方: npm run purge-inactive -- --days <30以上の日数> [--dry-run]'); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(process.env.DB_FILE || path.join(root, 'data', 'app.db'));
const cutoff = new Date(Date.now() - days * 864e5).toISOString();
const rows = db.prepare("SELECT id, login_id FROM users WHERE role = 'student' AND COALESCE(last_active_at, created_at) < ?").all(cutoff);
for (const r of rows) { if (!dry) deleteUserCompletely(db, r.id); console.log(`${dry ? '[確認のみ] ' : ''}削除: ${r.login_id}`); }
console.log(`${rows.length} 件${dry ? '（削除していません）' : 'を削除しました'}`);
