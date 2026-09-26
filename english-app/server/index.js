// 起動: npm start（環境変数は README 参照）
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { loadContentDir, seedIfEmpty } from './content.js';
import { createApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.DB_FILE || path.join(root, 'data', 'app.db');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const production = process.env.NODE_ENV === 'production';
const secureCookies = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : production;

const db = openDb(dbFile);
const content = loadContentDir(path.join(root, 'content'));
if (seedIfEmpty(db, content)) console.log('教材データを取り込みました');
purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 6 * 3600e3).unref();

const server = http.createServer(createApp(db, {
  content, secureCookies,
  orgName: process.env.ORG_NAME || '', privacyContact: process.env.PRIVACY_CONTACT || '', retention: process.env.RETENTION_TEXT || '',
}));
server.requestTimeout = 30e3;
server.listen(port, host, () => {
  console.log(`English Steps: http://${host}:${port}/  (DB: ${dbFile}${secureCookies ? ', Secure Cookie' : ''})`);
  if (production && !secureCookies) console.warn('警告: 本番環境では HTTPS と COOKIE_SECURE=1 を使用してください');
});
