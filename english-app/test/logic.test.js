import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSkillProgress, attemptValue } from '../server/mastery.js';
import { nextReviewState, INTERVAL_DAYS } from '../server/review.js';
import { scoreDiagnostic, suggestExam } from '../server/diagnostic.js';
import { gradeQuestion, normalizeText, countWords } from '../server/app.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContentDir } from '../server/content.js';

const levels = { reading: { level: 'B1', level_source: 'diagnostic' }, listening: { level: 'A2', level_source: 'default' }, writing: { level: 'A2' }, speaking: { level: 'A2' } };
const att = (q, correct, extra = {}) => ({ question_id: q, skill: 'reading', level: 'B1', correct, support: {}, ...extra });

test('習熟度: 3問未満はデータ不足として判定しない', () => {
  const p = computeSkillProgress({ attempts: [att('q1', true), att('q2', true)], levels });
  assert.equal(p.reading.status, 'insufficient');
  assert.equal(p.listening.status, 'not-started');
});

test('習熟度: スクリプトを見て正解した解答は半分の点数', () => {
  assert.equal(attemptValue({ correct: true, support: { scriptOpened: true } }), 0.5);
  assert.equal(attemptValue({ correct: true, support: {} }), 1);
  assert.equal(attemptValue({ correct: false, support: {} }), 0);
  const p = computeSkillProgress({ attempts: [
    { question_id: 'l1', skill: 'listening', level: 'A2', correct: true, support: { scriptOpened: true } },
    { question_id: 'l2', skill: 'listening', level: 'A2', correct: true, support: { scriptOpened: true } },
    { question_id: 'l3', skill: 'listening', level: 'A2', correct: true, support: { scriptOpened: true } },
  ], levels });
  assert.equal(p.listening.score, 0.5);
  assert.equal(p.listening.supportedAttempts, 3);
  assert.match(p.listening.explanation, /スクリプト/);
});

test('習熟度: 同じ問題を何度解いても直近3回の平均で1問として数える', () => {
  const p = computeSkillProgress({ attempts: [att('q1', false), att('q1', true), att('q1', true), att('q1', true), att('q2', true), att('q3', false)], levels });
  assert.equal(p.reading.questions, 3);
  assert.equal(p.reading.score, (1 + 1 + 0) / 3);
});

test('習熟度: 現在の学習レベル以外の解答は含めない', () => {
  const p = computeSkillProgress({ attempts: [att('q1', true, { level: 'A2' }), att('q2', true, { level: 'A2' }), att('q3', true, { level: 'A2' })], levels });
  assert.equal(p.reading.status, 'not-started');
});

test('習熟度: Writing は教員評価と自己評価を混ぜない', () => {
  const subs = [{ id: 's1', kind: 'writing', level: 'A2', activity_id: 'w', self_scores: { task: 5, grammar: 5 } }];
  const selfOnly = computeSkillProgress({ submissions: subs, levels });
  assert.equal(selfOnly.writing.status, 'self-only');
  assert.equal(selfOnly.writing.score, null);
  assert.equal(selfOnly.writing.selfAvg, 5);
  const rated = computeSkillProgress({ submissions: subs, feedback: [{ submission_id: 's1', scores: { task: 2, grammar: 2 } }], levels });
  assert.equal(rated.writing.teacherAvg, 2);
  assert.equal(rated.writing.status, 'needs-work');
});

test('復習スケジュール: 不正解・支援ありは翌日、正解で間隔が伸び、5回で外れる', () => {
  const t0 = Date.parse('2026-09-01T00:00:00Z');
  assert.equal(nextReviewState(null, { correct: true, supported: false }, t0), null);
  let s = nextReviewState(null, { correct: false }, t0);
  assert.equal(s.box, 1);
  assert.equal(s.due_at, new Date(t0 + 864e5).toISOString());
  assert.equal(nextReviewState(null, { correct: true, supported: true }, t0).reason, 'supported');
  for (let i = 2; i <= INTERVAL_DAYS.length; i++) { s = nextReviewState(s, { correct: true, supported: false }, t0); assert.equal(s.box, i); }
  assert.equal(nextReviewState(s, { correct: true, supported: false }, t0), null);
  assert.equal(nextReviewState({ box: 3, reason: 'incorrect' }, { correct: false }, t0).box, 1);
});

const d = loadContentDir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'content')).diagnostic;
const answersFor = (skill, correctLevels) => Object.fromEntries(d[skill].sections.flatMap((s) => s.questions.map((q) => [q.id, correctLevels.includes(s.level) ? q.answer : (q.answer + 1) % q.options.length])));

test('診断: 技能ごとに別々のレベルを出し、単純平均しない', () => {
  const r = scoreDiagnostic(d, {
    reading: { answers: answersFor('reading', ['A2', 'B1']) },
    listening: { answers: answersFor('listening', ['A2']) },
    writing: { canDo: d.writing.canDo.filter((c) => c.level === 'A2').map((c) => c.id) },
    speaking: { canDo: [] },
  });
  assert.equal(r.skills.reading.level, 'B1');
  assert.equal(r.skills.listening.level, 'A2');
  assert.equal(r.skills.writing.level, 'A2');
  assert.equal(r.skills.writing.method, 'self');
  assert.equal(r.skills.speaking.foundation, true);
  assert.equal(r.skills.reading.method, 'auto');
});

test('診断: スクリプト使用を記録し、目標の候補は低めの中央値', () => {
  const r = scoreDiagnostic(d, { reading: { answers: answersFor('reading', ['A2', 'B1', 'B2']) }, listening: { answers: {}, scriptOpened: true } });
  assert.equal(r.skills.reading.level, 'B2');
  assert.equal(r.skills.listening.supported, true);
  assert.equal(suggestExam({ a: { level: 'B2' }, b: { level: 'B1' }, c: { level: 'A2' }, d: { level: 'A2' } }), 'A2');
  assert.equal(suggestExam({ a: { level: 'B2' }, b: { level: 'B1' }, c: { level: 'B1' }, d: { level: 'A2' } }), 'B1');
});

test('採点: 短答は大文字小文字・空白・句点・アポストロフィの違いを許容', () => {
  const q = { type: 'text', accept: ["i've", 'have'] };
  assert.ok(gradeQuestion(q, ' I’ve. '));
  assert.ok(gradeQuestion(q, 'HAVE'));
  assert.ok(!gradeQuestion(q, 'has'));
  assert.ok(gradeQuestion({ type: 'mcq', answer: 2 }, 2));
  assert.ok(!gradeQuestion({ type: 'mcq', answer: 2 }, '2'));
  assert.equal(normalizeText('  Hello   World! '), 'hello world');
  assert.equal(countWords("I'm in the tennis club. We practise on Mondays."), 9);
});
