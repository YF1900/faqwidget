// 教材編集（PC での利用を想定。iPhone でも操作可能）
import { h, replace, LEVEL_JA, KIND_JA, fmtDate, toast, downloadJson, confirmDialog } from '../dom.js';
import { api } from '../api.js';
import { setTitle, go } from '../main.js';

const FOCUS = ['', 'main-idea', 'specific-info', 'inference', 'attitude', 'vocabulary', 'grammar', 'function', 'reference'];
const STATUS_JA = { published: '公開', hidden: '非公開' };

export async function contentListView() {
  setTitle('教材の管理');
  const { units } = await api.get('/api/content/units');
  const file = h('input', { type: 'file', accept: 'application/json,.json', id: 'import-file' });
  const importMsg = h('div', { 'aria-live': 'polite' });
  return h('div', { class: 'stack wide' },
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, '単元'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
        h('thead', null, h('tr', null, h('th', null, '単元'), h('th', null, 'レベル'), h('th', null, '状態'), h('th', null, '版'), h('th', null, '操作'))),
        h('tbody', null, units.map((u) => h('tr', null,
          h('td', null, h('a', { href: `#/t/content/${encodeURIComponent(u.id)}` }, `${u.themeLabel} 第${u.order}単元 ${u.titleJa}`), h('span', { class: 'small muted block', lang: 'en' }, u.title)),
          h('td', null, LEVEL_JA[u.level]),
          h('td', null, STATUS_JA[u.status]),
          h('td', null, `v${u.version}`, h('span', { class: 'small muted block' }, fmtDate(u.updatedAt))),
          h('td', null, h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn btn-small btn-secondary', onclick: async () => {
              await api.patch(`/api/content/units/${encodeURIComponent(u.id)}`, { status: u.status === 'published' ? 'hidden' : 'published' });
              toast(u.status === 'published' ? '非公開にしました' : '公開しました', 'success'); go('#/t/content');
            } }, u.status === 'published' ? '非公開にする' : '公開する'),
            h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: async () => downloadJson(await api.get(`/api/content/units/${encodeURIComponent(u.id)}/export`), `${u.id}.json`) }, 'JSON 書き出し'))))))))),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'JSON から取り込み'),
      h('p', { class: 'small' }, '書き出した JSON を編集して取り込むと、同じ ID の単元を更新します（内容が変わった問題だけ版が上がります）。新しい ID なら単元を追加します。形式は content/SCHEMA.md を参照してください。'),
      h('div', { class: 'field' }, h('label', { for: 'import-file' }, 'JSON ファイル'), file),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
        const f = file.files[0];
        if (!f) return replace(importMsg, h('p', { class: 'error-text' }, 'ファイルを選んでください'));
        if (f.size > 1024 * 1024) return replace(importMsg, h('p', { class: 'error-text' }, 'ファイルが大きすぎます（1MB まで）'));
        let unit;
        try { unit = JSON.parse(await f.text()); } catch { return replace(importMsg, h('p', { class: 'error-text' }, 'JSON の形式が正しくありません')); }
        try { const r = await api.post('/api/content/import', { unit }); toast(`取り込みました（${r.id} v${r.version}）`, 'success'); go('#/t/content'); } catch (e) {
          replace(importMsg, h('p', { class: 'error-text' }, e.message), e.details ? h('ul', { class: 'small error-text' }, e.details.slice(0, 30).map((d) => h('li', null, d))) : null);
        }
      } }, '取り込む'), importMsg));
}

export async function unitEditorView({ params }) {
  const { unit, rubrics } = await api.get(`/api/content/units/${encodeURIComponent(params.id)}`);
  setTitle(`編集: ${unit.titleJa}（${unit.level}）`, { back: '#/t/content' });
  return h('div', { class: 'stack wide' },
    h('section', { class: 'card' },
      h('p', null, `${unit.themeLabel}・${LEVEL_JA[unit.level]}・${unit.exam}・状態: ${STATUS_JA[unit.status]}・v${unit.version}`),
      h('p', { class: 'small muted' }, '保存すると、生徒の画面には次に開いたときから反映されます。問題を修正すると版（v）が上がり、過去の解答はどの版に対するものか記録されています。'),
      h('ul', { class: 'small' }, unit.objectives.map((o) => h('li', null, `[${o.id}] ${o.text}`)))),
    unit.activities.map((a) => activityEditor(unit, a, rubrics)));
}

function activityEditor(unit, a, rubrics) {
  const fields = [];
  const f = {};
  const input = (key, label, value, attrs = {}) => {
    const el = h('input', { type: 'text', value: value ?? '', id: `${a.id}-${key}`, ...attrs });
    f[key] = el; fields.push(h('div', { class: 'field' }, h('label', { for: el.id }, label), el));
  };
  const area = (key, label, value, rows = 6, hint) => {
    const el = h('textarea', { id: `${a.id}-${key}`, rows, value: value ?? '', spellcheck: 'false' });
    f[key] = el; fields.push(h('div', { class: 'field' }, h('label', { for: el.id }, label), el, hint ? h('p', { class: 'hint' }, hint) : null));
  };
  input('title', 'タイトル', a.title);
  area('instructions', '指示文（日本語）', a.instructions, 2);
  input('minutes', '目安時間（分）', a.minutes, { inputmode: 'numeric' });
  const status = h('select', { id: `${a.id}-status` }, ['published', 'hidden'].map((s) => h('option', { value: s, selected: a.status === s }, STATUS_JA[s])));
  fields.push(h('div', { class: 'field' }, h('label', { for: status.id }, '公開状態'), status));
  if (a.kind === 'reading') {
    input('passageTitle', '本文タイトル', a.passage?.title);
    area('paragraphs', '本文（段落は空行で区切る）', (a.passage?.paragraphs || []).join('\n\n'), 12);
  }
  if (a.kind === 'listening') {
    area('setting', '場面の説明', a.setting, 2);
    area('script', 'スクリプト（1行に「話者|female または male|英文」）', (a.script || []).map((l) => `${l.speaker}|${l.voice || ''}|${l.text}`).join('\n'), 12);
  }
  const jsonKeys = { intro: ['vocabulary'], explain: ['points'], writing: ['task', 'rubricId'], speaking: ['task', 'rubricId'], check: ['examNote', 'stimuli'], wrapup: ['summary', 'commonMistakes', 'next'] }[a.kind] || [];
  for (const k of jsonKeys) area(`json:${k}`, `${k}（JSON）`, JSON.stringify(a[k] ?? null, null, 2), k === 'task' ? 14 : 8, k === 'rubricId' ? `使用できる評価基準: ${rubrics.map((r) => r.id).join(', ')}` : null);
  const msg = h('p', { 'aria-live': 'polite' });
  const save = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
    const patch = { title: f.title.value, instructions: f.instructions.value, minutes: Number(f.minutes.value) || undefined, status: status.value };
    try {
      if (a.kind === 'reading') patch.passage = { title: f.passageTitle.value, paragraphs: f.paragraphs.value.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean) };
      if (a.kind === 'listening') {
        patch.setting = f.setting.value;
        patch.script = f.script.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const [speaker, voice, ...rest] = l.split('|');
          if (!rest.length) throw new Error(`スクリプトの形式が正しくありません: ${l.slice(0, 40)}`);
          return { speaker: speaker.trim(), voice: voice.trim() || undefined, text: rest.join('|').trim() };
        });
      }
      for (const k of jsonKeys) {
        try { patch[k] = JSON.parse(f[`json:${k}`].value); } catch { throw new Error(`${k} の JSON が正しくありません`); }
      }
    } catch (e) { replace(msg, h('span', { class: 'error-text' }, e.message)); return; }
    try {
      const r = await api.patch(`/api/content/activities/${encodeURIComponent(a.id)}`, patch);
      replace(msg, h('span', { class: 'ok-text' }, `保存しました（v${r.version}・${STATUS_JA[r.status]}）`));
    } catch (e) { replace(msg, h('span', { class: 'error-text' }, e.message)); }
  } }, '活動を保存');
  const qList = h('div', { class: 'stack' }, (a.questions || []).map((q) => questionEditor(unit, a, q)));
  const canHaveQ = ['intro', 'explain', 'reading', 'listening', 'check'].includes(a.kind);
  return h('details', { class: 'card editor-block' },
    h('summary', null, `step ${a.step} ${KIND_JA[a.kind]}: ${a.title}（v${a.version}・${STATUS_JA[a.status]}${a.questions?.length ? `・${a.questions.length}問` : ''}）`),
    h('div', { class: 'stack' },
      h('div', { class: 'editor-grid' }, fields), h('div', { class: 'btn-row' }, save, h('a', { class: 'btn btn-ghost', href: `#/unit/${encodeURIComponent(unit.id)}/step/${a.step}` }, '生徒画面で確認')), msg,
      canHaveQ ? h('h3', { class: 'sub-title' }, '問題') : null, qList,
      canHaveQ ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: (e) => { e.target.hidden = true; qList.appendChild(questionEditor(unit, a, null)); } }, '＋ 問題を追加') : null));
}

function questionEditor(unit, a, q) {
  const isNew = !q;
  q = q || { id: '', type: 'mcq', stem: '', options: ['', '', ''], answer: 0, explanation: '', difficulty: 2, focus: '', status: 'published', level: unit.level, skill: a.kind === 'listening' ? 'listening' : 'reading' };
  const pfx = `${a.id}-${q.id || 'new'}`;
  const el = {};
  const row = (label, input, hint) => { input.id = `${pfx}-${label}`; return h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null); };
  el.id = h('input', { type: 'text', value: q.id, disabled: !isNew, pattern: '[a-z0-9][a-z0-9-]+' });
  el.type = h('select', { onchange: () => toggle() }, ['mcq', 'text'].map((t) => h('option', { value: t, selected: q.type === t }, t === 'mcq' ? '選択式' : '短答入力')));
  el.stem = h('textarea', { rows: 2, value: q.stem, lang: 'en' });
  el.options = h('textarea', { rows: 4, value: (q.options || []).join('\n'), lang: 'en' });
  el.answer = h('input', { type: 'number', min: 1, max: 5, value: (q.answer ?? 0) + 1, inputmode: 'numeric' });
  el.accept = h('textarea', { rows: 2, value: (q.accept || []).join('\n'), lang: 'en' });
  el.explanation = h('textarea', { rows: 4, value: q.explanation });
  el.evidence = h('textarea', { rows: 2, value: q.evidence || '', lang: 'en' });
  el.stimulus = h('input', { type: 'text', value: q.stimulus || '' });
  el.focus = h('select', null, FOCUS.map((x) => h('option', { value: x, selected: (q.focus || '') === x }, x || '（なし）')));
  el.difficulty = h('select', null, [1, 2, 3].map((x) => h('option', { value: String(x), selected: q.difficulty === x }, String(x))));
  el.objectiveId = h('select', null, [h('option', { value: '' }, '（なし）'), ...unit.objectives.map((o) => h('option', { value: o.id, selected: q.objectiveId === o.id }, `${o.id}: ${o.text.slice(0, 30)}`))]);
  el.level = h('select', null, ['A2', 'B1', 'B2'].map((x) => h('option', { value: x, selected: q.level === x }, x)));
  el.skill = h('select', { disabled: ['reading', 'listening', 'intro', 'explain'].includes(a.kind) }, ['reading', 'listening', 'vocabulary', 'grammar'].map((x) => h('option', { value: x, selected: q.skill === x }, x)));
  el.exam = h('input', { type: 'text', value: q.exam || unit.exam });
  el.theme = h('input', { type: 'text', value: q.theme || unit.theme });
  el.status = h('select', null, ['published', 'hidden'].map((s) => h('option', { value: s, selected: q.status === s }, STATUS_JA[s])));
  const optRow = row('選択肢（1行に1つ）', el.options); const ansRow = row('正答の番号（1〜）', el.answer); const accRow = row('正答の表記（1行に1つ）', el.accept);
  function toggle() { const mcq = el.type.value === 'mcq'; optRow.hidden = !mcq; ansRow.hidden = !mcq; accRow.hidden = mcq; }
  toggle();
  const msg = h('p', { 'aria-live': 'polite' });
  const versions = h('div');
  const body = () => {
    const b = {
      type: el.type.value, stem: el.stem.value, explanation: el.explanation.value, evidence: el.evidence.value.trim(), stimulus: el.stimulus.value.trim(),
      focus: el.focus.value || null, difficulty: Number(el.difficulty.value), objectiveId: el.objectiveId.value || null, status: el.status.value,
      level: el.level.value, skill: el.skill.value, exam: el.exam.value, theme: el.theme.value,
    };
    if (b.type === 'mcq') { b.options = el.options.value.split('\n').map((s) => s.trim()).filter(Boolean); b.answer = Number(el.answer.value) - 1; } else b.accept = el.accept.value.split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return b; // evidence・stimulus が空文字なら、サーバー側で項目を削除する
  };
  const save = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
    try {
      const r = isNew ? await api.post(`/api/content/activities/${encodeURIComponent(a.id)}/questions`, { id: el.id.value.trim(), ...body() })
        : await api.patch(`/api/content/questions/${encodeURIComponent(q.id)}`, body());
      replace(msg, h('span', { class: 'ok-text' }, `保存しました（v${r.version}・${STATUS_JA[r.status]}）`));
      if (isNew) { el.id.disabled = true; q.id = r.id; }
    } catch (e) { replace(msg, h('span', { class: 'error-text' }, e.message), e.details ? h('ul', { class: 'small error-text' }, e.details.map((d) => h('li', null, d))) : null); }
  } }, isNew ? '問題を作成' : '問題を保存');
  const hist = isNew ? null : h('button', { type: 'button', class: 'btn btn-ghost', onclick: async () => {
    const { versions: vs } = await api.get(`/api/content/question/${encodeURIComponent(q.id)}/versions`);
    replace(versions, h('ul', { class: 'small' }, vs.map((v) => h('li', null, `v${v.version}（${fmtDate(v.created_at)}）: `, h('span', { lang: 'en' }, v.data.stem)))));
  } }, '版の履歴');
  const del = isNew ? null : h('button', { type: 'button', class: 'btn btn-ghost', onclick: async () => {
    if (!(await confirmDialog('この問題を非公開にします（解答履歴は残ります）。', { ok: '非公開にする' }))) return;
    el.status.value = 'hidden'; save.click();
  } }, '非公開にする');
  return h('details', { class: 'qeditor', open: isNew },
    h('summary', null, isNew ? '新しい問題' : `${q.id}（v${q.version}・${STATUS_JA[q.status]}）: `, isNew ? null : h('span', { lang: 'en' }, q.stem)),
    h('div', { class: 'editor-grid' },
      row('問題ID', el.id, isNew ? '英小文字・数字・ハイフン（例: a2u1-r6）' : null), row('形式', el.type), row('問題文', el.stem), optRow, ansRow, accRow,
      row('解説（日本語）', el.explanation), row('根拠（本文中の文字列と完全一致）', el.evidence), row('参照する英文（stimulus キー）', el.stimulus),
      row('問題の種類', el.focus), row('難度', el.difficulty), row('学習目標', el.objectiveId), row('CEFR レベル', el.level), row('技能', el.skill), row('試験', el.exam), row('テーマ', el.theme), row('公開状態', el.status)),
    h('div', { class: 'btn-row' }, save, hist, del), msg, versions);
}
