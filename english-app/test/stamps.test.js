import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateStamp, titleFor, dayKey } from '../server/stamps.js';
import { openDb, now } from '../server/db.js';
import { loadContentDir, seedIfEmpty } from '../server/content.js';
import { createApp } from '../server/app.js';
import { cardsForUnit } from '../server/cards.js';

const at = (c, t, supported = false) => ({ correct: c, supported, created_at: t });

test('スタンプ: 同じ日に3回連続正解しただけではもらえない', () => {
  const r = evaluateStamp([at(true, '2026-09-01T01:00:00Z'), at(true, '2026-09-01T02:00:00Z'), at(true, '2026-09-01T03:00:00Z')]);
  assert.equal(r.earned, false); assert.equal(r.needsNewDay, true); assert.equal(r.remaining, 1);
});
test('スタンプ: 3回連続正解が2日以上にまたがればもらえる', () => {
  const r = evaluateStamp([at(true, '2026-09-01T01:00:00Z'), at(true, '2026-09-01T02:00:00Z'), at(true, '2026-09-02T03:00:00Z')]);
  assert.equal(r.earned, true); assert.equal(r.earnedAt, '2026-09-02T03:00:00Z');
});
test('スタンプ: 不正解・支援ありの正解で連続がリセットされる', () => {
  assert.equal(evaluateStamp([at(true, '2026-09-01T01:00:00Z'), at(false, '2026-09-02T01:00:00Z'), at(true, '2026-09-03T01:00:00Z'), at(true, '2026-09-04T01:00:00Z')]).earned, false);
  const r = evaluateStamp([at(true, '2026-09-01T01:00:00Z'), at(true, '2026-09-02T01:00:00Z', true), at(true, '2026-09-03T01:00:00Z')]);
  assert.equal(r.earned, false); assert.equal(r.streak, 1);
});
test('スタンプ: 一度もらえば、その後まちがえても獲得済みのまま', () => {
  const r = evaluateStamp([at(true, '2026-09-01T01:00:00Z'), at(true, '2026-09-01T02:00:00Z'), at(true, '2026-09-02T03:00:00Z'), at(false, '2026-09-03T03:00:00Z')]);
  assert.equal(r.earned, true);
});
test('スタンプ: 日付は日本時間で数える', () => {
  assert.equal(dayKey('2026-09-01T14:59:00Z'), '2026-09-01');
  assert.equal(dayKey('2026-09-01T15:00:00Z'), '2026-09-02');
});
test('称号: 割合に応じて上がり、次の称号までの残りを返す', () => {
  assert.equal(titleFor(0, 100).title, null);
  assert.equal(titleFor(1, 100).title.key, 'beginner');
  assert.equal(titleFor(20, 100).title.key, 'bronze');
  assert.equal(titleFor(59, 100).title.key, 'silver');
  assert.equal(titleFor(59, 100).remainingToNext, 1);
  assert.equal(titleFor(100, 100).title.key, 'master');
  assert.equal(titleFor(100, 100).next, null);
});

// ---- API ----
const content = loadContentDir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'content'));
let server; let base; let db;
before(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db, content);
  db.prepare("INSERT INTO classes (id, name, join_code, join_open, teacher_id, created_at) VALUES ('c1', 'A組', 'JOINAAAA', 1, NULL, ?)").run(now());
  server = http.createServer(createApp(db, { content, registerLimit: 1000 }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
async function student(loginId) {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json', 'x-requested-with': 'fetch' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const r = await call('POST', '/api/auth/register', { joinCode: 'JOINAAAA', loginId, displayName: 's', password: 'student-pass-1', privacyAgreed: true });
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), id: r.data.user.id };
}
const yesterday = (userId, table, idCol, id) => db.prepare(`UPDATE ${table} SET created_at = ? WHERE user_id = ? AND ${idCol} = ?`).run(new Date(Date.now() - 2 * 864e5).toISOString(), userId, id);

test('教材: 各単元に単語・熟語・構文のカードがある', () => {
  for (const lv of ['a2', 'b1', 'b2']) {
    const cards = cardsForUnit(db, `school-life-${lv}-u1`);
    for (const t of ['word', 'phrase', 'structure']) assert.ok(cards.filter((c) => c.type === t).length >= 5, `${lv} ${t}`);
    assert.equal(new Set(cards.map((c) => c.id)).size, cards.length, 'カード ID は一意');
  }
});

test('API: 問題の解答でスタンプの進み具合を返し、日をあけた3連続正解でスタンプを記録', async () => {
  const s = await student('s-stamp');
  const q = (await s.get('/api/units/school-life-a2-u1')).data.unit.activities.find((a) => a.kind === 'reading').questions[0];
  let r = await s.post('/api/attempts', { clientId: 'st-1', questionId: q.id, context: 'unit', response: q.answer });
  assert.equal(r.data.stamp.streak, 1); assert.equal(r.data.stamp.earned, false);
  await s.post('/api/attempts', { clientId: 'st-2', questionId: q.id, context: 'unit', response: q.answer });
  r = await s.post('/api/attempts', { clientId: 'st-3', questionId: q.id, context: 'unit', response: q.answer });
  assert.equal(r.data.stamp.earned, false, '同じ日の3連続ではもらえない');
  assert.equal(r.data.stamp.needsNewDay, true);
  // 過去2回を前日に移し、今日もう一度正解
  db.prepare("UPDATE attempts SET created_at = ? WHERE client_id IN ('st-1','st-2')").run(new Date(Date.now() - 2 * 864e5).toISOString());
  // 前日の分は「スタンプ挑戦」に出る
  const rv = (await s.get('/api/review')).data;
  assert.ok(Array.isArray(rv.stampChallenges));
  r = await s.post('/api/attempts', { clientId: 'st-4', questionId: q.id, context: 'unit', response: q.answer });
  assert.equal(r.data.stamp.newlyEarned, true);
  const st = (await s.get('/api/stamps')).data;
  const a2 = st.levels.find((L) => L.level === 'A2');
  assert.equal(a2.count, 1); assert.equal(a2.title.key, 'beginner');
  assert.ok(a2.total > 69, '問題とカードの合計');
  assert.equal(a2.grid.filter(Boolean).length, 1);
});

test('API: カードの小テストもスタンプの対象で、回答はサーバーで判定する', async () => {
  const s = await student('s-card');
  const { cards } = (await s.get('/api/cards?unitId=school-life-b1-u1')).data;
  const c = cards.find((x) => x.type === 'structure');
  assert.ok(c);
  const wrong = await s.post('/api/cards/attempts', { clientId: 'k-0', cardId: c.id, response: 'でたらめ' });
  assert.equal(wrong.data.correct, false); assert.equal(wrong.data.answer, c.meaning);
  for (const n of [1, 2]) await s.post('/api/cards/attempts', { clientId: `k-${n}`, cardId: c.id, response: c.meaning });
  yesterday(s.id, 'card_attempts', 'card_id', c.id);
  const r = await s.post('/api/cards/attempts', { clientId: 'k-3', cardId: c.id, response: c.meaning });
  assert.equal(r.data.stamp.newlyEarned, true);
  const again = await s.post('/api/cards/attempts', { clientId: 'k-3', cardId: c.id, response: c.meaning });
  assert.equal(again.data.duplicate, true, '同じ clientId は二重に記録しない');
  const after = (await s.get('/api/cards?unitId=school-life-b1-u1')).data.cards.find((x) => x.id === c.id);
  assert.equal(after.stamp.earned, true);
  assert.equal((await s.post('/api/cards/attempts', { clientId: 'k-9', cardId: 'nope:x', response: 'a' })).status, 404);
  const ex = (await s.get('/api/me/export')).data;
  assert.equal(ex.stamps.length, 1); assert.equal(ex.cardAttempts.length, 4);
  await s.post('/api/me/delete', { password: 'student-pass-1' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stamps WHERE user_id = ?').get(s.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM card_attempts WHERE user_id = ?').get(s.id).n, 0);
});
