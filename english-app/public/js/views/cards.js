// 単語帳: 単語・熟語・構文をカードで覚え、小テストで確かめる（小テストの正解はスタンプの対象）
import { h, replace, uuid, LEVEL_JA, toast } from '../dom.js';
import { api, submitReliably } from '../api.js';
import { local } from '../local.js';
import { setTitle, go, state } from '../main.js';
import { speakButton } from '../media.js';
import { stampLine, saveBadge, emptyState } from '../components.js';

const TYPE_FILTERS = [['all', 'すべて'], ['word', '単語'], ['phrase', '熟語・表現'], ['structure', '構文']];
const QUIZ_SIZE = 10;

function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

export default async function cardsView({ params }) {
  setTitle('単語帳');
  let { units } = await api.get('/api/cards');
  if (!units.length) return h('div', { class: 'card' }, emptyState('公開中の単元がありません。'));
  // 単元の初期値: URL → 前回選んだ単元 → Reading の学習レベルの単元
  const myLevel = state.me?.levels?.reading?.level || 'A2';
  const unitId = params.unitId || local.get('cards-unit') || (units.find((u) => u.level === myLevel) || units[0]).id;
  const data = await api.get(`/api/cards?unitId=${encodeURIComponent(units.some((u) => u.id === unitId) ? unitId : units[0].id)}`);
  units = data.units;
  local.set('cards-unit', data.unit.id);
  let filter = local.get('cards-filter', 'all');
  let mode = 'learn';
  const cards = data.cards;

  const unitSel = h('select', { id: 'card-unit', 'aria-label': '単元', onchange: () => go(`#/cards/${encodeURIComponent(unitSel.value)}`) },
    units.map((u) => h('option', { value: u.id, selected: u.id === data.unit.id }, `${LEVEL_JA[u.level]}　第${u.order}単元 ${u.titleJa}`)));
  const filterBox = h('div', { class: 'seg-tabs static', role: 'tablist', 'aria-label': '種類' });
  const modeBox = h('div', { class: 'seg-tabs static', role: 'tablist', 'aria-label': '学習方法' });
  const body = h('div', { class: 'stack' });
  const summary = h('p', { class: 'small muted' });

  const filtered = () => (filter === 'all' ? cards : cards.filter((c) => c.type === filter));
  function renderTabs() {
    replace(filterBox, TYPE_FILTERS.map(([k, label]) => h('button', { type: 'button', role: 'tab', class: 'seg', 'aria-selected': String(filter === k),
      onclick: () => { filter = k; local.set('cards-filter', k); renderTabs(); render(); } }, `${label}`)));
    replace(modeBox, [['learn', '📖 カードで覚える'], ['quiz', '✏️ 小テスト']].map(([k, label]) => h('button', { type: 'button', role: 'tab', class: 'seg', 'aria-selected': String(mode === k),
      onclick: () => { mode = k; renderTabs(); render(); } }, label)));
    const list = filtered();
    summary.textContent = `${list.length}枚・スタンプ ${list.filter((c) => c.stamp.earned).length}/${list.length}`;
  }
  function render() { replace(body, mode === 'learn' ? learnMode(filtered()) : quizMode(filtered(), cards)); window.scrollTo(0, 0); }
  renderTabs(); render();

  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('div', { class: 'field' }, h('label', { for: 'card-unit' }, '単元'), unitSel),
      filterBox, modeBox, summary,
      h('p', { class: 'small muted' }, '小テストで3回続けて正解し、そのうち1回以上が別の日ならスタンプがもらえます。')),
    body);
}

// ---------- カードで覚える ----------
function learnMode(list) {
  if (!list.length) return emptyState('この種類のカードはありません。');
  let i = 0; let shown = false;
  const box = h('div');
  const TYPE_JA = { word: '単語', phrase: '熟語・表現', structure: '構文' };
  function render() {
    const c = list[i];
    const reveal = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => { shown = true; render(); } }, '意味を見る');
    replace(box, h('section', { class: `card flashcard${c.stamp.earned ? ' has-stamp' : ''}`, 'aria-live': 'polite' },
      h('div', { class: 'flash-meta' }, h('span', { class: 'tag' }, TYPE_JA[c.type]), h('span', { class: 'small muted' }, `${i + 1} / ${list.length}`),
        c.stamp.earned ? h('span', { class: 'stamp-mini', title: 'スタンプ獲得済み' }, '★') : null),
      h('p', { class: 'flash-front', lang: 'en' }, c.front),
      h('div', { class: 'btn-row center-row' }, speakButton(c.type === 'structure' && c.example ? c.example : c.front, '🔊 発音を聞く')),
      shown ? h('div', { class: 'flash-back' },
        h('p', { class: 'flash-meaning' }, c.meaning),
        c.example ? h('p', { class: 'flash-example', lang: 'en' }, c.example, ' ', speakButton(c.example, '🔊')) : null,
        c.note ? h('p', { class: 'small muted' }, `解説: ${c.note}`) : null) : reveal),
    h('div', { class: 'btn-row flash-nav' },
      h('button', { type: 'button', class: 'btn btn-secondary', disabled: i === 0, onclick: () => { i--; shown = false; render(); } }, '← 前へ'),
      h('button', { type: 'button', class: 'btn btn-secondary', disabled: i === list.length - 1, onclick: () => { i++; shown = false; render(); } }, '次へ →')));
  }
  render();
  return box;
}

// ---------- 小テスト ----------
function pickQuiz(list) {
  // スタンプに近いもの（連続正解中で今日まだ解いていない）→ まだスタンプのないもの → 残り の順に出す
  const notEarned = list.filter((c) => !c.stamp.earned);
  const ready = shuffle(notEarned.filter((c) => c.stamp.streak > 0 && !c.stamp.answeredToday));
  const rest = shuffle(notEarned.filter((c) => !ready.includes(c)));
  const done = shuffle(list.filter((c) => c.stamp.earned));
  return [...ready, ...rest, ...done].slice(0, QUIZ_SIZE);
}

function optionsFor(card, pool) {
  const same = pool.filter((c) => c.id !== card.id && c.type === card.type && c.meaning !== card.meaning);
  const others = pool.filter((c) => c.id !== card.id && c.type !== card.type && c.meaning !== card.meaning);
  const distractors = [...new Set([...shuffle(same), ...shuffle(others)].map((c) => c.meaning))].slice(0, 3);
  return shuffle([card.meaning, ...distractors]);
}

function quizMode(list, pool) {
  if (!list.length) return emptyState('この種類のカードはありません。');
  const quiz = pickQuiz(list);
  let i = 0; let correctCount = 0; let newStamps = 0;
  const box = h('div');
  function render() {
    if (i >= quiz.length) {
      replace(box, h('section', { class: 'card center' },
        h('h2', { class: 'card-title' }, '小テスト終了'),
        h('p', { class: 'quiz-score' }, `${correctCount} / ${quiz.length} 問正解`),
        newStamps ? h('p', { class: 'stamp-line stamp-new' }, h('span', { class: 'stamp-icon', 'aria-hidden': 'true' }, '★'), `スタンプを${newStamps}個獲得しました！`) : null,
        h('p', { class: 'small muted' }, '連続正解の途中のカードは、明日以降にもう一度解くとスタンプに近づきます。'),
        h('div', { class: 'btn-col' },
          h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => go(location.hash) }, 'もう一度（新しい10問）'),
          h('a', { class: 'btn btn-secondary btn-block', href: '#/stamps' }, 'スタンプ帳を見る'))));
      return;
    }
    const c = quiz[i];
    const opts = optionsFor(c, pool);
    const feedback = h('div', { 'aria-live': 'polite' });
    const name = `quiz-${c.id}-${i}`;
    let chosen = null;
    const inputs = [];
    const submitBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: true, onclick: async () => {
      submitBtn.disabled = true; inputs.forEach((x) => { x.disabled = true; });
      replace(feedback, saveBadge('sending'));
      const r = await submitReliably('POST', '/api/cards/attempts', { clientId: uuid(), cardId: c.id, response: chosen }, `単語帳（${c.front}）`);
      if (r.status === 'error') { replace(feedback, h('p', { class: 'error-text' }, r.error.message)); submitBtn.disabled = false; inputs.forEach((x) => { x.disabled = false; }); return; }
      const correct = r.status === 'saved' ? r.data.correct : chosen === c.meaning;
      if (correct) correctCount++;
      if (r.status === 'saved' && r.data.stamp?.newlyEarned) newStamps++;
      if (r.status === 'saved') c.stamp = { ...c.stamp, ...r.data.stamp, answeredToday: true };
      inputs.forEach((x) => {
        const label = x.closest('.option');
        label.classList.toggle('opt-correct', x.value === c.meaning);
        label.classList.toggle('opt-wrong', x.value === chosen && chosen !== c.meaning);
      });
      submitBtn.hidden = true;
      replace(feedback,
        h('p', { class: `result ${correct ? 'result-ok' : 'result-ng'}` }, correct ? '○ 正解' : '× 不正解', correct ? '' : h('span', { class: 'result-answer' }, `　正解: ${c.meaning}`)),
        r.status !== 'saved' ? saveBadge(r.status) : null,
        r.status === 'saved' ? stampLine(r.data.stamp) : null,
        c.example ? h('p', { class: 'flash-example', lang: 'en' }, c.example) : null,
        h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => { i++; render(); } }, i + 1 < quiz.length ? '次の問題 →' : '結果を見る'));
      if (r.status === 'queued') toast('通信できないため、結果はまだ保存されていません（あとで再送します）', 'info');
    } }, '解答する');
    replace(box, h('section', { class: 'qcard' },
      h('p', { class: 'small muted' }, `問 ${i + 1} / ${quiz.length}・${c.type === 'structure' ? '構文の意味' : '意味'}を選びましょう`),
      h('p', { class: 'flash-front', lang: 'en' }, c.front), h('div', { class: 'btn-row center-row' }, speakButton(c.type === 'structure' && c.example ? c.example : c.front, '🔊 聞く')),
      h('fieldset', { class: 'options' }, h('legend', { class: 'sr-only' }, `${c.front} の意味`),
        opts.map((o, k) => {
          const input = h('input', { type: 'radio', name, value: o, onchange: () => { chosen = o; submitBtn.disabled = false; } });
          inputs.push(input);
          return h('label', { class: 'option' }, input, h('span', { class: 'option-letter', 'aria-hidden': 'true' }, 'ABCD'[k]), h('span', { class: 'option-text' }, o));
        })),
      submitBtn, feedback));
  }
  render();
  return box;
}
