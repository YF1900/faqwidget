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
    assert.deepEqual(u.activities.map((a) => a.kind), STEP_KINDS);
    const by = Object.fromEntries(u.activities.map((a) => [a.kind, a]));
    assert.ok(u.objectives.length >= 4, '学習目標');
    assert.ok(by.intro.vocabulary.length >= 10, '語彙');
    assert.ok(by.explain.points.every((p) => p.text && p.examples?.length), '解説と例');
    assert.ok(by.reading.questions.length >= 5 && by.listening.questions.length >= 5);
    assert.ok(by.listening.script.length >= 6, 'スクリプト');
    assert.ok(by.writing.task.modelAnswer && by.writing.task.selfCheck.length >= 4, 'Writing 課題');
    assert.ok(by.speaking.task.parts.every((p) => p.prepSeconds > 0 && p.answerSeconds > 0), 'Speaking 準備時間');
    assert.ok(by.check.questions.length >= 5, '確認問題');
    assert.ok(by.wrapup.summary.length && by.wrapup.next?.text, 'ふり返りと次の提案');
    for (const a of u.activities) for (const q of a.questions || []) assert.ok(q.explanation.length > 10, `${q.id} の解説`);
  });
  test(`${u.id}: Writing の模範解答が語数の目安に近い`, () => {
    const t = u.activities.find((a) => a.kind === 'writing').task;
    const n = (t.modelAnswer.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
    assert.ok(n >= t.minWords && n <= t.maxWords + 10, `${n} 語（${t.minWords}〜${t.maxWords}）`);
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
    assert.deepEqual(d[skill].sections.map((s) => s.level), ['A2', 'B1', 'B2']);
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
