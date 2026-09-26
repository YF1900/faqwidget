import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContentDir, validateUnit, STEP_KINDS } from '../server/content.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');
const content = loadContentDir(dir);

test('A2・B1・B2 の「学校生活・部活動」第1単元がそろっている', () => {
  const levels = content.units.filter((u) => u.theme === 'school-life' && u.order === 1).map((u) => u.level).sort();
  assert.deepEqual(levels, ['A2', 'B1', 'B2']);
});

for (const u of content.units) {
  test(`${u.id}: スキーマ検証（根拠の完全一致・正答の範囲・ID の重複なし）`, () => {
    assert.deepEqual(validateUnit(u), []);
  });
  test(`${u.id}: 単元の10要素（目標・語彙・解説・R・L・W・S・確認・ふり返り・次の提案）を含む`, () => {
    // スピーキング以外の活動は3つずつ（Speaking とふり返りは1つ）
    const count = (k) => u.activities.filter((a) => a.kind === k).length;
    for (const k of STEP_KINDS) assert.equal(count(k), ['speaking', 'wrapup'].includes(k) ? 1 : 3, `${k} の数`);
    const by = Object.fromEntries(u.activities.map((a) => [a.kind, a]));
    assert.ok(u.objectives.length >= 4, '学習目標');
    const all = (k) => u.activities.filter((a) => a.kind === k);
    assert.ok(all('intro').every((a) => a.vocabulary.length >= 10), '語彙');
    assert.ok(all('explain').every((a) => a.points.every((p) => p.text && p.examples?.length)), '解説と例');
    assert.ok(all('reading').every((a) => a.questions.length >= 5) && all('listening').every((a) => a.questions.length >= 5));
    assert.ok(all('listening').every((a) => a.script.length >= 4), 'スクリプト');
    assert.ok(all('writing').every((a) => a.task.modelAnswer && a.task.selfCheck.length >= 4), 'Writing 課題');
    assert.ok(by.speaking.task.parts.every((p) => p.prepSeconds > 0 && p.answerSeconds > 0), 'Speaking 準備時間');
    assert.ok(all('check').every((a) => a.questions.length >= 5), '確認問題');
    assert.ok(by.wrapup.summary.length && by.wrapup.next?.text, 'ふり返りと次の提案');
    for (const a of u.activities) for (const q of a.questions || []) assert.ok(q.explanation.length > 10, `${q.id} の解説`);
  });
  test(`${u.id}: Writing の模範解答が語数の目安に近い`, () => {
    for (const { task: t, id } of u.activities.filter((a) => a.kind === 'writing')) {
      const n = (t.modelAnswer.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
      assert.ok(n >= t.minWords && n <= t.maxWords + 10, `${id}: ${n} 語（${t.minWords}〜${t.maxWords}）`);
    }
  });
  test(`${u.id}: スピーキング以外の問題数が初期版（約24問）の3倍程度`, () => {
    const n = u.activities.reduce((s, a) => s + (a.questions || []).length, 0);
    assert.ok(n >= 66, `${n} 問`);
  });
}

test('評価基準: 各技能・各レベルに5観点（発音だけを重視しない）', () => {
  for (const skill of ['writing', 'speaking']) for (const L of ['A2', 'B1', 'B2']) {
    const r = content.rubrics.find((x) => x.id === `${skill}-${L.toLowerCase()}`);
    assert.ok(r, `${skill}-${L}`);
    assert.equal(r.criteria.length, 5);
  }
  const sp = content.rubrics.find((x) => x.id === 'speaking-b1').criteria.map((c) => c.key);
  assert.ok(sp.includes('content') && sp.includes('interaction') && sp.includes('explanation'));
});

test('診断: 各技能・各レベルがそろい、根拠が本文に含まれる', () => {
  const d = content.diagnostic;
  for (const skill of ['reading', 'listening']) {
    for (const L of ['A2', 'B1', 'B2']) assert.equal(d[skill].sections.filter((s) => s.level === L).reduce((n, s) => n + s.questions.length, 0), 9, `${skill} ${L} は9問`);
    const levelsOrder = d[skill].sections.map((s) => ['A2', 'B1', 'B2'].indexOf(s.level));
    assert.deepEqual(levelsOrder, [...levelsOrder].sort(), 'A2 → B1 → B2 の順');
    for (const s of d[skill].sections) {
      const texts = skill === 'reading' ? s.passage.paragraphs : s.script.map((l) => l.text);
      for (const q of s.questions) {
        assert.ok(q.answer >= 0 && q.answer < q.options.length);
        assert.ok(texts.some((t) => t.includes(q.evidence)), q.id);
      }
    }
  }
  assert.equal(d.writing.canDo.length, 9);
  assert.equal(d.speaking.canDo.length, 9);
});
