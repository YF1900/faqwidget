// 4技能の診断
import { h, replace, uuid, LEVEL_JA, EXAM_JA, SKILL_JA, SKILL_ICON, countWords } from '../dom.js';
import { api, submitReliably } from '../api.js';
import { local } from '../local.js';
import { setTitle, onLeave, go, refreshMe, state } from '../main.js';
import { questionCard, passageView, scriptView, disclaimer, saveBadge } from '../components.js';
import { createPlayer, ttsSupported } from '../media.js';

const PAGES = ['intro', 'r-A2', 'r-B1', 'r-B2', 'l-A2', 'l-B1', 'l-B2', 'w', 's', 'confirm'];
const PAGE_LABEL = { intro: 'はじめに', r: 'Reading', l: 'Listening', w: 'Writing', s: 'Speaking', confirm: '確認' };

export default async function diagnosticView({ root }) {
  setTitle('4技能の診断', { back: '#/home' });
  const d = await api.get('/api/diagnostic');
  const saved = local.get('diag-progress');
  const st = saved && saved.id === d.id ? saved : {
    id: d.id, page: 0, clientId: uuid(), reading: { answers: {} }, listening: { answers: {}, scriptOpened: false, noAudio: false }, writing: { text: '', canDo: [] }, speaking: { canDo: [] },
  };
  const persist = () => local.set('diag-progress', st);
  let player = null;
  onLeave(() => { player?.stop(); persist(); });
  const view = h('div', { class: 'stack' });
  const footer = h('nav', { class: 'step-footer', 'aria-label': '診断の移動' });

  function show() {
    player?.stop(); player = null;
    const key = PAGES[st.page];
    const [kind, level] = key.split('-');
    const bar = h('div', { class: 'diag-progress' }, h('span', { class: 'small muted' }, `${PAGE_LABEL[kind]}${level ? ` ${level}` : ''}（${st.page + 1} / ${PAGES.length}）`),
      h('div', { class: 'progress' }, h('span', { style: { width: `${((st.page + 1) / PAGES.length) * 100}%` } })));
    let body;
    if (kind === 'intro') body = introPage();
    else if (kind === 'r') body = readingPage(level);
    else if (kind === 'l') body = listeningPage(level);
    else if (kind === 'w') body = writingPage();
    else if (kind === 's') body = speakingPage();
    else body = confirmPage();
    replace(view, bar, body);
    replace(footer,
      h('button', { type: 'button', class: 'btn btn-secondary', disabled: st.page === 0, onclick: () => { st.page--; persist(); show(); window.scrollTo(0, 0); } }, '← 戻る'),
      kind === 'confirm' ? null : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { st.page++; persist(); show(); window.scrollTo(0, 0); } }, '次へ →'));
  }

  function introPage() {
    return h('div', { class: 'card' },
      h('h2', { class: 'card-title' }, '診断のすすめ方（約20分）'),
      h('ul', null,
        h('li', null, 'Reading と Listening は A2 → B1 → B2 の順に、各3問ずつ答えます（自動採点）。'),
        h('li', null, 'Writing と Speaking は、短い練習のあと「できること」を自分で選びます（自己評価）。'),
        h('li', null, 'わからない問題は、答えずに次へ進んでもかまいません。'),
        h('li', null, '途中でやめても、この端末に回答が一時保存されます。')),
      h('p', { class: 'notice' }, 'この診断は、教材のレベルを選ぶための目安です。公式のスコアや合否の予測ではありません。'),
      ttsSupported() ? h('p', { class: 'small' }, '🎧 Listening では音声が流れます。イヤホンの使用や、マナーモードの解除をおすすめします。')
        : h('p', { class: 'notice' }, 'この端末では音声の読み上げが使えないため、Listening はスクリプトを読んで答えます（結果には「音声なし」と記録されます）。'));
  }

  function qCards(section, skill) {
    return section.questions.map((q, i) => {
      const c = questionCard(q, { number: i + 1, noFeedback: true, onSelect: (v) => { st[skill].answers[q.id] = v; persist(); } });
      if (st[skill].answers[q.id] != null) c.setValue(st[skill].answers[q.id]);
      return c.el;
    });
  }

  function readingPage(level) {
    const s = d.reading.sections.find((x) => x.level === level);
    return h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('p', { class: 'small muted' }, `Reading ${LEVEL_JA[level]}`), h('p', null, d.reading.instructions), passageView(s.passage)),
      ...qCards(s, 'reading'));
  }

  function listeningPage(level) {
    const s = d.listening.sections.find((x) => x.level === level);
    const scriptBox = h('div');
    const showScript = (reason) => {
      if (reason === 'noAudio') st.listening.noAudio = true; else st.listening.scriptOpened = true;
      persist();
      replace(scriptBox, h('p', { class: 'notice' }, reason === 'noAudio' ? '音声が使えないため、スクリプトで解答します（記録されます）。' : 'スクリプトを開きました（支援を受けて解答したことが記録されます）。'), scriptView(s.script));
    };
    const avail = ttsSupported();
    if (avail) player = createPlayer(s.script, { onUnavailable: () => showScript('noAudio') });
    return h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('p', { class: 'small muted' }, `Listening ${LEVEL_JA[level]}`), h('p', null, d.listening.instructions), h('p', { class: 'setting' }, s.setting),
        avail ? player.el : null,
        h('details', { class: 'script-toggle', ontoggle: (e) => { if (e.target.open && !scriptBox.firstChild) showScript(avail ? 'opened' : 'noAudio'); } },
          h('summary', null, avail ? 'スクリプトを見る（支援として記録されます）' : 'スクリプトを読む（音声が使えません）'), scriptBox)),
      ...qCards(s, 'listening'));
  }

  function canDoList(skill) {
    return h('fieldset', { class: 'choices' }, h('legend', null, 'できると思うものをすべて選んでください'),
      d[skill].canDo.map((c) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: st[skill].canDo.includes(c.id), onchange: (e) => {
          st[skill].canDo = e.target.checked ? [...new Set([...st[skill].canDo, c.id])] : st[skill].canDo.filter((x) => x !== c.id); persist();
        } }), h('span', null, c.text))));
  }

  function writingPage() {
    const count = h('span', { class: 'word-count' }, `${countWords(st.writing.text)} 語`);
    const ta = h('textarea', { id: 'diag-writing', rows: 7, lang: 'en', autocapitalize: 'sentences', spellcheck: 'false', value: st.writing.text,
      oninput: () => { st.writing.text = ta.value; count.textContent = `${countWords(ta.value)} 語`; persist(); } });
    return h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('p', null, d.writing.instructions),
        h('p', { class: 'prompt-en', lang: 'en' }, d.writing.promptEn), h('p', { class: 'small muted' }, d.writing.promptJa),
        h('div', { class: 'field' }, h('label', { for: 'diag-writing' }, `英語で書いてみましょう（目安 ${d.writing.suggestedMinutes} 分・任意）`), ta, count),
        h('p', { class: 'hint' }, '書いた文章は先生が参考にできるよう保存されます。自動採点はしません。')),
      h('div', { class: 'card' }, canDoList('writing')));
  }

  function speakingPage() {
    return h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('p', null, d.speaking.instructions),
        h('p', { class: 'prompt-en', lang: 'en' }, d.speaking.practiceQuestion),
        h('p', { class: 'small muted' }, '声に出して30秒〜1分ほど答えてみてから、下の項目を選んでください。この画面では録音しません。')),
      h('div', { class: 'card' }, canDoList('speaking')));
  }

  function confirmPage() {
    const answered = (skill, sections) => sections.reduce((n, s) => n + s.questions.filter((q) => st[skill].answers[q.id] != null).length, 0);
    const status = h('div', { 'aria-live': 'polite' });
    const btn = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: async () => {
      btn.disabled = true; replace(status, saveBadge('sending'));
      const body = { clientId: st.clientId, reading: st.reading, listening: st.listening, writing: st.writing, speaking: st.speaking };
      const r = await submitReliably('POST', '/api/diagnostic', body, '診断の回答');
      if (r.status === 'saved') {
        local.remove('diag-progress');
        local.set('diag-result', r.data);
        await refreshMe();
        replace(view, resultView(r.data)); replace(footer); window.scrollTo(0, 0);
      } else if (r.status === 'queued') {
        replace(status, saveBadge('queued'), h('p', null, '通信できないため、まだ採点されていません。回答はこの端末に保存されています。通信が回復したら画面上部の「再送する」を押してから、もう一度この画面を開いてください。'));
        btn.disabled = false;
      } else { replace(status, h('p', { class: 'error-text' }, r.error.message)); btn.disabled = false; }
    } }, '回答を送信して結果を見る');
    return h('div', { class: 'card' }, h('h2', { class: 'card-title' }, '回答の確認'),
      h('ul', null,
        h('li', null, `Reading: ${answered('reading', d.reading.sections)} / 9 問に解答`),
        h('li', null, `Listening: ${answered('listening', d.listening.sections)} / 9 問に解答${st.listening.scriptOpened ? '（スクリプト使用）' : ''}${st.listening.noAudio ? '（音声なし）' : ''}`),
        h('li', null, `Writing: ${countWords(st.writing.text)} 語、できること ${st.writing.canDo.length} 項目`),
        h('li', null, `Speaking: できること ${st.speaking.canDo.length} 項目`)),
      btn, status);
  }

  show();
  return h('div', null, view, footer);
}

export function resultView(r) {
  const methodJa = { auto: '自動採点', self: '自己評価', teacher: '教員評価' };
  const skillCard = (skill) => {
    const s = r.skills[skill];
    const detail = s.method === 'auto'
      ? `正解数: A2 ${s.correct.A2}/3・B1 ${s.correct.B1}/3・B2 ${s.correct.B2}/3${s.scriptOpened ? '（スクリプトを見て解答）' : ''}${s.noAudio ? '（音声なしで解答）' : ''}`
      : `「できる」を選んだ数: A2 ${s.canDoCount.A2}/3・B1 ${s.canDoCount.B1}/3・B2 ${s.canDoCount.B2}/3`;
    return h('div', { class: 'skill-result' },
      h('p', { class: 'skill-name' }, `${SKILL_ICON[skill]} ${SKILL_JA[skill]}`),
      h('p', { class: 'skill-level' }, LEVEL_JA[s.level], s.foundation ? h('span', { class: 'tag' }, '中学英語の復習から') : null),
      h('p', { class: 'small muted' }, `${methodJa[s.method]}: ${detail}`));
  };
  const target = state.me?.target?.exam;
  return h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('h2', { class: 'card-title' }, '診断の結果（教材を選ぶための目安）'),
      h('p', { class: 'notice' }, 'これはアプリ独自の目安です。Cambridge English Scale のスコアや、試験の合否の予測ではありません。技能ごとに、このレベルの教材から始めることを提案します。'),
      h('div', { class: 'skill-grid' }, ['reading', 'listening', 'writing', 'speaking'].map(skillCard)),
      h('p', null, '目標試験の候補: ', h('strong', null, EXAM_JA[r.suggestedExam])),
      h('p', { class: 'small muted' }, '4技能の平均ではなく、無理なく始められる目標として提案しています。得意な技能は上のレベルの教材で伸ばせます。レベルは設定画面でいつでも調整できます。'),
      target === 'undecided' ? h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: async (e) => {
        e.target.disabled = true;
        await api.put('/api/me/target', { exam: r.suggestedExam, plannedMonth: state.me.target?.planned_month || null });
        await refreshMe(); e.target.textContent = `目標を ${EXAM_JA[r.suggestedExam]} に設定しました`;
      } }, `目標を ${EXAM_JA[r.suggestedExam]} にする`) : null,
      h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => go('#/home') }, 'ダッシュボードへ')),
    h('details', { class: 'card' }, h('summary', null, 'Reading・Listening の解答と解説を見る'),
      (r.review || []).map((it, i) => h('div', { class: `review-item ${it.correct ? 'is-correct' : 'is-wrong'}` },
        h('p', { class: 'small muted' }, `${SKILL_JA[it.skill]} ${it.level} 問${(i % 3) + 1}`),
        h('p', { lang: 'en' }, it.stem),
        h('p', null, it.correct ? '○ 正解' : `× ${it.response == null ? '未解答' : '不正解'}（正答: ${'ABCD'[it.answer]}. `, it.correct ? null : h('span', { lang: 'en' }, it.options[it.answer]), it.correct ? null : '）'),
        h('p', { class: 'small' }, it.explanation),
        it.evidence ? h('blockquote', { lang: 'en' }, it.evidence) : null))),
    disclaimer());
}
