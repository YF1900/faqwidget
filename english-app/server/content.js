// 教材（構造化データ）の検証・取り込み・版管理・書き出し
import fs from 'node:fs';
import path from 'node:path';
import { tx, now } from './db.js';

export const LEVELS = ['A2', 'B1', 'B2'];
export const SKILLS = ['reading', 'listening', 'writing', 'speaking'];
export const STEP_KINDS = ['intro', 'explain', 'reading', 'listening', 'writing', 'speaking', 'check', 'wrapup'];
const KIND_SKILL = { intro: 'vocabulary', explain: 'grammar', reading: 'reading', listening: 'listening', writing: 'writing', speaking: 'speaking', check: 'mixed', wrapup: 'mixed' };
const FOCUS = ['main-idea', 'specific-info', 'inference', 'attitude', 'vocabulary', 'grammar', 'function', 'reference'];
const ID_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;
const EXAM_BY_LEVEL = { A2: 'A2 Key for Schools', B1: 'B1 Preliminary for Schools', B2: 'B2 First for Schools' };

const isStr = (v, max = 5000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** 問題1問の検証。エラーメッセージ（日本語）の配列を返す */
export function validateQuestion(q, where = '問題') {
  const e = [];
  if (!q || typeof q !== 'object') return [`${where}: オブジェクトではありません`];
  if (!ID_RE.test(q.id || '')) e.push(`${where}: id が不正です（英小文字・数字・ハイフン）`);
  if (!['mcq', 'text'].includes(q.type)) e.push(`${where}: type は mcq か text です`);
  if (!isStr(q.stem, 2000)) e.push(`${where}: 問題文（stem）が空です`);
  if (!isStr(q.explanation, 4000)) e.push(`${where}: 解説（explanation）が空です`);
  if (q.type === 'mcq') {
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 5 || !q.options.every((o) => isStr(o, 500)))
      e.push(`${where}: 選択肢（options）は2〜5個の文字列です`);
    else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length)
      e.push(`${where}: 正答（answer）が選択肢の範囲外です`);
  }
  if (q.type === 'text' && (!Array.isArray(q.accept) || !q.accept.length || !q.accept.every((a) => isStr(a, 200))))
    e.push(`${where}: 短答問題には正答の表記（accept）が必要です`);
  if (q.focus != null && !FOCUS.includes(q.focus)) e.push(`${where}: focus が不正です`);
  if (q.difficulty != null && ![1, 2, 3].includes(q.difficulty)) e.push(`${where}: difficulty は1〜3です`);
  if (q.evidence != null && typeof q.evidence !== 'string') e.push(`${where}: evidence は文字列です`);
  return e;
}

function textsOf(act) {
  if (act.kind === 'reading') return (act.passage?.paragraphs || []);
  if (act.kind === 'listening') return (act.script || []).map((l) => l.text);
  return [];
}

/** ユニット全体の検証（取り込み・テストで共用） */
export function validateUnit(u) {
  const e = [];
  if (!u || typeof u !== 'object') return ['ユニットがオブジェクトではありません'];
  if (!ID_RE.test(u.id || '')) e.push('id が不正です');
  if (!LEVELS.includes(u.level)) e.push('level は A2 / B1 / B2 です');
  for (const k of ['theme', 'themeLabel', 'title', 'titleJa']) if (!isStr(u[k], 200)) e.push(`${k} が空です`);
  if (!Array.isArray(u.objectives) || !u.objectives.length) e.push('objectives（学習目標）が必要です');
  const objIds = new Set((u.objectives || []).map((o) => o.id));
  (u.objectives || []).forEach((o, i) => { if (!ID_RE.test(o.id || '') || !isStr(o.text)) e.push(`objectives[${i}] が不正です`); });
  const acts = u.activities || [];
  if (acts.length !== STEP_KINDS.length) e.push(`activities は ${STEP_KINDS.length} 個（step 1〜8）必要です`);
  const ids = new Set();
  acts.forEach((a, i) => {
    const w = `step ${i + 1}`;
    if (a.step !== i + 1 || a.kind !== STEP_KINDS[i]) e.push(`${w}: kind は ${STEP_KINDS[i]} である必要があります`);
    if (!ID_RE.test(a.id || '')) e.push(`${w}: id が不正です`);
    if (ids.has(a.id)) e.push(`${w}: id が重複しています`);
    ids.add(a.id);
    if (!isStr(a.title, 200)) e.push(`${w}: title が空です`);
    if (a.kind === 'reading' && !(a.passage?.paragraphs?.length)) e.push(`${w}: 本文（passage）が空です`);
    if (a.kind === 'listening' && !(a.script?.length && a.script.every((l) => isStr(l.text)))) e.push(`${w}: スクリプトが空です`);
    if (a.kind === 'intro' && !(a.vocabulary?.length)) e.push(`${w}: 語彙（vocabulary）が空です`);
    if (a.kind === 'explain' && !(a.points?.length)) e.push(`${w}: 解説（points）が空です`);
    if (a.kind === 'writing' && !(isStr(a.task?.promptEn) && a.task.minWords > 0 && a.task.maxWords >= a.task.minWords && a.rubricId))
      e.push(`${w}: Writing 課題（promptEn / minWords / maxWords / rubricId）が不足しています`);
    if (a.kind === 'speaking' && !(a.task?.parts?.length && a.rubricId)) e.push(`${w}: Speaking 課題（parts / rubricId）が不足しています`);
    if (a.kind === 'wrapup' && !(a.summary?.length)) e.push(`${w}: summary が空です`);
    const needsQ = ['intro', 'explain', 'reading', 'listening', 'check'].includes(a.kind);
    if (needsQ && !(a.questions?.length)) e.push(`${w}: 問題がありません`);
    const texts = textsOf(a);
    (a.questions || []).forEach((q, qi) => {
      const qw = `${w} 問${qi + 1}`;
      e.push(...validateQuestion(q, qw));
      if (ids.has(q.id)) e.push(`${qw}: id が重複しています`);
      ids.add(q.id);
      if (q.objectiveId && !objIds.has(q.objectiveId)) e.push(`${qw}: objectiveId が学習目標にありません`);
      if (['reading', 'listening'].includes(a.kind)) {
        if (!isStr(q.evidence)) e.push(`${qw}: 根拠（evidence）が必要です`);
        else if (!texts.some((t) => t.includes(q.evidence))) e.push(`${qw}: 根拠（evidence）が本文・スクリプト中に見つかりません`);
      }
      if (a.kind === 'check' && q.stimulus && !a.stimuli?.[q.stimulus]) e.push(`${qw}: stimulus が見つかりません`);
      if (a.kind === 'check' && q.stimulus && isStr(q.evidence) && !a.stimuli[q.stimulus].includes(q.evidence))
        e.push(`${qw}: 根拠（evidence）が stimulus 中に見つかりません`);
    });
  });
  return e;
}

function questionSkill(act, q, objSkill) {
  if (['reading', 'listening'].includes(act.kind)) return act.kind;
  if (act.kind === 'intro') return 'vocabulary';
  if (act.kind === 'explain') return 'grammar';
  const s = objSkill.get(q.objectiveId);
  return ['reading', 'listening', 'vocabulary', 'grammar'].includes(s) ? s : 'reading';
}

const QUESTION_DATA_KEYS = ['stem', 'options', 'answer', 'accept', 'explanation', 'evidence', 'stimulus'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

function recordVersion(db, type, id, version, data, authorId) {
  db.prepare('INSERT OR IGNORE INTO content_versions (entity_type, entity_id, version, data, author_id, created_at) VALUES (?,?,?,?,?,?)')
    .run(type, id, version, JSON.stringify(data), authorId || null, now());
}

function questionRowData(q) {
  return {
    ...pick(q, QUESTION_DATA_KEYS),
    type: q.type, focus: q.focus || null, difficulty: q.difficulty || 2, objectiveId: q.objectiveId || null,
  };
}

/**
 * ユニットを取り込む（新規作成または更新）。変更があった問題・活動だけ版を上げる。
 * 取り込み済みで今回のデータに含まれない問題は削除せず非公開にする（過去の解答履歴を保つため）。
 */
export function upsertUnit(db, u, authorId = null) {
  const errors = validateUnit(u);
  if (errors.length) { const err = new Error('教材データに誤りがあります'); err.details = errors; err.status = 400; throw err; }
  return tx(db, () => {
    const t = now();
    const exam = u.exam || EXAM_BY_LEVEL[u.level];
    const existing = db.prepare('SELECT * FROM units WHERE id = ?').get(u.id);
    const unitMeta = { theme: u.theme, themeLabel: u.themeLabel, level: u.level, exam, order: u.order || 1, title: u.title, titleJa: u.titleJa, estimatedMinutes: u.estimatedMinutes || null, objectives: u.objectives };
    let unitVersion = 1;
    if (!existing) {
      db.prepare(`INSERT INTO units (id, theme, theme_label, level, exam, order_no, title, title_ja, estimated_minutes, status, version, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(u.id, u.theme, u.themeLabel, u.level, exam, u.order || 1, u.title, u.titleJa, u.estimatedMinutes || null, u.status === 'hidden' ? 'hidden' : 'published', 1, t);
    } else {
      const prev = db.prepare("SELECT data FROM content_versions WHERE entity_type='unit' AND entity_id=? AND version=?").get(u.id, existing.version);
      unitVersion = prev && prev.data === JSON.stringify(unitMeta) ? existing.version : existing.version + 1;
      db.prepare(`UPDATE units SET theme=?, theme_label=?, level=?, exam=?, order_no=?, title=?, title_ja=?, estimated_minutes=?, version=?, updated_at=? WHERE id=?`)
        .run(u.theme, u.themeLabel, u.level, exam, u.order || 1, u.title, u.titleJa, u.estimatedMinutes || null, unitVersion, t, u.id);
    }
    recordVersion(db, 'unit', u.id, unitVersion, unitMeta, authorId);
    db.prepare('DELETE FROM objectives WHERE unit_id = ?').run(u.id);
    u.objectives.forEach((o, i) => db.prepare('INSERT INTO objectives (id, unit_id, position, skill, text) VALUES (?,?,?,?,?)').run(o.id, u.id, i, o.skill || 'mixed', o.text));
    const objSkill = new Map(u.objectives.map((o) => [o.id, o.skill]));

    for (const a of u.activities) {
      const { questions = [], ...rest } = a;
      const actData = { ...rest };
      delete actData.status;
      saveActivityData(db, u.id, a.step, a.kind, KIND_SKILL[a.kind], actData, authorId, a.status);
      const keep = new Set();
      questions.forEach((q, pos) => {
        keep.add(q.id);
        saveQuestion(db, a.id, pos, q, { level: u.level, theme: u.theme, exam, skill: questionSkill(a, q, objSkill) }, authorId);
      });
      const others = db.prepare('SELECT id FROM questions WHERE activity_id = ?').all(a.id);
      for (const o of others) if (!keep.has(o.id)) db.prepare("UPDATE questions SET status='hidden', updated_at=? WHERE id=?").run(t, o.id);
    }
    return { id: u.id, version: unitVersion };
  });
}

function saveActivityData(db, unitId, step, kind, skill, data, authorId, status) {
  const t = now();
  const ex = db.prepare('SELECT version, data FROM activities WHERE id = ?').get(data.id);
  const json = JSON.stringify(data);
  if (!ex) {
    db.prepare('INSERT INTO activities (id, unit_id, step, kind, skill, status, version, data, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(data.id, unitId, step, kind, skill, status === 'hidden' ? 'hidden' : 'published', 1, json, t);
    recordVersion(db, 'activity', data.id, 1, data, authorId);
    return 1;
  }
  if (ex.data === json) return ex.version;
  const v = ex.version + 1;
  db.prepare('UPDATE activities SET data=?, version=?, updated_at=? WHERE id=?').run(json, v, t, data.id);
  recordVersion(db, 'activity', data.id, v, data, authorId);
  return v;
}

function saveQuestion(db, activityId, position, q, meta, authorId) {
  const t = now();
  const data = questionRowData(q);
  const json = JSON.stringify(pick(data, QUESTION_DATA_KEYS));
  const full = { ...data, level: meta.level, skill: meta.skill, theme: meta.theme, exam: meta.exam };
  const ex = db.prepare('SELECT * FROM questions WHERE id = ?').get(q.id);
  if (ex && ex.activity_id !== activityId) { const err = new Error(`問題ID ${q.id} は別の活動で使われています`); err.status = 400; throw err; }
  const cols = [meta.level, meta.skill, meta.theme, meta.exam, data.difficulty, data.objectiveId, data.focus, data.type];
  if (!ex) {
    db.prepare(`INSERT INTO questions (id, activity_id, position, status, version, level, skill, theme, exam, difficulty, objective_id, focus, type, data, updated_at)
      VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)`).run(q.id, activityId, position, q.status === 'hidden' ? 'hidden' : 'published', ...cols, json, t);
    recordVersion(db, 'question', q.id, 1, full, authorId);
    return 1;
  }
  const same = ex.data === json && ex.level === meta.level && ex.skill === meta.skill && ex.difficulty === data.difficulty
    && ex.objective_id === data.objectiveId && ex.focus === data.focus && ex.type === data.type && ex.exam === meta.exam && ex.theme === meta.theme;
  const status = q.status ? (q.status === 'hidden' ? 'hidden' : 'published') : 'published';
  if (same) {
    db.prepare('UPDATE questions SET position=?, status=?, updated_at=? WHERE id=?').run(position, status, t, q.id);
    return ex.version;
  }
  const v = ex.version + 1;
  db.prepare(`UPDATE questions SET position=?, status=?, version=?, level=?, skill=?, theme=?, exam=?, difficulty=?, objective_id=?, focus=?, type=?, data=?, updated_at=? WHERE id=?`)
    .run(position, status, v, ...cols, json, t, q.id);
  recordVersion(db, 'question', q.id, v, full, authorId);
  return v;
}

// 根拠（evidence）が本文・スクリプト・参照英文の中にあるか確認する
function evidenceErrors(act, q) {
  const data = JSON.parse(act.data);
  const full = { ...data, kind: act.kind };
  if (['reading', 'listening'].includes(act.kind)) {
    if (!isStr(q.evidence)) return ['Reading・Listening の問題には根拠（evidence）が必要です'];
    if (!textsOf(full).some((t) => t.includes(q.evidence))) return ['根拠（evidence）が本文・スクリプト中に見つかりません（完全一致で入力してください）'];
  }
  if (act.kind === 'check' && q.stimulus) {
    if (!data.stimuli?.[q.stimulus]) return ['参照する英文（stimulus）が見つかりません'];
    if (isStr(q.evidence) && !data.stimuli[q.stimulus].includes(q.evidence)) return ['根拠（evidence）が参照英文中に見つかりません'];
  }
  return [];
}

export function questionFromRow(r) {
  const d = JSON.parse(r.data);
  return {
    id: r.id, version: r.version, status: r.status, type: r.type, level: r.level, skill: r.skill, theme: r.theme, exam: r.exam,
    difficulty: r.difficulty, objectiveId: r.objective_id, focus: r.focus, activityId: r.activity_id, ...d,
  };
}

/** ユニットを組み立てる。includeHidden=false なら生徒向け（公開中のみ） */
export function getUnit(db, unitId, { includeHidden = false } = {}) {
  const u = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId);
  if (!u || (!includeHidden && u.status !== 'published')) return null;
  const objectives = db.prepare('SELECT id, skill, text FROM objectives WHERE unit_id = ? ORDER BY position').all(unitId);
  const acts = db.prepare('SELECT * FROM activities WHERE unit_id = ? ORDER BY step').all(unitId)
    .filter((a) => includeHidden || a.status === 'published')
    .map((a) => {
      const data = JSON.parse(a.data);
      const qs = db.prepare('SELECT * FROM questions WHERE activity_id = ? ORDER BY position').all(a.id)
        .filter((q) => includeHidden || q.status === 'published').map(questionFromRow);
      return { ...data, id: a.id, step: a.step, kind: a.kind, skill: a.skill, status: a.status, version: a.version, questions: qs };
    });
  return {
    id: u.id, theme: u.theme, themeLabel: u.theme_label, level: u.level, exam: u.exam, order: u.order_no, title: u.title,
    titleJa: u.title_ja, estimatedMinutes: u.estimated_minutes, status: u.status, version: u.version, objectives, activities: acts,
  };
}

/** 書き出し用（SCHEMA.md 形式。版・内部項目を除く） */
export function exportUnit(db, unitId) {
  const u = getUnit(db, unitId, { includeHidden: true });
  if (!u) return null;
  const strip = (q) => {
    const o = { id: q.id, type: q.type, ...pick(q, QUESTION_DATA_KEYS), focus: q.focus || undefined, difficulty: q.difficulty, objectiveId: q.objectiveId || undefined };
    if (q.status === 'hidden') o.status = 'hidden';
    return JSON.parse(JSON.stringify(o));
  };
  return {
    id: u.id, theme: u.theme, themeLabel: u.themeLabel, level: u.level, exam: u.exam, order: u.order, title: u.title, titleJa: u.titleJa,
    estimatedMinutes: u.estimatedMinutes, status: u.status === 'hidden' ? 'hidden' : undefined, objectives: u.objectives.map(({ id, skill, text }) => ({ id, skill, text })),
    activities: u.activities.map(({ version, questions, skill, status, ...a }) => {
      const out = { ...a, questions: questions.map(strip) };
      if (status === 'hidden') out.status = 'hidden';
      if (!['intro', 'explain', 'reading', 'listening', 'check'].includes(a.kind) && !questions.length) delete out.questions;
      return out;
    }),
  };
}

export function getQuestion(db, id) {
  const r = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  return r ? questionFromRow(r) : null;
}

/** 教員による問題の編集。内容が変わった場合のみ版を上げる */
export function updateQuestion(db, id, patch, authorId) {
  return tx(db, () => {
    const cur = getQuestion(db, id);
    if (!cur) { const e = new Error('問題が見つかりません'); e.status = 404; throw e; }
    const next = { ...cur, ...pick(patch, [...QUESTION_DATA_KEYS, 'type', 'focus', 'difficulty', 'objectiveId', 'status']) };
    if (next.type === 'text') delete next.options, delete next.answer;
    if (next.type === 'mcq') delete next.accept;
    if (next.evidence === '') delete next.evidence;
    if (next.stimulus === '') delete next.stimulus;
    const errs = validateQuestion(next);
    const act = db.prepare('SELECT kind, data FROM activities WHERE id = ?').get(cur.activityId);
    errs.push(...evidenceErrors(act, next));
    if (errs.length) { const e = new Error('入力内容に誤りがあります'); e.details = errs; e.status = 400; throw e; }
    const meta = {
      level: LEVELS.includes(patch.level) ? patch.level : cur.level,
      skill: ['reading', 'listening', 'vocabulary', 'grammar'].includes(patch.skill) ? patch.skill : cur.skill,
      theme: isStr(patch.theme, 100) ? patch.theme : cur.theme,
      exam: isStr(patch.exam, 100) ? patch.exam : cur.exam,
    };
    const pos = db.prepare('SELECT position FROM questions WHERE id=?').get(id).position;
    saveQuestion(db, cur.activityId, pos, next, meta, authorId);
    return getQuestion(db, id);
  });
}

export function createQuestion(db, activityId, q, authorId) {
  return tx(db, () => {
    const act = db.prepare('SELECT a.*, u.level, u.theme, u.exam FROM activities a JOIN units u ON u.id = a.unit_id WHERE a.id = ?').get(activityId);
    if (!act) { const e = new Error('活動が見つかりません'); e.status = 404; throw e; }
    if (db.prepare('SELECT 1 FROM questions WHERE id = ?').get(q.id)) { const e = new Error('その問題IDは既に使われています'); e.status = 409; throw e; }
    if (q.evidence === '') delete q.evidence;
    if (q.stimulus === '') delete q.stimulus;
    const errs = [...validateQuestion(q), ...evidenceErrors(act, q)];
    if (errs.length) { const e = new Error('入力内容に誤りがあります'); e.details = errs; e.status = 400; throw e; }
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM questions WHERE activity_id = ?').get(activityId).p;
    const skill = ['reading', 'listening'].includes(act.kind) ? act.kind : act.kind === 'intro' ? 'vocabulary' : act.kind === 'explain' ? 'grammar'
      : (['reading', 'listening', 'vocabulary', 'grammar'].includes(q.skill) ? q.skill : 'reading');
    saveQuestion(db, activityId, pos, q, { level: act.level, theme: act.theme, exam: act.exam, skill }, authorId);
    return getQuestion(db, q.id);
  });
}

// 教員が編集できる活動のフィールド（kind ごと）
const ACTIVITY_EDITABLE = ['title', 'instructions', 'minutes', 'passage', 'setting', 'script', 'task', 'vocabulary', 'points', 'examNote', 'stimuli', 'summary', 'commonMistakes', 'next', 'rubricId'];

export function updateActivity(db, id, patch, authorId) {
  return tx(db, () => {
    const a = db.prepare('SELECT * FROM activities WHERE id = ?').get(id);
    if (!a) { const e = new Error('活動が見つかりません'); e.status = 404; throw e; }
    const data = JSON.parse(a.data);
    for (const k of ACTIVITY_EDITABLE) if (patch[k] !== undefined) data[k] = patch[k];
    if (!isStr(data.title, 200)) { const e = new Error('タイトルは必須です'); e.status = 400; throw e; }
    if (a.kind === 'reading' && !(Array.isArray(data.passage?.paragraphs) && data.passage.paragraphs.every((p) => typeof p === 'string') && data.passage.paragraphs.length)) {
      const e = new Error('本文は1段落以上必要です'); e.status = 400; throw e;
    }
    if (a.kind === 'listening' && !(Array.isArray(data.script) && data.script.length && data.script.every((l) => isStr(l.text)))) {
      const e = new Error('スクリプトは1行以上必要です'); e.status = 400; throw e;
    }
    if (a.kind === 'writing' && !(data.task?.minWords > 0 && data.task.maxWords >= data.task.minWords)) {
      const e = new Error('語数の目安が不正です'); e.status = 400; throw e;
    }
    saveActivityData(db, a.unit_id, a.step, a.kind, a.skill, data, authorId);
    if (patch.status && ['published', 'hidden'].includes(patch.status)) db.prepare('UPDATE activities SET status=?, updated_at=? WHERE id=?').run(patch.status, now(), id);
    return db.prepare('SELECT id, version, status FROM activities WHERE id=?').get(id);
  });
}

export function setUnitStatus(db, id, status) {
  if (!['published', 'hidden'].includes(status)) { const e = new Error('status が不正です'); e.status = 400; throw e; }
  const r = db.prepare('UPDATE units SET status=?, updated_at=? WHERE id=?').run(status, now(), id);
  if (!r.changes) { const e = new Error('単元が見つかりません'); e.status = 404; throw e; }
}

export function listVersions(db, type, id) {
  return db.prepare('SELECT version, data, author_id, created_at FROM content_versions WHERE entity_type=? AND entity_id=? ORDER BY version DESC')
    .all(type, id).map((r) => ({ ...r, data: JSON.parse(r.data) }));
}

export function loadContentDir(dir) {
  const unitsDir = path.join(dir, 'units');
  const units = fs.existsSync(unitsDir) ? fs.readdirSync(unitsDir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(unitsDir, f), 'utf8'))) : [];
  const rubrics = JSON.parse(fs.readFileSync(path.join(dir, 'rubrics.json'), 'utf8')).rubrics;
  const diagnostic = JSON.parse(fs.readFileSync(path.join(dir, 'diagnostic.json'), 'utf8'));
  return { units, rubrics, diagnostic };
}

/** 初回起動時にだけ教材を取り込む（以降は教員の編集内容を上書きしない） */
export function seedIfEmpty(db, content) {
  const seeded = db.prepare("SELECT value FROM meta WHERE key='content_seeded'").get();
  for (const r of content.rubrics) {
    db.prepare('INSERT OR IGNORE INTO rubrics (id, skill, level, version, data) VALUES (?,?,?,1,?)').run(r.id, r.skill, r.level, JSON.stringify(r));
  }
  if (seeded) {
    // 新しく追加された教材ファイルだけ取り込む
    for (const u of content.units) if (!db.prepare('SELECT 1 FROM units WHERE id=?').get(u.id)) upsertUnit(db, u);
    return false;
  }
  for (const u of content.units) upsertUnit(db, u);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('content_seeded', ?)").run(now());
  return true;
}

export function getRubrics(db) {
  return db.prepare('SELECT data FROM rubrics ORDER BY id').all().map((r) => JSON.parse(r.data));
}
