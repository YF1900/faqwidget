// API の結合テスト（メモリ上の DB でサーバーを起動）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, now } from '../server/db.js';
import { loadContentDir, seedIfEmpty } from '../server/content.js';
import { createApp } from '../server/app.js';
import { hashPassword, newId } from '../server/auth.js';

const content = loadContentDir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'content'));
let server; let base; let db;

before(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db, content);
  for (const [login, role] of [['t-a', 'teacher'], ['t-b', 'teacher']]) {
    db.prepare('INSERT INTO users (id, role, login_id, display_name, pw_hash, created_at) VALUES (?,?,?,?,?,?)').run(`id-${login}`, role, login, login, hashPassword('teacher-pass-1'), now());
  }
  db.prepare("INSERT INTO classes (id, name, join_code, join_open, teacher_id, created_at) VALUES ('c1', 'A組', 'JOINAAAA', 1, 'id-t-a', ?)").run(now());
  db.prepare("INSERT INTO classes (id, name, join_code, join_open, teacher_id, created_at) VALUES ('c2', 'B組', 'JOINBBBB', 0, 'id-t-b', ?)").run(now());
  server = http.createServer(createApp(db, { content, registerLimit: 1000 }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, {
      method, headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json', 'x-requested-with': 'fetch' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let data = null; try { data = await res.json(); } catch { /* 空 */ }
    return { status: res.status, data, headers: res.headers };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}, h) => call('POST', p, b, h), put: (p, b = {}) => call('PUT', p, b), patch: (p, b = {}) => call('PATCH', p, b), raw: call };
}

async function registerStudent(loginId, code = 'JOINAAAA') {
  const c = client();
  const r = await c.post('/api/auth/register', { joinCode: code, loginId, displayName: 'テスト', password: 'student-pass-1', privacyAgreed: true });
  return { c, r };
}

test('登録: 同意・参加コード・パスワードの長さを検証する', async () => {
  const c = client();
  assert.equal((await c.post('/api/auth/register', { joinCode: 'JOINAAAA', loginId: 's-x', displayName: 'x', password: 'student-pass-1', privacyAgreed: false })).status, 400);
  assert.equal((await c.post('/api/auth/register', { joinCode: 'JOINAAAA', loginId: 's-x', displayName: 'x', password: 'short', privacyAgreed: true })).status, 400);
  assert.equal((await c.post('/api/auth/register', { joinCode: 'JOINBBBB', loginId: 's-x', displayName: 'x', password: 'student-pass-1', privacyAgreed: true })).status, 400, '受付停止中のクラス');
  const { r } = await registerStudent('s-ok');
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'student');
  const stored = db.prepare("SELECT pw_hash FROM users WHERE login_id = 's-ok'").get().pw_hash;
  assert.match(stored, /^scrypt\$/);
  assert.ok(!stored.includes('student-pass-1'));
});

test('セキュリティ: Cookie 属性・セキュリティヘッダー', async () => {
  const c = client();
  const res = await c.post('/api/auth/login', { loginId: 's-ok', password: 'student-pass-1' });
  const sc = res.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
});

test('セキュリティ: CSRF 対策（独自ヘッダーなし・別オリジンは拒否）', async () => {
  const { c } = await registerStudent('s-csrf');
  const r1 = await c.raw('PUT', '/api/me/target', { exam: 'B1' }, { 'x-requested-with': '' });
  assert.equal(r1.status, 403);
  const r2 = await c.raw('PUT', '/api/me/target', { exam: 'B1' }, { origin: 'https://evil.example' });
  assert.equal(r2.status, 403);
  assert.equal((await c.put('/api/me/target', { exam: 'B1' })).status, 200);
});

test('セキュリティ: ログイン試行回数の制限', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { loginId: 's-ok', password: 'wrong-password' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { loginId: 's-ok', password: 'student-pass-1' })).status, 429);
});

test('セキュリティ: 静的ファイルのパストラバーサルを防ぐ', async () => {
  const res = await fetch(`${base}/..%2f..%2fserver%2fdb.js`);
  assert.notEqual(res.status, 200);
  const res2 = await fetch(`${base}/%2e%2e/package.json`);
  assert.notEqual(res2.status, 200);
});

test('権限: 生徒は教員 API を使えず、教員は担当外の生徒を見られない', async () => {
  const { c, r } = await registerStudent('s-perm');
  assert.equal((await c.get('/api/teacher/classes')).status, 403);
  assert.equal((await c.get('/api/content/units')).status, 403);
  const tb = client();
  await tb.post('/api/auth/login', { loginId: 't-b', password: 'teacher-pass-1' });
  assert.equal((await tb.get(`/api/teacher/students/${r.data.user.id}`)).status, 404);
  assert.equal((await tb.get('/api/teacher/classes/c1')).status, 404);
  const ta = client();
  await ta.post('/api/auth/login', { loginId: 't-a', password: 'teacher-pass-1' });
  assert.equal((await ta.get(`/api/teacher/students/${r.data.user.id}`)).status, 200);
  assert.equal((await client().get('/api/dashboard')).status, 401);
});

test('解答: clientId による二重提出の防止と、解答時の版の記録', async () => {
  const { c, r } = await registerStudent('s-ver');
  const body = { clientId: 'dup-1', questionId: 'a2u1-r1', context: 'unit', response: 0 };
  const a1 = await c.post('/api/attempts', body);
  const a2 = await c.post('/api/attempts', body);
  assert.equal(a1.status, 200); assert.equal(a2.data.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE client_id = 'dup-1'").get().n, 1);
  assert.equal(a1.data.questionVersion, 1);
  // 教員が問題を修正 → 版が上がり、以後の解答は v2 として記録。過去の解答は v1 のまま
  const ta = client();
  await ta.post('/api/auth/login', { loginId: 't-a', password: 'teacher-pass-1' });
  const q = (await ta.get('/api/content/units/school-life-a2-u1')).data.unit.activities.find((a) => a.kind === 'reading').questions[0];
  const upd = await ta.patch(`/api/content/questions/${q.id}`, { stem: q.stem + ' (revised)' });
  assert.equal(upd.status, 200); assert.equal(upd.data.version, 2);
  const bad = await ta.patch(`/api/content/questions/${q.id}`, { evidence: 'this text is not in the passage' });
  assert.equal(bad.status, 400, '本文にない根拠は保存できない');
  const a3 = await c.post('/api/attempts', { ...body, clientId: 'dup-2' });
  assert.equal(a3.data.questionVersion, 2);
  const rows = db.prepare('SELECT question_version FROM attempts WHERE user_id = ? ORDER BY created_at').all(r.data.user.id).map((x) => x.question_version);
  assert.deepEqual(rows, [1, 2]);
  const versions = await ta.get(`/api/content/question/${q.id}/versions`);
  assert.equal(versions.data.versions.length, 2);
  // 生徒の画面にも反映される
  const su = await c.get('/api/units/school-life-a2-u1');
  assert.ok(su.data.unit.activities.find((a) => a.kind === 'reading').questions[0].stem.endsWith('(revised)'));
});

test('教材: 非公開にした単元・問題は生徒に表示されない', async () => {
  const { c } = await registerStudent('s-hidden');
  const ta = client();
  await ta.post('/api/auth/login', { loginId: 't-a', password: 'teacher-pass-1' });
  await ta.patch('/api/content/units/school-life-b2-u1', { status: 'hidden' });
  assert.equal((await c.get('/api/units/school-life-b2-u1')).status, 404);
  assert.ok(!(await c.get('/api/units')).data.units.some((u) => u.id === 'school-life-b2-u1'));
  await ta.patch('/api/content/units/school-life-b2-u1', { status: 'published' });
  const u = (await ta.get('/api/content/units/school-life-b1-u1')).data.unit;
  const q = u.activities.find((a) => a.kind === 'check').questions[0];
  await ta.patch(`/api/content/questions/${q.id}`, { status: 'hidden' });
  const su = (await c.get('/api/units/school-life-b1-u1')).data.unit;
  assert.ok(!su.activities.find((a) => a.kind === 'check').questions.some((x) => x.id === q.id));
  await ta.patch(`/api/content/questions/${q.id}`, { status: 'published' });
});

test('教材: JSON の書き出しと取り込み（往復で内容が保たれる）', async () => {
  const ta = client();
  await ta.post('/api/auth/login', { loginId: 't-a', password: 'teacher-pass-1' });
  const ex = (await ta.get('/api/content/units/school-life-b1-u1/export')).data;
  const im = await ta.post('/api/content/import', { unit: ex });
  assert.equal(im.status, 200);
  const broken = structuredClone(ex); broken.activities[2].questions[0].answer = 99;
  const bad = await ta.post('/api/content/import', { unit: broken });
  assert.equal(bad.status, 400); assert.ok(bad.data.details.length);
});

test('Writing: 下書き・提出・再提出・教員評価を区別して記録', async () => {
  const { c, r } = await registerStudent('s-write');
  const act = 'school-life-a2-u1-writing';
  await c.put(`/api/drafts/${act}`, { text: 'draft text', updatedAt: new Date().toISOString() });
  assert.equal((await c.get(`/api/drafts/${act}`)).data.text, 'draft text');
  const s1 = await c.post('/api/submissions', { clientId: 'w-1', activityId: act, text: 'Hi Ben, I am in the tennis club.', selfCheck: [0, 1], selfScores: { task: 4, bogus: 9 } });
  assert.equal(s1.data.revision, 1); assert.equal(s1.data.wordCount, 8);
  assert.deepEqual(s1.data.selfScores, { task: 4 }, '不正な値は保存しない');
  assert.equal((await c.get(`/api/drafts/${act}`)).data, null, '提出後は下書きを削除');
  const s2 = await c.post('/api/submissions', { clientId: 'w-2', activityId: act, text: 'Hi Ben, I am in the tennis club. It is fun.' });
  assert.equal(s2.data.revision, 2); assert.equal(s2.data.parentId, s1.data.id);
  const ta = client();
  await ta.post('/api/auth/login', { loginId: 't-a', password: 'teacher-pass-1' });
  assert.equal((await ta.post(`/api/teacher/submissions/${s2.data.id}/feedback`, { scores: { task: 4 } })).status, 400, '全観点の評価が必要');
  const fb = await ta.post(`/api/teacher/submissions/${s2.data.id}/feedback`, { scores: { task: 4, clarity: 4, organisation: 3, vocabulary: 3, grammar: 3 }, comment: 'Good' });
  assert.equal(fb.status, 200);
  const dash = (await c.get('/api/dashboard')).data;
  assert.equal(dash.skills.writing.teacherAvg, 3.4);
  assert.ok(dash.history.some((e) => e.type === 'feedback'));
  const tb = client();
  await tb.post('/api/auth/login', { loginId: 't-b', password: 'teacher-pass-1' });
  assert.equal((await tb.post(`/api/teacher/submissions/${s2.data.id}/feedback`, { scores: {} })).status, 404, '担当外の教員は評価できない');
  void r;
});

test('レベル調整: 生徒・教員が技能別に変更でき、診断で上書きされない', async () => {
  const { c, r } = await registerStudent('s-level');
  await c.put('/api/me/levels', { skill: 'reading', level: 'B2' });
  const ta = client();
  await ta.post('/api/auth/login', { loginId: 't-a', password: 'teacher-pass-1' });
  await ta.put(`/api/teacher/students/${r.data.user.id}/levels`, { skill: 'speaking', level: 'B1' });
  await c.post('/api/diagnostic', { clientId: 'diag-1', reading: { answers: {} }, listening: { answers: {} }, writing: { canDo: [] }, speaking: { canDo: [] } });
  const me = (await c.get('/api/me')).data;
  assert.equal(me.levels.reading.level, 'B2'); assert.equal(me.levels.reading.level_source, 'student');
  assert.equal(me.levels.speaking.level, 'B1'); assert.equal(me.levels.speaking.level_source, 'teacher');
  assert.equal(me.levels.listening.level_source, 'diagnostic');
  const again = await c.post('/api/diagnostic', { clientId: 'diag-1' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM diagnostic_results WHERE user_id = ?').get(r.data.user.id).n, 1, '同じ clientId の再送は1件');
  assert.ok(again.data.skills);
});

test('個人データ: 書き出しにパスワードを含めず、退会で全データを削除する', async () => {
  const { c, r } = await registerStudent('s-del');
  await c.post('/api/attempts', { clientId: 'del-1', questionId: 'a2u1-r1', context: 'unit', response: 0 });
  await c.post('/api/submissions', { clientId: 'del-2', activityId: 'school-life-a2-u1-writing', text: 'Hello Ben.' });
  const ex = await c.get('/api/me/export');
  assert.equal(ex.status, 200);
  assert.ok(!JSON.stringify(ex.data).includes('scrypt$'));
  assert.equal(ex.data.attempts.length, 1);
  assert.equal((await c.post('/api/me/delete', { password: 'wrong' })).status, 400);
  assert.equal((await c.post('/api/me/delete', { password: 'student-pass-1' })).status, 200);
  const id = r.data.user.id;
  for (const t of ['users', 'attempts', 'submissions', 'sessions', 'enrollments', 'review_items', 'drafts']) {
    const col = t === 'users' ? 'id' : 'user_id';
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`).get(id).n, 0, t);
  }
  assert.equal((await c.get('/api/me')).status, 401);
});

test('教員による削除依頼への対応（ログインIDの確認が必要）', async () => {
  const { r } = await registerStudent('s-del2');
  const ta = client();
  await ta.post('/api/auth/login', { loginId: 't-a', password: 'teacher-pass-1' });
  assert.equal((await ta.post(`/api/teacher/students/${r.data.user.id}/delete`, { confirmLoginId: 'wrong' })).status, 400);
  assert.equal((await ta.post(`/api/teacher/students/${r.data.user.id}/delete`, { confirmLoginId: 's-del2' })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(r.data.user.id).n, 0);
});

test('ダッシュボード: 誤答は復習に入り、推奨理由を返す', async () => {
  const { c } = await registerStudent('s-dash');
  await c.put('/api/me/target', { exam: 'A2' });
  await c.post('/api/attempts', { clientId: 'dash-1', questionId: 'a2u1-r1', context: 'unit', response: 2 });
  const d = (await c.get('/api/dashboard')).data;
  assert.ok(d.today.length > 0);
  assert.ok(d.today.every((t) => t.reason && t.title));
  const rv = (await c.get('/api/review')).data;
  assert.equal(rv.upcoming.length, 1, '翌日に復習予定');
  db.prepare("UPDATE review_items SET due_at = '2000-01-01T00:00:00.000Z'").run();
  const rv2 = (await c.get('/api/review')).data;
  assert.ok(rv2.items.length >= 1);
  assert.equal(rv2.items[0].context.type, 'passage');
  void newId;
});
