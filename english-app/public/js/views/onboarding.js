// 初回設定・目標選択
import { h, replace, EXAM_JA } from '../dom.js';
import { api } from '../api.js';
import { state, setTitle, refreshMe, go } from '../main.js';
import { disclaimer } from '../components.js';

export default async function onboardingView() {
  const editing = !!state.me.target;
  setTitle(editing ? '目標の変更' : 'はじめに', editing ? { back: '#/settings' } : {});
  const cur = state.me.target || {};
  let exam = cur.exam || null;
  const examOptions = [
    ['A2', 'A2 Key for Schools', '基礎: 日常の短いやり取り・簡単なメッセージ'],
    ['B1', 'B1 Preliminary for Schools', '標準: 身近な話題で経験や理由を述べる'],
    ['B2', 'B2 First for Schools', '発展: 主張と根拠・比較・議論'],
    ['undecided', 'まだ決めていない', '診断の結果から候補を提案します'],
  ];
  const name = 'exam';
  const radios = examOptions.map(([v, label, desc]) => h('label', { class: 'choice' },
    h('input', { type: 'radio', name, value: v, checked: exam === v, onchange: () => { exam = v; btn.disabled = false; } }),
    h('span', { class: 'choice-body' }, h('strong', null, label), h('span', { class: 'small muted' }, desc))));
  const month = h('input', { type: 'month', value: cur.planned_month || '', min: new Date().toISOString().slice(0, 7), id: 'planned-month' });
  const msg = h('p', { class: 'error-text', role: 'alert' });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block', disabled: !exam }, editing ? '保存する' : '次へ');
  return h('div', { class: 'stack narrow' },
    editing ? null : h('div', { class: 'card' }, h('h2', { class: 'card-title' }, `${state.me.user.displayName} さん、ようこそ`),
      h('p', null, '最初に目標を決め、そのあと4技能（Reading・Listening・Writing・Speaking）の簡単な診断を受けます。診断の結果に合わせて、技能ごとに教材のレベルを提案します。')),
    h('form', { class: 'card form', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      try {
        await api.put('/api/me/target', { exam, plannedMonth: month.value || null });
        await refreshMe();
        go(editing ? '#/settings' : (state.me.hasDiagnostic ? '#/home' : '#/diagnostic'));
      } catch (err) { replace(msg, err.message); btn.disabled = false; }
    } },
    h('fieldset', { class: 'choices' }, h('legend', null, '目標とする試験'), radios),
    h('div', { class: 'field' }, h('label', { for: 'planned-month' }, '受験予定時期（任意）'), month, h('p', { class: 'hint' }, '未定なら空欄のままでかまいません。')),
    msg, btn),
    h('p', { class: 'small muted' }, `現在の目標: ${cur.exam ? EXAM_JA[cur.exam] : '未設定'}`),
    disclaimer());
}
