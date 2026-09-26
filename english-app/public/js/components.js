// 画面部品（設問カード・本文表示・保存状態表示など）
import { h, replace, highlight, uuid } from './dom.js';
import { submitReliably } from './api.js';

export function normalizeText(s) {
  return String(s || '').normalize('NFKC').replace(/[’‘]/g, "'").trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}
export function gradeLocal(q, response) {
  if (q.type === 'mcq') return response === q.answer;
  return (q.accept || []).map(normalizeText).includes(normalizeText(response));
}

export const SAVE_JA = {
  sending: '送信中…',
  saved: '保存済み',
  queued: '未送信（この端末に一時保存中。通信が回復したら再送します）',
  error: '保存できませんでした',
};
export function saveBadge(status, extra) {
  return h('span', { class: `save-badge save-${status}`, role: 'status' }, SAVE_JA[status] + (extra ? ` ${extra}` : ''));
}

export function passageView(passage, needles = []) {
  return h('article', { class: 'passage', lang: 'en' },
    passage.title ? h('h3', { class: 'passage-title' }, passage.title) : null,
    (passage.paragraphs || []).map((p) => h('p', null, highlight(p, needles))));
}

export function scriptView(script, needles = []) {
  return h('div', { class: 'script', lang: 'en' },
    script.map((l) => h('p', { class: 'script-line' }, h('strong', { class: 'speaker' }, `${l.speaker}: `), highlight(l.text, needles))));
}

export function stimulusView(text, needles = []) {
  return h('div', { class: 'stimulus', lang: 'en' }, String(text).split(/\n+/).map((line) => h('p', null, highlight(line, needles))));
}

/**
 * 設問カード
 * opts.record(response) → Promise<{status, data}> サーバーへ解答を記録する処理
 * opts.last: 前回の解答（{correct, response}）
 * opts.onEvidence(evidence): 「本文で確認」ボタンの処理
 * opts.number: 表示番号
 * opts.noFeedback: 診断用（正誤を表示しない）
 */
export function questionCard(q, opts = {}) {
  const name = `q-${q.id}-${Math.random().toString(36).slice(2, 7)}`;
  let selected = null;
  const card = h('section', { class: 'qcard', id: `q-${q.id}`, 'aria-labelledby': `${name}-stem` });
  const feedback = h('div', { class: 'qfeedback', 'aria-live': 'polite' });
  const submitBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: true, onclick: () => submit() }, '解答する');
  let inputs = [];
  let textInput = null;

  const stem = h('p', { class: 'qstem', id: `${name}-stem`, lang: 'en' }, opts.number ? h('span', { class: 'qnum' }, `${opts.number}. `) : null, q.stem);
  let body;
  if (q.type === 'mcq') {
    body = h('fieldset', { class: 'options' }, h('legend', { class: 'sr-only' }, q.stem),
      q.options.map((o, i) => {
        const input = h('input', { type: 'radio', name, value: String(i), onchange: () => { selected = i; submitBtn.disabled = false; opts.onSelect?.(i); } });
        inputs.push(input);
        return h('label', { class: 'option', lang: 'en' }, input, h('span', { class: 'option-letter', 'aria-hidden': 'true' }, 'ABCDE'[i]), h('span', { class: 'option-text' }, o));
      }));
  } else {
    textInput = h('input', { type: 'text', class: 'text-answer', lang: 'en', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-labelledby': `${name}-stem`,
      oninput: () => { selected = textInput.value; submitBtn.disabled = !textInput.value.trim(); opts.onSelect?.(textInput.value); },
      onkeydown: (e) => { if (e.key === 'Enter' && textInput.value.trim()) { e.preventDefault(); submit(); } } });
    body = h('div', { class: 'text-answer-wrap' }, textInput);
  }
  replace(card, stem, body, opts.noFeedback ? null : submitBtn, feedback);

  function lock(v) { inputs.forEach((i) => { i.disabled = v; }); if (textInput) textInput.disabled = v; submitBtn.disabled = v; }

  async function submit() {
    if (selected == null || selected === '') return;
    lock(true);
    submitBtn.textContent = '送信中…';
    const response = selected;
    const localCorrect = gradeLocal(q, response);
    const r = await opts.record(response);
    submitBtn.hidden = true;
    if (r.status === 'error') {
      lock(false); submitBtn.hidden = false; submitBtn.textContent = '解答する';
      replace(feedback, h('p', { class: 'error-text' }, `保存できませんでした: ${r.error.message}`));
      return;
    }
    const correct = r.status === 'saved' ? r.data.correct : localCorrect;
    showFeedback(correct, response, r.status);
  }

  function showFeedback(correct, response, status) {
    card.classList.toggle('is-correct', correct); card.classList.toggle('is-wrong', !correct);
    inputs.forEach((inp, i) => {
      inp.disabled = true;
      if (i === response) inp.checked = true;
      const label = inp.closest('.option');
      label.classList.toggle('opt-correct', i === q.answer);
      label.classList.toggle('opt-wrong', i === response && i !== q.answer);
    });
    if (textInput) { textInput.value = response; textInput.disabled = true; }
    const answerText = q.type === 'mcq' ? `${'ABCDE'[q.answer]}. ${q.options[q.answer]}` : q.accept[0];
    replace(feedback,
      h('p', { class: `result ${correct ? 'result-ok' : 'result-ng'}` }, correct ? '○ 正解' : '× 不正解', correct ? '' : h('span', { class: 'result-answer', lang: 'en' }, `　正答: ${answerText}`)),
      status ? saveBadge(status) : null,
      h('div', { class: 'explanation' }, h('h4', null, '解説'), h('p', null, q.explanation)),
      q.evidence ? h('div', { class: 'evidence-box' }, h('h4', null, '根拠'), h('blockquote', { lang: 'en' }, q.evidence),
        opts.onEvidence ? h('button', { type: 'button', class: 'btn btn-small btn-secondary', onclick: () => opts.onEvidence(q.evidence) }, opts.evidenceLabel || '本文で確認する') : null) : null,
      opts.allowRetry !== false ? h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => reset() }, 'もう一度解く') : null);
    opts.onAnswered?.(correct, status);
  }

  function reset() {
    selected = null; card.classList.remove('is-correct', 'is-wrong');
    inputs.forEach((inp) => { inp.checked = false; inp.disabled = false; inp.closest('.option').classList.remove('opt-correct', 'opt-wrong'); });
    if (textInput) { textInput.value = ''; textInput.disabled = false; textInput.focus(); }
    submitBtn.hidden = false; submitBtn.disabled = true; submitBtn.textContent = '解答する';
    replace(feedback);
  }

  if (opts.last && !opts.noFeedback) showFeedback(opts.last.correct, opts.last.response, null);
  return { el: card, get value() { return selected; }, setValue(v) {
    if (q.type === 'mcq' && Number.isInteger(v) && inputs[v]) { inputs[v].checked = true; selected = v; submitBtn.disabled = false; }
    if (q.type === 'text' && typeof v === 'string' && textInput) { textInput.value = v; selected = v; }
  } };
}

/** 解答をサーバーに記録する（未送信時は端末に保存） */
export function recordAttempt({ q, context, response, support }) {
  const body = { clientId: uuid(), questionId: q.id, context, response, support: support || {} };
  return submitReliably('POST', '/api/attempts', body, `解答（${q.id}）`);
}

export function progressBar(value, max, label) {
  const pctv = max ? Math.round((value / max) * 100) : 0;
  return h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': value, 'aria-label': label || '進捗' },
    h('span', { style: { width: `${pctv}%` } }));
}

export function card(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h2', { class: 'card-title' }, title) : null, ...children);
}

export function emptyState(text) { return h('p', { class: 'muted empty' }, text); }

export function disclaimer() {
  return h('p', { class: 'disclaimer' },
    'このアプリはケンブリッジ英語検定に向けた自主教材です。Cambridge University Press & Assessment の公式製品ではなく、同機構とは関係ありません。診断結果・習熟度はアプリ独自の目安であり、Cambridge English Scale のスコアや合否を示すものではありません。');
}
