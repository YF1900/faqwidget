// HTTP サーバー本体（外部依存なし）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { now, tx } from './db.js';
import {
  hashPassword, verifyPasswordOrDummy, createSession, getSessionUser, deleteSession, RateLimiter, newId, newJoinCode, SESSION_DAYS, MIN_PASSWORD,
} from './auth.js';
import {
  getUnit, getQuestion, updateQuestion, createQuestion, updateActivity, setUnitStatus, listVersions, exportUnit, upsertUnit, getRubrics, LEVELS, SKILLS,
} from './content.js';
import { publicDiagnostic, scoreDiagnostic } from './diagnostic.js';
import { nextReviewState } from './review.js';
import { cardsForUnit, findCard, syncStamp, recordCardAttempt, questionAttemptsFor, cardAttemptsFor, CARD_TYPES } from './cards.js';
import { evaluateStamp, titleFor, TITLES, STAMP_STREAK } from './stamps.js';
import {
  dashboardFor, unitsWithProgress, getLevels, getTarget, progressFor, completionsFor, historyFor, latestDiagnostic, dueReviewCount, frequentMistakes,
} from './services.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
export const PRIVACY_VERSION = '2026-09-01';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const fail = (status, message, details) => { throw new HttpError(status, message, details); };

const J = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
export const countWords = (t) => (String(t || '').trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;

export function normalizeText(s) {
  return String(s || '').normalize('NFKC').replace(/[’‘]/g, "'").trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}

export function gradeQuestion(q, response) {
  if (q.type === 'mcq') return Number.isInteger(response) && response === q.answer;
  if (q.type === 'text') return typeof response === 'string' && q.accept.map(normalizeText).includes(normalizeText(response));
  return false;
}

function securityHeaders(res, secure) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'; worker-src 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, '送信データが大きすぎます')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSONの形式が正しくありません')); }
    });
    req.on('error', reject);
  });
}

export function createApp(db, opts = {}) {
  const secureCookies = !!opts.secureCookies;
  const diagnostic = opts.content.diagnostic;
  const loginLimiter = new RateLimiter({ max: 5, windowMs: 15 * 60e3 });
  // 教室で一斉に登録するため、同一IPからの登録は1時間あたり opts.registerLimit 件（既定 60）まで
  const registerLimiter = new RateLimiter({ max: opts.registerLimit || 60, windowMs: 60 * 60e3 });
  const routes = [];
  const route = (method, pattern, handler, { role = 'any', auth = true } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, role, auth });
  };

  const setSessionCookie = (res, token) => {
    res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secureCookies ? '; Secure' : ''}`);
  };
  const clearSessionCookie = (res) => res.setHeader('Set-Cookie', `sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies ? '; Secure' : ''}`);

  const isTeacher = (u) => u.role === 'teacher' || u.role === 'admin';
  const canAccessStudent = (u, studentId) => {
    if (u.role === 'admin') return true;
    return !!db.prepare('SELECT 1 FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.user_id = ? AND c.teacher_id = ?').get(studentId, u.id);
  };
  const ownClass = (u, classId) => {
    const c = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!c || (u.role !== 'admin' && c.teacher_id !== u.id)) fail(404, 'クラスが見つかりません');
    return c;
  };

  const meInfo = (u) => {
    const classes = db.prepare('SELECT c.id, c.name FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.user_id = ?').all(u.id);
    return {
      user: { id: u.id, role: u.role, loginId: u.login_id, displayName: u.display_name, privacyVersion: u.privacy_version },
      privacyVersion: PRIVACY_VERSION, needsPrivacyAgreement: u.privacy_version !== PRIVACY_VERSION,
      target: getTarget(db, u.id), levels: getLevels(db, u.id), classes, hasDiagnostic: !!latestDiagnostic(db, u.id),
    };
  };

  // ---------- 認証 ----------
  route('GET', '/api/me', ({ user }) => meInfo(user));

  route('POST', '/api/auth/login', ({ body, req, res }) => {
    const loginId = str(body.loginId, 64).trim(); const password = str(body.password, 200);
    const key = `${req.socket.remoteAddress}|${loginId.toLowerCase()}`;
    if (loginLimiter.blocked(key)) fail(429, 'ログインの試行回数が多すぎます。15分ほど待ってから再度お試しください。');
    const u = db.prepare('SELECT * FROM users WHERE login_id = ?').get(loginId);
    if (!verifyPasswordOrDummy(password, u?.pw_hash)) { loginLimiter.hit(key); fail(401, 'ログインIDまたはパスワードが正しくありません'); }
    loginLimiter.reset(key);
    const { token } = createSession(db, u.id);
    setSessionCookie(res, token);
    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now(), u.id);
    return meInfo(u);
  }, { auth: false });

  route('POST', '/api/auth/register', ({ body, req, res }) => {
    const ip = req.socket.remoteAddress;
    if (registerLimiter.blocked(ip)) fail(429, '登録の試行回数が多すぎます。しばらく待ってから再度お試しください。');
    registerLimiter.hit(ip);
    const joinCode = str(body.joinCode, 20).trim().toUpperCase();
    const loginId = str(body.loginId, 64).trim();
    const displayName = str(body.displayName, 40).trim();
    const password = str(body.password, 200);
    const errors = [];
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(loginId)) errors.push('ログインIDは半角英数字と . _ - で3〜32文字にしてください');
    if (!displayName || displayName.length > 20) errors.push('表示名は1〜20文字にしてください');
    if (password.length < MIN_PASSWORD || password.length > 128) errors.push(`パスワードは${MIN_PASSWORD}文字以上にしてください`);
    if (body.privacyAgreed !== true) errors.push('個人情報の取り扱いへの同意が必要です');
    if (errors.length) fail(400, errors[0], errors);
    const cls = db.prepare('SELECT * FROM classes WHERE join_code = ? AND join_open = 1').get(joinCode);
    if (!cls) fail(400, 'クラス参加コードが正しくないか、受付が終了しています');
    if (db.prepare('SELECT 1 FROM users WHERE login_id = ?').get(loginId)) fail(409, 'そのログインIDは使われています。別のIDにしてください');
    const id = newId('u_');
    tx(db, () => {
      db.prepare('INSERT INTO users (id, role, login_id, display_name, pw_hash, privacy_version, privacy_agreed_at, created_at, last_active_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, 'student', loginId, displayName, hashPassword(password), PRIVACY_VERSION, now(), now(), now());
      db.prepare('INSERT INTO enrollments (class_id, user_id, created_at) VALUES (?,?,?)').run(cls.id, id, now());
    });
    const { token } = createSession(db, id);
    setSessionCookie(res, token);
    return meInfo(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }, { auth: false });

  route('POST', '/api/auth/logout', ({ req, res }) => {
    deleteSession(db, parseCookies(req.headers.cookie).sid);
    clearSessionCookie(res);
    return { ok: true };
  }, { auth: false });

  route('POST', '/api/me/privacy-agreement', ({ user, body }) => {
    if (body.agreed !== true) fail(400, '同意が必要です');
    db.prepare('UPDATE users SET privacy_version = ?, privacy_agreed_at = ? WHERE id = ?').run(PRIVACY_VERSION, now(), user.id);
    return { ok: true };
  });

  route('GET', '/api/config', () => ({ orgName: opts.orgName || '', privacyContact: opts.privacyContact || '', retention: opts.retention || '' }), { auth: false });

  route('PUT', '/api/me/profile', ({ user, body }) => {
    const displayName = str(body.displayName, 40).trim();
    if (!displayName || displayName.length > 20) fail(400, '表示名は1〜20文字にしてください');
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, user.id);
    return { displayName };
  });

  route('POST', '/api/me/password', ({ user, body }) => {
    const u = db.prepare('SELECT pw_hash FROM users WHERE id = ?').get(user.id);
    if (!verifyPasswordOrDummy(str(body.current, 200), u.pw_hash)) fail(400, '現在のパスワードが正しくありません');
    const next = str(body.next, 200);
    if (next.length < MIN_PASSWORD || next.length > 128) fail(400, `新しいパスワードは${MIN_PASSWORD}文字以上にしてください`);
    db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
    return { ok: true };
  });

  // 自分のデータの書き出し（開示・データポータビリティ）
  route('GET', '/api/me/export', ({ user }) => {
    const all = (sql) => db.prepare(sql).all(user.id);
    return {
      exportedAt: now(), note: 'このアプリに保存されているあなたのデータです。録音は端末内にのみ保存され、ここには含まれません。',
      profile: db.prepare('SELECT id, role, login_id, display_name, privacy_version, privacy_agreed_at, created_at, last_active_at FROM users WHERE id = ?').get(user.id),
      classes: all('SELECT c.name, e.created_at AS joined_at FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.user_id = ?'),
      examTarget: getTarget(db, user.id),
      skillProgress: all('SELECT skill, level, level_source, updated_at FROM skill_progress WHERE user_id = ?'),
      diagnostics: all('SELECT result, created_at FROM diagnostic_results WHERE user_id = ?').map((r) => ({ ...r, result: J(r.result, {}) })),
      attempts: all('SELECT question_id, question_version, context, response, correct, support, attempt_no, created_at FROM attempts WHERE user_id = ?'),
      submissions: all('SELECT id, activity_id, activity_version, kind, text, word_count, self_check, self_scores, recorded_locally, revision, created_at FROM submissions WHERE user_id = ?'),
      feedback: all('SELECT f.submission_id, f.scores, f.comment, f.created_at FROM feedback f JOIN submissions s ON s.id = f.submission_id WHERE s.user_id = ?'),
      drafts: all('SELECT activity_id, text, updated_at FROM drafts WHERE user_id = ?'),
      completions: all('SELECT activity_id, activity_version, completed_at FROM activity_completions WHERE user_id = ?'),
      reviewSchedule: all('SELECT question_id, box, due_at, reason FROM review_items WHERE user_id = ?'),
      cardAttempts: all('SELECT card_id, response, correct, created_at FROM card_attempts WHERE user_id = ?'),
      stamps: all('SELECT item_type, item_id, level, category, earned_at FROM stamps WHERE user_id = ?'),
    };
  });

  // 退会（アカウントと学習データの完全削除）
  route('POST', '/api/me/delete', ({ user, body, req, res }) => {
    if (user.role !== 'student') fail(403, '教員・管理者アカウントの削除は管理者が行います');
    const u = db.prepare('SELECT pw_hash FROM users WHERE id = ?').get(user.id);
    if (!verifyPasswordOrDummy(str(body.password, 200), u.pw_hash)) fail(400, 'パスワードが正しくありません');
    deleteUserCompletely(db, user.id);
    deleteSession(db, parseCookies(req.headers.cookie).sid);
    clearSessionCookie(res);
    return { ok: true };
  });

  route('POST', '/api/me/classes', ({ user, body }) => {
    const cls = db.prepare('SELECT * FROM classes WHERE join_code = ? AND join_open = 1').get(str(body.joinCode, 20).trim().toUpperCase());
    if (!cls) fail(400, 'クラス参加コードが正しくないか、受付が終了しています');
    db.prepare('INSERT OR IGNORE INTO enrollments (class_id, user_id, created_at) VALUES (?,?,?)').run(cls.id, user.id, now());
    return { ok: true, class: { id: cls.id, name: cls.name } };
  });

  // ---------- 目標・レベル ----------
  route('PUT', '/api/me/target', ({ user, body }) => {
    const exam = ['A2', 'B1', 'B2', 'undecided'].includes(body.exam) ? body.exam : fail(400, '目標試験を選んでください');
    const month = body.plannedMonth ? str(body.plannedMonth, 7) : null;
    if (month && !/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) fail(400, '受験予定時期の形式が正しくありません');
    db.prepare('INSERT INTO exam_targets (user_id, exam, planned_month, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET exam=excluded.exam, planned_month=excluded.planned_month, updated_at=excluded.updated_at')
      .run(user.id, exam, month, now());
    return getTarget(db, user.id);
  });

  const setLevel = (userId, skill, level, source, by) => {
    if (!SKILLS.includes(skill)) fail(400, '技能が正しくありません');
    if (!LEVELS.includes(level)) fail(400, 'レベルが正しくありません');
    db.prepare(`INSERT INTO skill_progress (user_id, skill, level, level_source, set_by, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id, skill) DO UPDATE SET level=excluded.level, level_source=excluded.level_source, set_by=excluded.set_by, updated_at=excluded.updated_at`)
      .run(userId, skill, level, source, by, now());
  };
  route('PUT', '/api/me/levels', ({ user, body }) => { setLevel(user.id, body.skill, body.level, 'student', user.id); return getLevels(db, user.id); });

  // ---------- 診断 ----------
  route('GET', '/api/diagnostic', () => publicDiagnostic(diagnostic));
  route('POST', '/api/diagnostic', ({ user, body }) => {
    const clientId = str(body.clientId, 64);
    if (!clientId) fail(400, 'clientId が必要です');
    const existing = db.prepare('SELECT result FROM diagnostic_results WHERE client_id = ?').get(clientId);
    if (existing) return J(existing.result, {});
    const r = scoreDiagnostic(diagnostic, body);
    const result = {
      skills: r.skills, suggestedExam: r.suggestedExam, writingText: r.writingText,
      review: r.items.map((it) => ({ skill: it.skill, level: it.level, id: it.question.id, stem: it.question.stem, options: it.question.options, answer: it.question.answer, response: it.response, correct: it.correct, explanation: it.question.explanation, evidence: it.question.evidence })),
    };
    tx(db, () => {
      db.prepare('INSERT INTO diagnostic_results (id, client_id, user_id, result, created_at) VALUES (?,?,?,?,?)').run(newId('d_'), clientId, user.id, JSON.stringify(result), now());
      for (const it of r.items) {
        db.prepare(`INSERT INTO attempts (id, client_id, user_id, question_id, question_version, activity_id, context, response, correct, support, attempt_no, created_at)
          VALUES (?,?,?,?,1,NULL,'diagnostic',?,?,?,1,?)`).run(newId('a_'), `${clientId}:${it.question.id}`, user.id, it.question.id, JSON.stringify(it.response), it.correct ? 1 : 0,
          JSON.stringify(it.skill === 'listening' ? { scriptOpened: r.skills.listening.scriptOpened, noAudio: r.skills.listening.noAudio } : {}), now());
      }
      // 手動で調整されたレベルは診断で上書きしない
      const levels = getLevels(db, user.id);
      for (const s of SKILLS) if (!['student', 'teacher'].includes(levels[s].level_source)) setLevel(user.id, s, r.skills[s].level, 'diagnostic', null);
    });
    return result;
  });
  route('GET', '/api/diagnostic/latest', ({ user }) => latestDiagnostic(db, user.id));

  // ---------- 学習 ----------
  route('GET', '/api/dashboard', ({ user }) => dashboardFor(db, user.id));
  route('GET', '/api/units', ({ user }) => ({ units: unitsWithProgress(db, user.id), levels: getLevels(db, user.id) }));
  route('GET', '/api/units/:id', ({ user, params }) => {
    const u = getUnit(db, params.id, { includeHidden: false });
    if (!u) fail(404, '単元が見つかりません');
    const done = completionsFor(db, user.id);
    for (const a of u.activities) a.completed = done.has(a.id);
    const answered = db.prepare(`SELECT question_id, correct, response, support FROM attempts WHERE user_id = ? AND context = 'unit' AND activity_id IN (${u.activities.map(() => '?').join(',')}) ORDER BY created_at, rowid`)
      .all(user.id, ...u.activities.map((a) => a.id));
    const last = {};
    for (const r of answered) last[r.question_id] = { correct: !!r.correct, response: J(r.response, null), support: J(r.support, {}) };
    return { unit: u, lastAttempts: last, rubrics: getRubrics(db).filter((r) => r.level === u.level) };
  });

  route('POST', '/api/attempts', ({ user, body }) => {
    const clientId = str(body.clientId, 64);
    if (!clientId) fail(400, 'clientId が必要です');
    const context = ['unit', 'review'].includes(body.context) ? body.context : fail(400, 'context が正しくありません');
    const prev = db.prepare('SELECT * FROM attempts WHERE client_id = ?').get(clientId);
    const q = getQuestion(db, str(body.questionId, 100));
    if (!q || (q.status !== 'published' && !isTeacher(user))) fail(404, '問題が見つかりません');
    const unitId = db.prepare('SELECT unit_id FROM activities WHERE id = ?').get(q.activityId)?.unit_id;
    const stampOf = () => syncStamp(db, user.id, { type: 'question', itemId: q.id, unitId, level: q.level, category: q.skill });
    const result = (row, stamp) => ({ id: row.id, correct: !!row.correct, attemptNo: row.attempt_no, questionVersion: row.question_version, duplicate: !!prev,
      answer: q.answer, accept: q.accept, explanation: q.explanation, evidence: q.evidence, stamp });
    if (prev) { if (prev.user_id !== user.id) fail(409, '重複した送信です'); return result(prev, { ...stampOf(), newlyEarned: false }); }
    const response = q.type === 'mcq' ? (Number.isInteger(body.response) ? body.response : fail(400, '選択肢を選んでください')) : str(body.response, 200);
    const support = { scriptOpened: !!body.support?.scriptOpened, noAudio: !!body.support?.noAudio };
    const correct = gradeQuestion(q, response);
    const row = tx(db, () => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND question_id = ?').get(user.id, q.id).n;
      const r = { id: newId('a_'), attempt_no: n + 1, question_version: q.version, correct: correct ? 1 : 0 };
      db.prepare(`INSERT INTO attempts (id, client_id, user_id, question_id, question_version, activity_id, context, response, correct, support, attempt_no, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id, clientId, user.id, q.id, q.version, q.activityId, context, JSON.stringify(response), r.correct, JSON.stringify(support), r.attempt_no, now());
      const cur = db.prepare('SELECT * FROM review_items WHERE user_id = ? AND question_id = ?').get(user.id, q.id);
      const next = nextReviewState(cur, { correct, supported: support.scriptOpened || support.noAudio });
      if (!next) db.prepare('DELETE FROM review_items WHERE user_id = ? AND question_id = ?').run(user.id, q.id);
      else db.prepare(`INSERT INTO review_items (user_id, question_id, box, due_at, reason, updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(user_id, question_id) DO UPDATE SET box=excluded.box, due_at=excluded.due_at, reason=excluded.reason, updated_at=excluded.updated_at`)
        .run(user.id, q.id, next.box, next.due_at, next.reason, now());
      r.stamp = stampOf();
      return r;
    });
    return result(row, row.stamp);
  });

  route('POST', '/api/activities/:id/complete', ({ user, params }) => {
    const a = db.prepare("SELECT id, version FROM activities WHERE id = ? AND status = 'published'").get(params.id);
    if (!a) fail(404, '活動が見つかりません');
    db.prepare('INSERT OR IGNORE INTO activity_completions (user_id, activity_id, activity_version, completed_at) VALUES (?,?,?,?)').run(user.id, a.id, a.version, now());
    return { ok: true, completedAt: db.prepare('SELECT completed_at FROM activity_completions WHERE user_id=? AND activity_id=?').get(user.id, a.id).completed_at };
  });

  const ACT_ID = /^[a-z0-9-]{1,100}$/;
  route('GET', '/api/drafts/:activityId', ({ user, params }) => !ACT_ID.test(params.activityId) ? fail(400, '不正なIDです') : db.prepare('SELECT text, updated_at AS updatedAt FROM drafts WHERE user_id = ? AND activity_id = ?').get(user.id, params.activityId) || null);
  route('PUT', '/api/drafts/:activityId', ({ user, params, body }) => {
    if (!ACT_ID.test(params.activityId)) fail(400, '不正なIDです');
    const text = str(body.text, 20000);
    let at = str(body.updatedAt, 40);
    if (!at || Number.isNaN(Date.parse(at)) || Date.parse(at) > Date.now() + 5 * 60e3) at = now();
    const cur = db.prepare('SELECT updated_at FROM drafts WHERE user_id = ? AND activity_id = ?').get(user.id, params.activityId);
    if (cur && cur.updated_at > at) return { updatedAt: cur.updated_at, stale: true };
    db.prepare('INSERT INTO drafts (user_id, activity_id, text, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id, activity_id) DO UPDATE SET text=excluded.text, updated_at=excluded.updated_at')
      .run(user.id, params.activityId, text, at);
    return { updatedAt: at };
  });

  const submissionOut = (s) => ({
    id: s.id, activityId: s.activity_id, activityVersion: s.activity_version, kind: s.kind, text: s.text, wordCount: s.word_count,
    selfCheck: J(s.self_check, []), selfScores: J(s.self_scores, {}), recordedLocally: !!s.recorded_locally, revision: s.revision, parentId: s.parent_id, createdAt: s.created_at,
    feedback: db.prepare('SELECT f.id, f.scores, f.comment, f.created_at AS createdAt, f.source, u.display_name AS author FROM feedback f LEFT JOIN users u ON u.id = f.author_id WHERE f.submission_id = ? ORDER BY f.created_at')
      .all(s.id).map((f) => ({ ...f, scores: J(f.scores, {}) })),
  });

  route('POST', '/api/submissions', ({ user, body }) => {
    const clientId = str(body.clientId, 64);
    if (!clientId) fail(400, 'clientId が必要です');
    const prev = db.prepare('SELECT * FROM submissions WHERE client_id = ?').get(clientId);
    if (prev) { if (prev.user_id !== user.id) fail(409, '重複した送信です'); return { ...submissionOut(prev), duplicate: true }; }
    const act = db.prepare("SELECT * FROM activities WHERE id = ? AND kind IN ('writing','speaking')").get(str(body.activityId, 100));
    if (!act || (act.status !== 'published' && !isTeacher(user))) fail(404, '課題が見つかりません');
    const text = str(body.text, 10000);
    if (act.kind === 'writing' && !text.trim()) fail(400, '回答が空です');
    const selfScores = {};
    for (const [k, v] of Object.entries(body.selfScores || {}).slice(0, 10)) if (/^[a-z]{2,20}$/.test(k) && Number.isInteger(v) && v >= 0 && v <= 5) selfScores[k] = v;
    const selfCheck = Array.isArray(body.selfCheck) ? body.selfCheck.filter((i) => Number.isInteger(i) && i >= 0 && i < 20).slice(0, 20) : [];
    const row = tx(db, () => {
      const last = db.prepare('SELECT id, revision FROM submissions WHERE user_id = ? AND activity_id = ? ORDER BY revision DESC LIMIT 1').get(user.id, act.id);
      const id = newId('s_');
      db.prepare(`INSERT INTO submissions (id, client_id, user_id, activity_id, activity_version, kind, text, word_count, self_check, self_scores, recorded_locally, parent_id, revision, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, clientId, user.id, act.id, act.version, act.kind, text, countWords(text), JSON.stringify(selfCheck), JSON.stringify(selfScores),
        body.recordedLocally ? 1 : 0, last?.id || null, (last?.revision || 0) + 1, now());
      if (act.kind === 'writing') db.prepare('DELETE FROM drafts WHERE user_id = ? AND activity_id = ?').run(user.id, act.id);
      db.prepare('INSERT OR IGNORE INTO activity_completions (user_id, activity_id, activity_version, completed_at) VALUES (?,?,?,?)').run(user.id, act.id, act.version, now());
      return db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
    });
    return submissionOut(row);
  });
  route('GET', '/api/submissions', ({ user, query }) => {
    const aid = query.get('activityId');
    const rows = aid ? db.prepare('SELECT * FROM submissions WHERE user_id = ? AND activity_id = ? ORDER BY revision DESC').all(user.id, aid)
      : db.prepare('SELECT * FROM submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(user.id);
    return { submissions: rows.map(submissionOut) };
  });

  const reviewItem = (questionId, extra) => {
    const q = getQuestion(db, questionId);
    const act = db.prepare('SELECT a.kind, a.data, u.title_ja, u.level FROM activities a JOIN units u ON u.id = a.unit_id WHERE a.id = ?').get(q.activityId);
    const ad = J(act.data, {});
    const context = act.kind === 'reading' ? { type: 'passage', passage: ad.passage } : act.kind === 'listening' ? { type: 'script', script: ad.script }
      : q.stimulus && ad.stimuli?.[q.stimulus] ? { type: 'stimulus', text: ad.stimuli[q.stimulus] } : null;
    return { ...extra, question_id: questionId, question: q, unitTitle: act.title_ja, level: act.level, activityTitle: ad.title, kind: act.kind, context };
  };

  route('GET', '/api/review', ({ user }) => {
    const t = now();
    const rows = db.prepare(`SELECT r.question_id, r.box, r.due_at, r.reason FROM review_items r JOIN questions q ON q.id = r.question_id AND q.status = 'published'
      WHERE r.user_id = ? ORDER BY r.due_at`).all(user.id);
    const due = rows.filter((r) => r.due_at <= t).slice(0, 15);
    const items = due.map((r) => reviewItem(r.question_id, r));
    // スタンプ挑戦: 連続正解の途中で、今日はまだ解いていない問題（日をあけて解くとスタンプに近づく）
    const dueIds = new Set(due.map((r) => r.question_id));
    const stamped = new Set(db.prepare("SELECT item_id FROM stamps WHERE user_id = ? AND item_type = 'question'").all(user.id).map((r) => r.item_id));
    const candidates = db.prepare(`SELECT DISTINCT a.question_id FROM attempts a JOIN questions q ON q.id = a.question_id AND q.status = 'published'
      WHERE a.user_id = ? AND a.context IN ('unit','review')`).all(user.id).map((r) => r.question_id).filter((id) => !dueIds.has(id) && !stamped.has(id));
    const challenges = [];
    for (const id of candidates) {
      const ev = evaluateStamp(questionAttemptsFor(db, user.id, id), t);
      if (!ev.earned && ev.streak > 0 && !ev.answeredToday) challenges.push({ id, ev });
    }
    challenges.sort((a, b) => b.ev.streak - a.ev.streak);
    const stampChallenges = challenges.slice(0, 10).map((c) => reviewItem(c.id, { reason: 'stamp', streak: c.ev.streak, remaining: c.ev.remaining }));
    const upcoming = rows.filter((r) => r.due_at > t).map((r) => r.due_at);
    return { items, dueCount: rows.filter((r) => r.due_at <= t).length, upcoming: upcoming.slice(0, 50), stampChallenges, stampChallengeCount: challenges.length };
  });

  // ---------- 単語・熟語・構文カード ----------
  const cardOut = (userId, c, stampedSet) => {
    const ev = evaluateStamp(cardAttemptsFor(db, userId, c.id));
    const earned = stampedSet.has(c.id);
    return { ...c, stamp: { earned, streak: ev.streak, remaining: earned ? 0 : ev.remaining, needsNewDay: earned ? false : ev.needsNewDay, answeredToday: ev.answeredToday } };
  };
  route('GET', '/api/cards', ({ user, query }) => {
    const unitId = query.get('unitId');
    const units = db.prepare("SELECT id, title_ja AS titleJa, level, order_no AS \"order\" FROM units WHERE status = 'published' ORDER BY theme, order_no, level").all();
    const unit = unitId ? units.find((u) => u.id === unitId) : null;
    if (unitId && !unit) fail(404, '単元が見つかりません');
    const stampedSet = new Set(db.prepare("SELECT item_id FROM stamps WHERE user_id = ? AND item_type = 'card'").all(user.id).map((r) => r.item_id));
    const cards = unit ? cardsForUnit(db, unit.id).map((c) => cardOut(user.id, c, stampedSet)) : [];
    return { units, unit, types: CARD_TYPES, cards };
  });
  route('POST', '/api/cards/attempts', ({ user, body }) => {
    const clientId = str(body.clientId, 64);
    if (!clientId) fail(400, 'clientId が必要です');
    const card = findCard(db, str(body.cardId, 200));
    if (!card) fail(404, 'カードが見つかりません');
    const r = recordCardAttempt(db, user.id, { clientId, card, response: str(body.response, 200) });
    if (r.duplicate) {
      if (r.userId !== user.id) fail(409, '重複した送信です');
      return { correct: r.correct, answer: card.meaning, duplicate: true, stamp: syncStamp(db, user.id, { type: 'card', itemId: card.id, unitId: card.unitId, level: card.level, category: card.type }) };
    }
    return { correct: r.correct, answer: card.meaning, stamp: r.stamp };
  });

  // ---------- スタンプ帳 ----------
  const CATEGORY_JA = { vocabulary: '語彙問題', grammar: '文法問題', reading: 'Reading', listening: 'Listening', word: '単語カード', phrase: '熟語・表現カード', structure: '構文カード' };
  route('GET', '/api/stamps', ({ user }) => {
    const stamps = db.prepare('SELECT item_type, item_id, unit_id, level, category, earned_at FROM stamps WHERE user_id = ? ORDER BY earned_at DESC').all(user.id);
    const units = db.prepare("SELECT id, title_ja, level FROM units WHERE status = 'published' ORDER BY theme, order_no").all();
    const levels = LEVELS.map((L) => {
      const items = [];
      for (const u of units.filter((x) => x.level === L)) {
        for (const q of db.prepare(`SELECT q.id, q.skill FROM questions q JOIN activities a ON a.id = q.activity_id AND a.status = 'published'
          WHERE a.unit_id = ? AND q.status = 'published' ORDER BY a.step, q.position`).all(u.id)) items.push({ type: 'question', id: q.id, category: q.skill, unitId: u.id });
        for (const c of cardsForUnit(db, u.id)) items.push({ type: 'card', id: c.id, category: c.type, unitId: u.id });
      }
      const got = new Set(stamps.filter((s) => s.level === L).map((s) => `${s.item_type}:${s.item_id}`));
      const has = (it) => got.has(`${it.type}:${it.id}`);
      const count = items.filter(has).length;
      const t = titleFor(count, items.length);
      const categories = Object.keys(CATEGORY_JA).map((k) => {
        const list = items.filter((it) => it.category === k);
        return { key: k, label: CATEGORY_JA[k], total: list.length, count: list.filter(has).length };
      }).filter((c) => c.total);
      const unitRows = units.filter((x) => x.level === L).map((u) => {
        const list = items.filter((it) => it.unitId === u.id);
        return { id: u.id, titleJa: u.title_ja, total: list.length, count: list.filter(has).length };
      });
      return { level: L, count, total: items.length, title: t.title, next: t.next, remainingToNext: t.remainingToNext, categories, units: unitRows, grid: items.map(has) };
    });
    const recent = stamps.slice(0, 8).map((s) => {
      let label = s.item_id;
      if (s.item_type === 'question') label = getQuestion(db, s.item_id)?.stem || label;
      else label = findCard(db, s.item_id)?.front || label;
      return { type: s.item_type, category: CATEGORY_JA[s.category] || s.category, level: s.level, label, earnedAt: s.earned_at };
    });
    return { rule: { streak: STAMP_STREAK, text: `スクリプトなどの支援を使わずに${STAMP_STREAK}回続けて正解し、そのうち少なくとも1回が別の日なら、理解できた証としてスタンプがもらえます。` },
      titles: TITLES, levels, recent, total: stamps.length };
  });

  route('GET', '/api/rubrics', () => ({ rubrics: getRubrics(db) }));

  // ---------- 教員 ----------
  const T = { role: 'teacher' };
  route('GET', '/api/teacher/classes', ({ user }) => {
    const rows = user.role === 'admin' ? db.prepare('SELECT * FROM classes ORDER BY created_at').all() : db.prepare('SELECT * FROM classes WHERE teacher_id = ? ORDER BY created_at').all(user.id);
    return {
      classes: rows.map((c) => ({ id: c.id, name: c.name, joinCode: c.join_code, joinOpen: !!c.join_open, students: db.prepare('SELECT COUNT(*) AS n FROM enrollments WHERE class_id = ?').get(c.id).n })),
      pendingFeedback: pendingSubmissions(user).length,
    };
  }, T);
  route('POST', '/api/teacher/classes', ({ user, body }) => {
    const name = str(body.name, 40).trim();
    if (!name) fail(400, 'クラス名を入力してください');
    const id = newId('c_');
    let code = newJoinCode();
    while (db.prepare('SELECT 1 FROM classes WHERE join_code = ?').get(code)) code = newJoinCode();
    db.prepare('INSERT INTO classes (id, name, join_code, join_open, teacher_id, created_at) VALUES (?,?,?,1,?,?)').run(id, name, code, user.id, now());
    return { id, name, joinCode: code, joinOpen: true };
  }, T);
  route('PATCH', '/api/teacher/classes/:id', ({ user, params, body }) => {
    const c = ownClass(user, params.id);
    if (typeof body.joinOpen === 'boolean') db.prepare('UPDATE classes SET join_open = ? WHERE id = ?').run(body.joinOpen ? 1 : 0, c.id);
    if (body.regenerateCode) {
      let code = newJoinCode();
      while (db.prepare('SELECT 1 FROM classes WHERE join_code = ?').get(code)) code = newJoinCode();
      db.prepare('UPDATE classes SET join_code = ? WHERE id = ?').run(code, c.id);
    }
    if (typeof body.name === 'string' && body.name.trim()) db.prepare('UPDATE classes SET name = ? WHERE id = ?').run(str(body.name, 40).trim(), c.id);
    const n = db.prepare('SELECT * FROM classes WHERE id = ?').get(c.id);
    return { id: n.id, name: n.name, joinCode: n.join_code, joinOpen: !!n.join_open };
  }, T);

  const studentSummary = (sid) => {
    const u = db.prepare('SELECT id, login_id, display_name, last_active_at, created_at FROM users WHERE id = ?').get(sid);
    const p = progressFor(db, sid);
    return {
      id: u.id, loginId: u.login_id, displayName: u.display_name, lastActiveAt: u.last_active_at, target: getTarget(db, sid),
      skills: Object.fromEntries(SKILLS.map((s) => [s, { level: p.skills[s].level, levelSource: p.skills[s].levelSource, status: p.skills[s].status, statusJa: p.skills[s].statusJa, score: p.skills[s].score, selfAvg: p.skills[s].selfAvg ?? null }])),
      attempts: p.attempts.length, completed: completionsFor(db, sid).size,
      pending: db.prepare('SELECT COUNT(*) AS n FROM submissions s WHERE s.user_id = ? AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.submission_id = s.id)').get(sid).n,
    };
  };

  route('GET', '/api/teacher/classes/:id', ({ user, params }) => {
    const c = ownClass(user, params.id);
    const students = db.prepare("SELECT u.id FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.class_id = ? AND u.role = 'student' ORDER BY u.login_id").all(c.id);
    return { id: c.id, name: c.name, joinCode: c.join_code, joinOpen: !!c.join_open, students: students.map((s) => studentSummary(s.id)) };
  }, T);

  // クラス全体で間違いが多い問題（各生徒の最初の解答で集計。版ごとの内訳つき）
  route('GET', '/api/teacher/classes/:id/item-stats', ({ user, params }) => {
    const c = ownClass(user, params.id);
    const rows = db.prepare(`SELECT a.user_id, a.question_id, a.question_version, a.correct, a.support FROM attempts a
      JOIN enrollments e ON e.user_id = a.user_id AND e.class_id = ? WHERE a.context IN ('unit','review') AND a.attempt_no = 1`).all(c.id);
    const m = new Map();
    for (const r of rows) {
      const e = m.get(r.question_id) || { questionId: r.question_id, students: 0, wrong: 0, supported: 0, versions: {} };
      e.students++; if (!r.correct) e.wrong++; if (J(r.support, {}).scriptOpened) e.supported++;
      e.versions[r.question_version] = (e.versions[r.question_version] || 0) + 1;
      m.set(r.question_id, e);
    }
    const items = [...m.values()].filter((e) => e.wrong > 0).map((e) => {
      const q = getQuestion(db, e.questionId);
      const act = q && db.prepare('SELECT act.data, u.title_ja FROM activities act JOIN units u ON u.id = act.unit_id WHERE act.id = ?').get(q.activityId);
      return { ...e, wrongRate: e.wrong / e.students, stem: q?.stem, skill: q?.skill, level: q?.level, focus: q?.focus, currentVersion: q?.version, unitTitle: act?.title_ja, activityTitle: J(act?.data, {}).title };
    }).sort((a, b) => b.wrongRate - a.wrongRate || b.wrong - a.wrong).slice(0, 30);
    return { items };
  }, T);

  route('GET', '/api/teacher/students/:id', ({ user, params }) => {
    if (!canAccessStudent(user, params.id)) fail(404, '生徒が見つかりません');
    const p = progressFor(db, params.id);
    const subs = db.prepare('SELECT * FROM submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(params.id).map((s) => {
      const a = db.prepare('SELECT a.data, u.level, u.title_ja FROM activities a JOIN units u ON u.id = a.unit_id WHERE a.id = ?').get(s.activity_id);
      return { ...submissionOut(s), activityTitle: J(a?.data, {}).title, level: a?.level, unitTitle: a?.title_ja };
    });
    return {
      ...studentSummary(params.id), skillsDetail: p.skills, diagnostic: latestDiagnostic(db, params.id), mistakes: frequentMistakes(p.attempts),
      history: historyFor(db, params.id, 20), submissions: subs, dueReviews: dueReviewCount(db, params.id),
    };
  }, T);

  route('PUT', '/api/teacher/students/:id/levels', ({ user, params, body }) => {
    if (!canAccessStudent(user, params.id)) fail(404, '生徒が見つかりません');
    setLevel(params.id, body.skill, body.level, 'teacher', user.id);
    return getLevels(db, params.id);
  }, T);

  route('DELETE', '/api/teacher/classes/:cid/students/:sid', ({ user, params }) => {
    ownClass(user, params.cid);
    db.prepare('DELETE FROM enrollments WHERE class_id = ? AND user_id = ?').run(params.cid, params.sid);
    return { ok: true };
  }, T);

  // 削除依頼への対応（アカウントと学習データの完全削除）
  route('POST', '/api/teacher/students/:id/delete', ({ user, params, body }) => {
    if (!canAccessStudent(user, params.id)) fail(404, '生徒が見つかりません');
    const s = db.prepare("SELECT login_id FROM users WHERE id = ? AND role = 'student'").get(params.id);
    if (!s) fail(404, '生徒が見つかりません');
    if (body.confirmLoginId !== s.login_id) fail(400, '確認のため、生徒のログインIDを正しく入力してください');
    deleteUserCompletely(db, params.id);
    return { ok: true };
  }, T);

  function pendingSubmissions(user) {
    const rows = db.prepare(`SELECT s.* FROM submissions s JOIN enrollments e ON e.user_id = s.user_id JOIN classes c ON c.id = e.class_id
      WHERE (c.teacher_id = ? OR ? = 'admin') AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.submission_id = s.id)
      GROUP BY s.id ORDER BY s.created_at DESC LIMIT 100`).all(user.id, user.role);
    return rows;
  }
  route('GET', '/api/teacher/submissions', ({ user }) => ({
    submissions: pendingSubmissions(user).map((s) => {
      const a = db.prepare('SELECT a.data, u.level, u.title_ja FROM activities a JOIN units u ON u.id = a.unit_id WHERE a.id = ?').get(s.activity_id);
      const st = db.prepare('SELECT login_id, display_name FROM users WHERE id = ?').get(s.user_id);
      return { ...submissionOut(s), studentId: s.user_id, loginId: st.login_id, displayName: st.display_name, activityTitle: J(a?.data, {}).title, level: a?.level, unitTitle: a?.title_ja };
    }),
  }), T);

  route('GET', '/api/teacher/submissions/:id', ({ user, params }) => {
    const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(params.id);
    if (!s || !canAccessStudent(user, s.user_id)) fail(404, '提出物が見つかりません');
    const act = db.prepare('SELECT a.*, u.level, u.title_ja FROM activities a JOIN units u ON u.id = a.unit_id WHERE a.id = ?').get(s.activity_id);
    const ad = J(act.data, {});
    const versionData = db.prepare("SELECT data FROM content_versions WHERE entity_type='activity' AND entity_id=? AND version=?").get(s.activity_id, s.activity_version);
    const st = db.prepare('SELECT id, login_id, display_name FROM users WHERE id = ?').get(s.user_id);
    const history = db.prepare('SELECT * FROM submissions WHERE user_id = ? AND activity_id = ? ORDER BY revision').all(s.user_id, s.activity_id).map(submissionOut);
    return {
      submission: submissionOut(s), student: { id: st.id, loginId: st.login_id, displayName: st.display_name }, history,
      activity: { id: act.id, kind: act.kind, level: act.level, unitTitle: act.title_ja, title: ad.title, task: J(versionData?.data, ad).task || ad.task, currentVersion: act.version },
      rubric: getRubrics(db).find((r) => r.id === ad.rubricId) || null,
    };
  }, T);

  route('POST', '/api/teacher/submissions/:id/feedback', ({ user, params, body }) => {
    const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(params.id);
    if (!s || !canAccessStudent(user, s.user_id)) fail(404, '提出物が見つかりません');
    const ad = J(db.prepare('SELECT data FROM activities WHERE id = ?').get(s.activity_id)?.data, {});
    const rubric = getRubrics(db).find((r) => r.id === ad.rubricId);
    const scores = {};
    for (const c of rubric?.criteria || []) {
      const v = body.scores?.[c.key];
      if (!Number.isInteger(v) || v < 0 || v > 5) fail(400, `「${c.label}」の評価（0〜5）を選んでください`);
      scores[c.key] = v;
    }
    const id = newId('f_');
    db.prepare('INSERT INTO feedback (id, submission_id, author_id, source, scores, comment, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, s.id, user.id, 'teacher', JSON.stringify(scores), str(body.comment, 3000), now());
    return { id, scores };
  }, T);

  // ---------- 教材編集 ----------
  route('GET', '/api/content/units', () => ({
    units: db.prepare('SELECT id, theme, theme_label AS themeLabel, level, exam, order_no AS "order", title, title_ja AS titleJa, status, version, updated_at AS updatedAt FROM units ORDER BY theme, order_no, level').all(),
  }), T);
  route('GET', '/api/content/units/:id', ({ params }) => {
    const u = getUnit(db, params.id, { includeHidden: true });
    if (!u) fail(404, '単元が見つかりません');
    return { unit: u, rubrics: getRubrics(db) };
  }, T);
  route('PATCH', '/api/content/units/:id', ({ params, body }) => { setUnitStatus(db, params.id, body.status); return { ok: true }; }, T);
  route('GET', '/api/content/units/:id/export', ({ params }) => exportUnit(db, params.id) || fail(404, '単元が見つかりません'), T);
  route('POST', '/api/content/import', ({ user, body }) => upsertUnit(db, body.unit, user.id), T);
  route('PATCH', '/api/content/activities/:id', ({ user, params, body }) => updateActivity(db, params.id, body, user.id), T);
  route('PATCH', '/api/content/questions/:id', ({ user, params, body }) => updateQuestion(db, params.id, body, user.id), T);
  route('POST', '/api/content/activities/:id/questions', ({ user, params, body }) => createQuestion(db, params.id, body, user.id), T);
  route('GET', '/api/content/:type/:id/versions', ({ params }) => {
    if (!['question', 'activity', 'unit'].includes(params.type)) fail(404, '見つかりません');
    return { versions: listVersions(db, params.type, params.id) };
  }, T);

  // ---------- ハンドラー ----------
  async function handleApi(req, res, url) {
    const method = req.method;
    let matched = null; let params = {};
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = url.pathname.match(r.re);
      if (m) {
        matched = r;
        try { params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); } catch { return sendJson(res, 400, { error: '不正なURLです' }); }
        break;
      }
    }
    if (!matched) return sendJson(res, 404, { error: '見つかりません' });
    if (method !== 'GET') {
      // CSRF 対策: SameSite=Strict の Cookie に加え、同一オリジンからの JSON リクエストのみ受け付ける
      const origin = req.headers.origin;
      let sameOrigin = true;
      if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
      if (!sameOrigin) return sendJson(res, 403, { error: '不正なリクエストです' });
      if (req.headers['x-requested-with'] !== 'fetch') return sendJson(res, 403, { error: '不正なリクエストです' });
    }
    let user = null;
    const sid = parseCookies(req.headers.cookie).sid;
    if (sid) user = getSessionUser(db, sid);
    if (matched.auth && !user) return sendJson(res, 401, { error: 'ログインが必要です' });
    if (matched.role === 'teacher' && !isTeacher(user)) return sendJson(res, 403, { error: '権限がありません' });
    const body = method === 'GET' ? {} : await readBody(req);
    const out = await matched.handler({ req, res, user, params, body: body && typeof body === 'object' ? body : {}, query: url.searchParams });
    return sendJson(res, 200, out ?? null);
  }

  function serveStatic(req, res, url) {
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    if (p === '/' || !path.extname(p)) p = '/index.html';
    const file = path.resolve(PUBLIC_DIR, '.' + p);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  return async function handler(req, res) {
    securityHeaders(res, secureCookies);
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) sendJson(res, status, { error: status >= 500 ? 'サーバーでエラーが発生しました' : e.message, details: e.details });
      else res.end();
    }
  };
}

export function deleteUserCompletely(db, userId) {
  tx(db, () => {
    // attempts/submissions/drafts などは外部キーの ON DELETE CASCADE で削除される
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
}
