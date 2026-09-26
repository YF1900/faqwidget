// 単元の学習画面（step 1〜8）
import { h, replace, uuid, fmtDate, countWords, confirmDialog, toast, kindLabel, LEVEL_JA, SKILL_JA } from '../dom.js';
import { api, submitReliably } from '../api.js';
import { local, recordings } from '../local.js';
import { setTitle, onLeave, go, state } from '../main.js';
import { questionCard, recordAttempt, passageView, scriptView, stimulusView, saveBadge, disclaimer, progressBar } from '../components.js';
import { createPlayer, ttsSupported, speakButton, recorderSupported, startRecording, countdown } from '../media.js';

export default async function activityView({ params }) {
  const unitId = params.id; const stepNo = Number(params.step);
  const { unit, lastAttempts, rubrics } = await api.get(`/api/units/${encodeURIComponent(unitId)}`);
  const idx = unit.activities.findIndex((a) => a.step === stepNo);
  if (idx < 0) { go(`#/unit/${encodeURIComponent(unitId)}`); return null; }
  const act = unit.activities[idx];
  const prev = unit.activities[idx - 1]; const next = unit.activities[idx + 1];
  const unitHref = `#/unit/${encodeURIComponent(unitId)}`;
  const stepHref = (a) => `${unitHref}/step/${a.step}`;
  setTitle(`${kindLabel(unit.activities, act)}（${act.step}/${unit.activities.length}）`, { back: unitHref });

  const answered = new Set(Object.keys(lastAttempts).filter((id) => act.questions.some((q) => q.id === id)));
  const footerStatus = h('span', { class: 'footer-status small', 'aria-live': 'polite' });
  const nextBtn = h('button', { type: 'button', class: 'btn btn-primary' });
  const footer = h('nav', { class: 'step-footer', 'aria-label': 'ステップの移動' },
    h('button', { type: 'button', class: 'btn btn-secondary', disabled: !prev, onclick: () => prev && go(stepHref(prev)) }, '← 前へ'),
    footerStatus, nextBtn);

  async function complete() {
    if (act.completed) return true;
    const r = await submitReliably('POST', `/api/activities/${encodeURIComponent(act.id)}/complete`, { clientId: `complete:${act.id}:${uuid()}` }, `「${act.title}」の完了`);
    if (r.status === 'error') { toast(r.error.message, 'error'); return false; }
    if (r.status === 'queued') toast('完了の記録は未送信です（通信が回復したら再送します）', 'info');
    act.completed = r.status === 'saved';
    return true;
  }
  function updateFooter() {
    const qs = act.questions || [];
    const remaining = qs.filter((q) => !answered.has(q.id)).length;
    const needsSubmit = ['writing', 'speaking'].includes(act.kind);
    if (act.kind === 'wrapup') {
      nextBtn.textContent = next ? '次へ →' : '単元を完了する ✓';
      nextBtn.onclick = async () => { nextBtn.disabled = true; await complete(); go(next ? stepHref(next) : unitHref); };
    } else if (qs.length && remaining > 0) {
      footerStatus.textContent = `未解答 ${remaining}問`;
      nextBtn.textContent = 'あとで →';
      nextBtn.className = 'btn btn-secondary';
      nextBtn.onclick = () => go(next ? stepHref(next) : unitHref);
    } else if (needsSubmit && !act.completed) {
      footerStatus.textContent = '未提出';
      nextBtn.textContent = 'あとで →';
      nextBtn.className = 'btn btn-secondary';
      nextBtn.onclick = () => go(next ? stepHref(next) : unitHref);
    } else {
      footerStatus.textContent = qs.length ? '全問解答済み' : '';
      nextBtn.textContent = next ? '完了して次へ →' : '完了 ✓';
      nextBtn.className = 'btn btn-primary';
      nextBtn.onclick = async () => { nextBtn.disabled = true; if (await complete()) go(next ? stepHref(next) : unitHref); else nextBtn.disabled = false; };
    }
  }
  const markAnswered = (q) => { answered.add(q.id); updateFooter(); };

  // 設問の共通生成
  const supportKey = `support:${act.id}`;
  const support = () => local.get(supportKey, { scriptOpened: false, noAudio: false });
  const makeQuestion = (q, i, extra = {}) => questionCard(q, {
    number: i + 1, last: lastAttempts[q.id],
    record: (response) => recordAttempt({ q, context: 'unit', response, support: act.kind === 'listening' ? support() : {} }),
    onAnswered: () => markAnswered(q), ...extra,
  }).el;

  const header = h('div', { class: 'act-header' },
    h('p', { class: 'small muted' }, `${unit.titleJa}・${LEVEL_JA[unit.level]}・約${act.minutes || 8}分`),
    h('h2', { class: 'act-title' }, act.title),
    act.instructions ? h('p', { class: 'instructions' }, act.instructions) : null,
    // ステップ数が多いため、番号の列ではなく進捗バーで表示する（iPhone の幅に収めるため）
    h('div', { class: 'step-progress' },
      progressBar(unit.activities.filter((a) => a.completed).length, unit.activities.length, '単元の進捗'),
      h('span', { class: 'small muted' }, `step ${act.step} / ${unit.activities.length}・完了 ${unit.activities.filter((a) => a.completed).length}　`, h('a', { href: unitHref }, 'ステップ一覧'))));

  let body;
  const ctx = { unit, act, rubrics, makeQuestion, updateFooter, support, supportKey, lastAttempts };
  switch (act.kind) {
    case 'intro': body = introBody(ctx); break;
    case 'explain': body = explainBody(ctx); break;
    case 'reading': body = readingBody(ctx); break;
    case 'listening': body = listeningBody(ctx); break;
    case 'writing': body = await writingBody(ctx); break;
    case 'speaking': body = await speakingBody(ctx); break;
    case 'check': body = checkBody(ctx); break;
    default: body = await wrapupBody(ctx);
  }
  updateFooter();
  return h('div', { class: `activity kind-${act.kind}` }, header, body, h('div', { class: 'footer-spacer' }), footer);
}

// ---------- step 1: 目標と語彙 ----------
function introBody({ unit, act, makeQuestion }) {
  const first = unit.activities.find((a) => a.kind === 'intro')?.id === act.id;
  return h('div', { class: 'stack' },
    first ? h('section', { class: 'card' }, h('h3', { class: 'sub-title' }, 'この単元でできるようになること'), h('ul', null, unit.objectives.map((o) => h('li', null, o.text)))) : null,
    h('section', { class: 'card' }, h('h3', { class: 'sub-title' }, '重要語彙と表現'),
      h('ul', { class: 'vocab-list' }, act.vocabulary.map((v) => h('li', { class: 'vocab' },
        h('div', { class: 'vocab-head' }, h('strong', { lang: 'en' }, v.term), speakButton(v.term)),
        h('p', { class: 'vocab-meaning' }, v.meaning),
        v.example ? h('p', { class: 'vocab-example', lang: 'en' }, v.example) : null)))),
    h('a', { class: 'btn btn-secondary btn-block', href: `#/cards/${encodeURIComponent(unit.id)}` }, '🔤 この単元の単語帳で覚える・小テスト'),
    h('section', { class: 'stack' }, h('h3', { class: 'sub-title' }, '語彙チェック'), act.questions.map((q, i) => makeQuestion(q, i))));
}

// ---------- step 2: 解説 ----------
function explainBody({ unit, act, makeQuestion }) {
  return h('div', { class: 'stack' },
    act.points.map((p) => h('section', { class: 'card' }, h('h3', { class: 'sub-title' }, p.heading), h('p', null, p.text),
      p.examples?.length ? h('ul', { class: 'examples' }, p.examples.map((e) => h('li', { lang: 'en' }, e))) : null,
      p.patterns?.length ? h('div', { class: 'patterns' }, h('p', { class: 'small muted' }, '覚えたい構文'),
        p.patterns.map((pt) => h('div', { class: 'pattern' }, h('p', { class: 'pattern-en', lang: 'en' }, pt.pattern), h('p', { class: 'small' }, pt.meaning),
          pt.example ? h('p', { class: 'small', lang: 'en' }, pt.example) : null))) : null)),
    h('a', { class: 'btn btn-secondary btn-block', href: `#/cards/${encodeURIComponent(unit.id)}` }, '🔤 この単元の単語帳で覚える・小テスト'),
    h('section', { class: 'stack' }, h('h3', { class: 'sub-title' }, '確認'), act.questions.map((q, i) => makeQuestion(q, i))));
}

// ---------- step 3: Reading（本文と設問を切り替え。広い画面では横並び） ----------
function readingBody({ act, makeQuestion }) {
  const passageBox = h('div', { class: 'pane pane-passage', id: 'pane-passage', role: 'tabpanel' }, passageView(act.passage));
  const scrolls = { passage: 0, questions: 0 };
  let current = 'passage';
  const tabP = h('button', { type: 'button', role: 'tab', class: 'seg', 'aria-controls': 'pane-passage', onclick: () => switchTo('passage') }, '本文');
  const tabQ = h('button', { type: 'button', role: 'tab', class: 'seg', 'aria-controls': 'pane-questions', onclick: () => switchTo('questions') }, `設問（${act.questions.length}問）`);
  const qBox = h('div', { class: 'pane pane-questions stack', id: 'pane-questions', role: 'tabpanel' },
    act.questions.map((q, i) => makeQuestion(q, i, { onEvidence: (ev) => showEvidence(ev) })));
  const wrap = h('div', { class: 'split', 'data-show': 'passage' }, h('div', { class: 'seg-tabs', role: 'tablist', 'aria-label': '本文と設問の切り替え' }, tabP, tabQ), passageBox, qBox);
  function switchTo(which, { keepScroll = true } = {}) {
    scrolls[current] = window.scrollY;
    current = which;
    wrap.dataset.show = which;
    tabP.setAttribute('aria-selected', String(which === 'passage'));
    tabQ.setAttribute('aria-selected', String(which === 'questions'));
    if (keepScroll) window.scrollTo(0, scrolls[which]);
  }
  function showEvidence(ev) {
    replace(passageBox, h('div', { class: 'evidence-note' }, h('span', null, '根拠の部分を黄色で示しています。'),
      h('button', { type: 'button', class: 'btn btn-small btn-secondary', onclick: () => switchTo('questions') }, '設問に戻る')), passageView(act.passage, [ev]));
    switchTo('passage', { keepScroll: false });
    const mark = passageBox.querySelector('mark');
    if (mark) { mark.setAttribute('tabindex', '-1'); mark.scrollIntoView({ block: 'center' }); mark.focus({ preventScroll: true }); }
  }
  switchTo('passage');
  return wrap;
}

// ---------- step 4: Listening ----------
function listeningBody({ act, makeQuestion, support, supportKey }) {
  const scriptBox = h('div', { class: 'script-box' });
  const tts = ttsSupported();
  let player = null;
  const setSupport = (patch) => local.set(supportKey, { ...support(), ...patch });
  const renderScript = (needles = []) => replace(scriptBox,
    h('p', { class: 'notice small' }, support().noAudio ? '音声を使わずにスクリプトで学習しています（学習履歴に記録されます）。' : 'スクリプトを開きました。この後の解答は「スクリプトを見て解答」として記録されます。'),
    scriptView(act.script, needles));
  async function openScript({ needles = [], ask = true } = {}) {
    if (!support().scriptOpened && !support().noAudio && ask) {
      const ok = await confirmDialog('スクリプトを開くと、この課題の解答は「スクリプトを見て解答した」と記録されます（習熟度では半分の点数で数えます）。開きますか？', { ok: '開く' });
      if (!ok) return;
    }
    if (!support().noAudio) setSupport({ scriptOpened: true });
    renderScript(needles);
    scriptBtn.hidden = true;
    const mark = scriptBox.querySelector('mark');
    (mark || scriptBox).scrollIntoView({ block: 'center' });
  }
  const noAudio = (msg) => {
    setSupport({ noAudio: true });
    replace(audioArea, h('p', { class: 'notice' }, msg), h('p', null, 'スクリプトを読んで問題に答えてください。'));
    renderScript(); scriptBtn.hidden = true;
  };
  const scriptBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => openScript() }, '📄 スクリプトを見る');
  const audioArea = h('div');
  if (tts) {
    player = createPlayer(act.script, { onUnavailable: (msg) => noAudio(msg) });
    onLeave(() => player.stop());
    replace(audioArea, player.el, h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => noAudio('音声を使わずに学習します。') }, '音声が聞こえない・使えない場合'));
  } else {
    noAudio('この端末・ブラウザーでは音声の読み上げを利用できません。');
  }
  if (support().scriptOpened || support().noAudio) { renderScript(); scriptBtn.hidden = true; }
  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      act.setting ? h('p', { class: 'setting' }, `場面: ${act.setting}`) : null,
      audioArea,
      h('p', { class: 'small muted' }, '解答する前は、なるべくスクリプトを見ずに聞きましょう。音声の代わりにスクリプトで学ぶこともできます。'),
      scriptBtn, scriptBox),
    h('section', { class: 'stack' }, act.questions.map((q, i) => makeQuestion(q, i, { evidenceLabel: 'スクリプトで確認する', onEvidence: (ev) => openScript({ needles: [ev], ask: true }) }))));
}

// ---------- step 7: 試験形式の確認 ----------
function checkBody({ act, makeQuestion }) {
  const shown = new Set();
  const items = [];
  act.questions.forEach((q, i) => {
    if (q.stimulus && act.stimuli?.[q.stimulus] && !shown.has(q.stimulus)) {
      shown.add(q.stimulus);
      items.push(h('section', { class: 'card stimulus-card' }, h('p', { class: 'small muted' }, '次の英文を読んで答えましょう'), stimulusView(act.stimuli[q.stimulus])));
    }
    items.push(makeQuestion(q, i, q.stimulus ? { onEvidence: (ev) => {
      const box = document.createElement('div');
      box.appendChild(stimulusView(act.stimuli[q.stimulus], [ev]));
      confirmDialog(box.textContent.length > 600 ? box.textContent.slice(0, 600) + '…' : box.textContent, { ok: '閉じる', cancel: '戻る' });
    }, evidenceLabel: '英文を確認する' } : {}));
  });
  return h('div', { class: 'stack' }, act.examNote ? h('p', { class: 'notice small' }, act.examNote) : null, items);
}

// ---------- 自己評価（Writing・Speaking 共通） ----------
function selfAssessment(act, rubric, initial = {}) {
  const checks = (act.task.selfCheck || []).map((text, i) => ({ i, input: h('input', { type: 'checkbox', checked: (initial.selfCheck || []).includes(i) }), text }));
  const scores = {};
  const groups = (rubric?.criteria || []).map((c) => {
    const name = `self-${act.id}-${c.key}`;
    return h('fieldset', { class: 'score-group' }, h('legend', null, c.label),
      h('div', { class: 'score-buttons' }, [1, 2, 3, 4, 5].map((v) => h('label', { class: 'score' },
        h('input', { type: 'radio', name, value: String(v), checked: initial.selfScores?.[c.key] === v, onchange: () => { scores[c.key] = v; } }), h('span', null, String(v))))),
      h('details', { class: 'small' }, h('summary', null, '基準を見る'), h('ul', null, Object.entries(c.descriptors).map(([k, d]) => h('li', null, `${k}点: ${d}`)))));
  });
  Object.assign(scores, initial.selfScores || {});
  const el = h('section', { class: 'card' },
    h('h3', { class: 'sub-title' }, '自己点検'),
    h('div', { class: 'choices' }, checks.map((c) => h('label', { class: 'check' }, c.input, h('span', null, c.text)))),
    rubric ? h('h3', { class: 'sub-title' }, '自己評価（1〜5・任意）') : null,
    rubric ? h('p', { class: 'small muted' }, '先生の評価とは別に記録されます。') : null,
    groups);
  return { el, value: () => ({ selfCheck: checks.filter((c) => c.input.checked).map((c) => c.i), selfScores: { ...scores } }) };
}

function rubricView(rubric) {
  if (!rubric) return null;
  return h('details', { class: 'card' }, h('summary', null, `評価の観点（${rubric.title}）`),
    rubric.criteria.map((c) => h('div', { class: 'rubric-row' }, h('strong', null, c.label),
      h('ul', { class: 'small' }, Object.entries(c.descriptors).map(([k, d]) => h('li', null, `${k}点: ${d}`))))));
}

function submissionsView(subs, rubric) {
  if (!subs.length) return null;
  const label = (k) => rubric?.criteria.find((c) => c.key === k)?.label || k;
  return h('section', { class: 'card' }, h('h3', { class: 'sub-title' }, '提出履歴と先生の評価'),
    subs.map((s) => h('div', { class: 'submission' },
      h('p', { class: 'small muted' }, `${s.revision > 1 ? `再提出（${s.revision}回目）` : '1回目の提出'}・${fmtDate(s.createdAt)}${s.kind === 'writing' ? `・${s.wordCount}語` : ''}${s.recordedLocally ? '・録音あり（端末内）' : ''}`),
      s.text ? h('p', { class: 'submission-text', lang: 'en' }, s.text) : null,
      s.feedback.length ? s.feedback.map((f) => h('div', { class: 'feedback' },
        h('p', null, h('strong', null, '先生の評価'), h('span', { class: 'small muted' }, `（${f.author || '先生'}・${fmtDate(f.createdAt)}）`)),
        h('ul', { class: 'small' }, Object.entries(f.scores).map(([k, v]) => h('li', null, `${label(k)}: ${v} / 5`))),
        f.comment ? h('p', { class: 'feedback-comment' }, f.comment) : null))
        : h('p', { class: 'small muted' }, '先生の評価はまだありません。'))));
}

// ---------- step 5: Writing ----------
async function writingBody({ act, rubrics, updateFooter }) {
  const task = act.task;
  const rubric = rubrics.find((r) => r.id === act.rubricId);
  const draftKey = `draft:${act.id}`;
  let subs = [];
  try { subs = (await api.get(`/api/submissions?activityId=${encodeURIComponent(act.id)}`)).submissions; } catch { /* 通信できない場合も書ける */ }
  let serverDraft = null;
  try { serverDraft = await api.get(`/api/drafts/${encodeURIComponent(act.id)}`); } catch { /* 端末の下書きを使う */ }
  const localDraft = local.get(draftKey);
  let restoredMsg = '';
  let text = '';
  if (localDraft && (!serverDraft || localDraft.updatedAt >= serverDraft.updatedAt)) { text = localDraft.text; if (text) restoredMsg = `この端末に保存した下書きを復元しました（${fmtDate(localDraft.updatedAt)}）`; }
  else if (serverDraft) { text = serverDraft.text; if (text) restoredMsg = `保存済みの下書きを復元しました（${fmtDate(serverDraft.updatedAt)}）`; }

  const status = h('p', { class: 'draft-status small', 'aria-live': 'polite' }, restoredMsg);
  const count = h('span', { class: 'word-count' });
  const ta = h('textarea', { id: `ta-${act.id}`, rows: 9, lang: 'en', autocapitalize: 'sentences', autocorrect: 'off', spellcheck: 'false', value: text });
  const updateCount = () => {
    const n = countWords(ta.value);
    count.textContent = `${n} 語（目安 ${task.minWords}〜${task.maxWords} 語）`;
    count.className = `word-count ${n < task.minWords ? 'under' : n > task.maxWords ? 'over' : 'ok'}`;
  };
  updateCount();
  let serverTimer = null; let localTimer = null;
  const saveLocal = () => { const at = new Date().toISOString(); const ok = local.set(draftKey, { text: ta.value, updatedAt: at }); return ok ? at : null; };
  const saveServer = async ({ keepalive = false } = {}) => {
    const at = local.get(draftKey)?.updatedAt || new Date().toISOString();
    try {
      if (keepalive) {
        fetch(`/api/drafts/${encodeURIComponent(act.id)}`, { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ text: ta.value, updatedAt: at }) }).catch(() => {});
        return;
      }
      await api.put(`/api/drafts/${encodeURIComponent(act.id)}`, { text: ta.value, updatedAt: at });
      status.textContent = `下書きをサーバーに保存しました（${fmtDate(new Date().toISOString())}）`;
    } catch {
      status.textContent = '通信できないため、下書きはこの端末にだけ保存されています。';
    }
  };
  ta.addEventListener('input', () => {
    updateCount();
    clearTimeout(localTimer); clearTimeout(serverTimer);
    localTimer = setTimeout(() => { status.textContent = saveLocal() ? 'この端末に一時保存しました' : 'この端末には保存できません（プライベートブラウズなど）'; }, 400);
    serverTimer = setTimeout(() => saveServer(), 3000);
  });
  // 別のアプリに切り替えたとき・画面を閉じるときにすぐ保存
  const onHide = () => { if (document.visibilityState === 'hidden') { clearTimeout(localTimer); saveLocal(); saveServer({ keepalive: true }); } };
  const onPageHide = () => { saveLocal(); saveServer({ keepalive: true }); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  onLeave(() => {
    document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onPageHide);
    clearTimeout(localTimer); clearTimeout(serverTimer);
    if (!submitted) { saveLocal(); saveServer({ keepalive: true }); }
  });

  let submitted = false;
  const self = selfAssessment(act, rubric);
  const submitStatus = h('div', { 'aria-live': 'polite' });
  const model = h('details', { class: 'card', hidden: !subs.length }, h('summary', null, '模範解答を見る'), h('p', { lang: 'en', class: 'model' }, task.modelAnswer));
  const historyBox = h('div', null, submissionsView(subs, rubric));
  const submitBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: async () => {
    const n = countWords(ta.value);
    if (!ta.value.trim()) { replace(submitStatus, h('p', { class: 'error-text' }, '文章を書いてから提出してください。')); return; }
    if (n < task.minWords && !(await confirmDialog(`語数が目安（${task.minWords}語以上）より少ない ${n} 語です。このまま提出しますか？`, { ok: '提出する' }))) return;
    submitBtn.disabled = true;
    replace(submitStatus, saveBadge('sending'));
    saveLocal();
    const body = { clientId: uuid(), activityId: act.id, text: ta.value, ...self.value() };
    const r = await submitReliably('POST', '/api/submissions', body, `Writing「${act.title}」の提出`);
    if (r.status === 'saved') {
      submitted = true; local.remove(draftKey);
      act.completed = true;
      subs = [r.data, ...subs];
      replace(submitStatus, saveBadge('saved', `（${r.data.revision}回目の提出・${r.data.wordCount}語）`), h('p', { class: 'small' }, '先生の評価が届くと、この画面とホームに表示されます。書き直して再提出することもできます。'));
      replace(historyBox, submissionsView(subs, rubric));
      model.hidden = false;
      submitBtn.textContent = '書き直して再提出する';
      submitBtn.disabled = false;
      updateFooter();
    } else if (r.status === 'queued') {
      submitted = true; local.remove(draftKey);
      replace(submitStatus, saveBadge('queued'), h('p', { class: 'small' }, 'まだ提出は完了していません。通信が回復すると自動で送信します（画面上部の「再送する」でも送れます）。'));
      submitBtn.textContent = '送信待ち'; // 二重提出を防ぐため無効のまま
    } else {
      replace(submitStatus, h('p', { class: 'error-text' }, r.error.message)); submitBtn.disabled = false;
    }
  } }, subs.length ? '書き直して再提出する' : '提出する');

  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('p', { class: 'prompt-en', lang: 'en' }, task.promptEn),
      h('p', { class: 'small' }, task.promptJa),
      h('h3', { class: 'sub-title' }, '書く内容'), h('ul', null, task.points.map((p) => h('li', null, p))),
      h('p', { class: 'small' }, `語数の目安: ${task.minWords}〜${task.maxWords} 語`),
      task.usefulLanguage?.length ? h('details', null, h('summary', null, '使える表現'), h('ul', null, task.usefulLanguage.map((u) => h('li', { lang: 'en' }, u)))) : null),
    rubricView(rubric),
    h('section', { class: 'card writing-editor' },
      h('label', { for: ta.id, class: 'sub-title' }, 'あなたの回答（英語）'), ta, h('div', { class: 'editor-meta' }, count), status,
      h('p', { class: 'small muted' }, '入力中の文章は自動で下書き保存されます。別のアプリに切り替えても、戻ってくると復元されます。')),
    self.el,
    h('section', { class: 'card' }, submitBtn, submitStatus),
    model, historyBox);
}

// ---------- step 6: Speaking ----------
async function speakingBody({ act, rubrics, updateFooter }) {
  const task = act.task;
  const rubric = rubrics.find((r) => r.id === act.rubricId);
  let subs = [];
  try { subs = (await api.get(`/api/submissions?activityId=${encodeURIComponent(act.id)}`)).submissions; } catch { /* 通信できなくても練習できる */ }
  const memoKey = `memo:${act.id}`;
  const memos = local.get(memoKey, {});
  const canRecord = recorderSupported();
  let mode = local.get('speaking-mode', null); // 'record' | 'norecord'
  if (!canRecord) mode = 'norecord';
  let recordedAny = false;
  const active = { timer: null, rec: null };
  onLeave(() => { active.timer?.stop(); active.rec?.cancel(); window.speechSynthesis?.cancel?.(); });

  const modeBox = h('section', { class: 'card' });
  function renderMode() {
    if (!canRecord) {
      replace(modeBox, h('h3', { class: 'sub-title' }, '録音について'),
        h('p', null, 'この端末・ブラウザーでは録音機能を使えません（HTTPS で接続していない場合も使えません）。声に出して練習し、自己評価で記録しましょう。'));
      return;
    }
    replace(modeBox, h('h3', { class: 'sub-title' }, '録音について'),
      h('p', null, '録音すると、自分の答え方を聞き直してふり返ることができます。'),
      h('ul', { class: 'small' },
        h('li', null, '録音には iPhone のマイクの使用許可が必要です。「録音して練習する」を押すと、許可を求める画面が表示されます。'),
        h('li', null, '録音はこの端末の中だけに保存され、サーバーや先生には送信されません。いつでも削除できます。'),
        h('li', null, '許可しなくても、録音なしで練習を最後まで続けられます。')),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: `btn ${mode === 'record' ? 'btn-primary' : 'btn-secondary'}`, 'aria-pressed': String(mode === 'record'), onclick: async () => {
          // ここで初めてマイクの許可を求める
          try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            s.getTracks().forEach((t) => t.stop());
            mode = 'record'; local.set('speaking-mode', mode); renderMode(); renderParts();
          } catch {
            mode = 'norecord'; local.set('speaking-mode', mode);
            renderMode(); renderParts();
            replace(modeBox.querySelector('.mode-msg') || modeBox.appendChild(h('p', { class: 'mode-msg' })), h('span', { class: 'error-text' }, 'マイクの使用が許可されなかったため、録音なしで練習します。設定アプリ → Safari → マイク から変更できます。'));
          }
        } }, '🎙 録音して練習する'),
        h('button', { type: 'button', class: `btn ${mode === 'norecord' ? 'btn-primary' : 'btn-secondary'}`, 'aria-pressed': String(mode === 'norecord'), onclick: () => { mode = 'norecord'; local.set('speaking-mode', mode); renderMode(); renderParts(); } }, '録音しないで練習する')),
      h('p', { class: 'mode-msg' }));
  }

  const partsBox = h('div', { class: 'stack' });
  function renderParts() { replace(partsBox, task.parts.map((p, i) => partCard(p, i))); }

  function partCard(p, i) {
    const recKey = `rec:${act.id}:${i}`;
    const stage = h('div', { class: 'speak-stage', 'aria-live': 'polite' });
    const audioBox = h('div', { class: 'rec-box' });
    const memo = h('textarea', { rows: 3, lang: 'en', placeholder: '話した内容のメモ（任意・英語）', 'aria-label': `質問${i + 1}で話した内容のメモ`, value: memos[i] || '',
      oninput: () => { memos[i] = memo.value; local.set(memoKey, memos); } });

    async function showRecording() {
      const r = await recordings.get(recKey);
      if (!r?.blob) { replace(audioBox); return; }
      recordedAny = true;
      const url = URL.createObjectURL(r.blob);
      onLeave(() => URL.revokeObjectURL(url));
      replace(audioBox, h('p', { class: 'small muted' }, `録音（この端末のみに保存・${fmtDate(r.savedAt)}${r.interrupted ? '・途中で中断' : ''}）`),
        h('audio', { controls: true, src: url, preload: 'metadata' }),
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: async () => { await recordings.remove(recKey); replace(audioBox, h('p', { class: 'small muted' }, '録音を削除しました。')); } }, '録音を削除'));
    }
    function idle() {
      replace(stage, h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: prep }, `準備を始める（${p.prepSeconds}秒）`));
    }
    function prep() {
      active.timer?.stop();
      const t = countdown(p.prepSeconds, { label: '準備', onEnd: answer });
      active.timer = t;
      replace(stage, t.el, h('p', { class: 'small' }, '話す内容を考えましょう。ヒントを見てもかまいません。'),
        h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => { t.stop(); answer(); } }, '準備を終えて話す'));
      t.start();
    }
    async function answer() {
      active.timer?.stop();
      const t = countdown(p.answerSeconds, { label: mode === 'record' ? '録音中' : '話す', onEnd: finish });
      active.timer = t;
      const doneBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: finish }, '話し終えた');
      replace(stage, t.el, h('p', { class: 'small' }, mode === 'record' ? '英語で答えましょう（録音しています）。' : '声に出して英語で答えましょう。'), doneBtn);
      if (mode === 'record') {
        active.rec = await startRecording({
          maxSeconds: p.answerSeconds + 30,
          onDone: async (blob, { interrupted }) => {
            active.rec = null;
            if (blob) { try { await recordings.save(recKey, blob, { interrupted }); } catch { toast('録音を端末に保存できませんでした', 'error'); } }
            if (interrupted) toast('録音が中断されました。もう一度録音するか、録音なしで続けてください。', 'info');
            showRecording();
          },
          onError: (msg) => { mode = 'norecord'; local.set('speaking-mode', mode); toast(msg, 'error'); renderMode(); },
        });
      }
      t.start();
    }
    function finish() {
      active.timer?.stop();
      active.rec?.stop();
      replace(stage, h('p', { class: 'small' }, 'おつかれさまでした。メモを残したり、もう一度練習したりできます。'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: prep }, 'もう一度練習する'));
    }
    idle(); showRecording();
    return h('section', { class: 'card speak-part' },
      h('p', { class: 'small muted' }, `質問 ${i + 1} / ${task.parts.length}・準備 ${p.prepSeconds}秒・回答 ${p.answerSeconds}秒`),
      h('p', { class: 'prompt-en', lang: 'en' }, p.question), speakButton(p.question, '🔊 質問を聞く'),
      p.questionJa ? h('details', { class: 'small' }, h('summary', null, '日本語訳'), h('p', null, p.questionJa)) : null,
      p.hints?.length ? h('details', { class: 'small' }, h('summary', null, 'ヒント'), h('ul', null, p.hints.map((x) => h('li', { lang: 'en' }, x)))) : null,
      stage, audioBox, memo);
  }

  renderMode(); renderParts();
  const self = selfAssessment(act, rubric);
  const submitStatus = h('div', { 'aria-live': 'polite' });
  const historyBox = h('div', null, submissionsView(subs, rubric));
  const model = h('details', { class: 'card', hidden: !subs.length }, h('summary', null, '回答例を見る'), h('p', { lang: 'en', class: 'model' }, task.modelAnswer));
  const submitBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: async () => {
    submitBtn.disabled = true; replace(submitStatus, saveBadge('sending'));
    const text = task.parts.map((p, i) => (memos[i] ? `Q${i + 1}: ${memos[i]}` : '')).filter(Boolean).join('\n');
    let rec = false;
    for (let i = 0; i < task.parts.length; i++) if (await recordings.get(`rec:${act.id}:${i}`)) rec = true;
    const r = await submitReliably('POST', '/api/submissions', { clientId: uuid(), activityId: act.id, text, recordedLocally: rec || recordedAny, ...self.value() }, `Speaking「${act.title}」の記録`);
    if (r.status === 'saved') {
      act.completed = true; subs = [r.data, ...subs];
      replace(submitStatus, saveBadge('saved'), h('p', { class: 'small' }, '練習の記録を保存しました。録音は端末内にだけ残っています。'));
      replace(historyBox, submissionsView(subs, rubric)); model.hidden = false;
      submitBtn.textContent = 'もう一度記録する'; submitBtn.disabled = false; updateFooter();
    } else if (r.status === 'queued') {
      replace(submitStatus, saveBadge('queued'));
      submitBtn.textContent = '送信待ち';
    } else { replace(submitStatus, h('p', { class: 'error-text' }, r.error.message)); submitBtn.disabled = false; }
  } }, subs.length ? 'もう一度記録する' : '練習を記録する');

  return h('div', { class: 'stack' },
    h('section', { class: 'card' }, h('p', null, task.introJa),
      task.usefulLanguage?.length ? h('details', null, h('summary', null, '使える表現'), h('ul', null, task.usefulLanguage.map((u) => h('li', { lang: 'en' }, u)))) : null),
    modeBox, partsBox, rubricView(rubric), self.el,
    h('section', { class: 'card' }, h('p', { class: 'small muted' }, 'メモと自己評価を保存します（録音は送信されません）。先生はメモと自己評価を見て、授業での様子とあわせて評価します。'), submitBtn, submitStatus),
    model, historyBox);
}

// ---------- step 8: ふり返り ----------
async function wrapupBody({ unit, act, lastAttempts }) {
  let units = [];
  try { units = (await api.get('/api/units')).units; } catch { /* 表示は続ける */ }
  const rows = unit.activities.filter((a) => a.questions?.length).map((a) => {
    const ans = a.questions.filter((q) => lastAttempts[q.id]);
    const ok = ans.filter((q) => lastAttempts[q.id].correct).length;
    const sup = ans.filter((q) => lastAttempts[q.id].support?.scriptOpened || lastAttempts[q.id].support?.noAudio).length;
    return h('tr', null, h('th', { scope: 'row' }, kindLabel(unit.activities, a)), h('td', null, `${ok} / ${a.questions.length}`), h('td', { class: 'small' }, ans.length < a.questions.length ? `未解答 ${a.questions.length - ans.length}` : sup ? `スクリプト使用 ${sup}` : ''));
  });
  const levels = ['A2', 'B1', 'B2'];
  const up = units.find((u) => u.theme === unit.theme && u.order === unit.order && u.level === levels[levels.indexOf(unit.level) + 1]);
  const down = units.find((u) => u.theme === unit.theme && u.order === unit.order && u.level === levels[levels.indexOf(unit.level) - 1]);
  const writing = unit.activities.find((a) => a.kind === 'writing'); const speaking = unit.activities.find((a) => a.kind === 'speaking');
  return h('div', { class: 'stack' },
    h('section', { class: 'card' }, h('h3', { class: 'sub-title' }, 'この単元の結果（最新の解答）'),
      h('table', { class: 'result-table' }, h('thead', null, h('tr', null, h('th', null, 'ステップ'), h('th', null, '正解'), h('th', null, 'メモ'))), h('tbody', null, rows)),
      h('p', { class: 'small' }, `Writing: ${writing?.completed ? '提出済み' : '未提出'}　Speaking: ${speaking?.completed ? '記録済み' : '未記録'}`),
      h('p', { class: 'small muted' }, '間違えた問題とスクリプトを見て解いた問題は、自動で「復習」に入ります。')),
    h('section', { class: 'card' }, h('h3', { class: 'sub-title' }, 'ポイントのまとめ'), h('ul', null, act.summary.map((s) => h('li', null, s)))),
    act.commonMistakes?.length ? h('section', { class: 'card' }, h('h3', { class: 'sub-title' }, 'よくある間違い'),
      act.commonMistakes.map((m) => h('div', { class: 'mistake' }, h('p', { lang: 'en', class: 'wrong' }, `✗ ${m.wrong}`), h('p', { lang: 'en', class: 'right' }, `✓ ${m.right}`), h('p', { class: 'small' }, m.note)))) : null,
    h('section', { class: 'card' }, h('h3', { class: 'sub-title' }, '次の学習'),
      act.next?.text ? h('p', null, act.next.text) : null,
      act.next?.challenge ? h('p', { class: 'small' }, `挑戦したい人: ${act.next.challenge}`) : null,
      act.next?.support ? h('p', { class: 'small' }, `難しかった人: ${act.next.support}`) : null,
      h('div', { class: 'btn-col' },
        h('a', { class: 'btn btn-secondary btn-block', href: '#/review' }, '復習する'),
        up ? h('a', { class: 'btn btn-secondary btn-block', href: `#/unit/${encodeURIComponent(up.id)}` }, `同じテーマの ${LEVEL_JA[up.level]} に挑戦`) : null,
        down ? h('a', { class: 'btn btn-ghost btn-block', href: `#/unit/${encodeURIComponent(down.id)}` }, `${LEVEL_JA[down.level]} で基礎を確認`) : null,
        h('a', { class: 'btn btn-ghost btn-block', href: '#/home' }, 'ホームへ'))),
    h('p', { class: 'small muted' }, `${state.me.user.displayName} さんの ${SKILL_JA.reading}〜${SKILL_JA.speaking} の状況はホームで確認できます。`),
    disclaimer());
}
