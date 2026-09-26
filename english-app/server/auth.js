// 認証: パスワードは scrypt でハッシュ化、セッショントークンは SHA-256 ハッシュのみ保存する
import crypto from 'node:crypto';
import { now } from './db.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_DAYS = 14;
export const MIN_PASSWORD = 8;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(key, expected);
}

// ユーザーが存在しない場合も同じ計算時間をかけ、ログインIDの存在を推測されにくくする
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));
export function verifyPasswordOrDummy(password, stored) {
  if (!stored) { verifyPassword(password, DUMMY_HASH); return false; }
  return verifyPassword(password, stored);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), userId, now(), expires);
  return { token, expires };
}

export function getSessionUser(db, token) {
  if (!token || token.length > 100) return null;
  const row = db.prepare(`SELECT u.id, u.role, u.login_id, u.display_name, u.privacy_version, u.last_active_at, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  // 最終利用日時は1時間に1回だけ更新（書き込みを減らす）
  if (!row.last_active_at || Date.now() - Date.parse(row.last_active_at) > 36e5) {
    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now(), row.id);
  }
  return row;
}

export function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
}

// ログイン試行の制限（メモリ上。キーごとに15分で5回まで）
export class RateLimiter {
  constructor({ max = 5, windowMs = 15 * 60e3 } = {}) {
    this.max = max; this.windowMs = windowMs; this.map = new Map();
  }
  _entry(key) {
    const t = Date.now();
    let e = this.map.get(key);
    if (!e || t - e.start > this.windowMs) { e = { start: t, count: 0 }; this.map.set(key, e); }
    if (this.map.size > 10000) { for (const [k, v] of this.map) if (t - v.start > this.windowMs) this.map.delete(k); }
    return e;
  }
  blocked(key) { return this._entry(key).count >= this.max; }
  hit(key) { this._entry(key).count++; }
  reset(key) { this.map.delete(key); }
}

export function newId(prefix = '') {
  return prefix + crypto.randomBytes(12).toString('base64url');
}

// クラス参加コード（紛らわしい文字 0/O/1/I を除く8文字）
export function newJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
