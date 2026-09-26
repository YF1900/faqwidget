// スタンプ帳: レベルごとにスタンプを集め、称号を上げていく
import { h, LEVEL_JA, fmtDate } from '../dom.js';
import { api } from '../api.js';
import { setTitle, state } from '../main.js';
import { progressBar } from '../components.js';

const TITLE_ICON = { beginner: '🌱', bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '💎', master: '👑' };
const TITLE_HINT = { beginner: '最初のスタンプ', bronze: '20%', silver: '40%', gold: '60%', platinum: '80%', master: '100%' };

export function titleBadge(t) {
  return t ? h('span', { class: `title-badge tb-${t.key}` }, `${TITLE_ICON[t.key]} ${t.name}`) : h('span', { class: 'title-badge tb-none' }, '称号なし');
}

export default async function stampsView() {
  setTitle('スタンプ帳');
  const d = await api.get('/api/stamps');
  const myLevels = state.me?.levels || {};
  const levelsInUse = new Set(Object.values(myLevels).map((l) => l.level));
  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, `集めたスタンプ ${d.total}個`),
      h('p', { class: 'small' }, d.rule.text),
      h('p', { class: 'small muted' }, '単元の問題と、単語帳の小テストの両方が対象です。スタンプは一度もらうと消えません。')),
    d.levels.map((L) => levelCard(L, levelsInUse.has(L.level), d.levels)),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, '称号の段階（レベルごと）'),
      h('ul', { class: 'plain-list' }, d.titles.map((t) => h('li', null, titleBadge(t), h('span', { class: 'small muted' }, ` そのレベルのスタンプの ${TITLE_HINT[t.key]}`))))),
    d.recent.length ? h('section', { class: 'card' }, h('h2', { class: 'card-title' }, '最近もらったスタンプ'),
      h('ul', { class: 'timeline' }, d.recent.map((r) => h('li', null, h('time', null, fmtDate(r.earnedAt)), ` ${r.level}・${r.category}: `, h('span', { lang: 'en' }, r.label))))) : null);
}

function levelCard(L, mine, all) {
  const pctDone = L.total ? Math.round((L.count / L.total) * 100) : 0;
  const nextLevel = all[all.indexOf(L) + 1];
  const goldOrAbove = L.title && ['gold', 'platinum', 'master'].includes(L.title.key);
  return h('section', { class: `card stamp-book lv-${L.level}` },
    h('div', { class: 'stamp-book-head' },
      h('h2', { class: 'card-title' }, `${LEVEL_JA[L.level]}${mine ? '' : ''}`), titleBadge(L.title)),
    mine ? h('p', { class: 'small muted' }, 'あなたの学習レベルです') : null,
    progressBar(L.count, L.total, `${L.level} のスタンプ`),
    h('p', null, h('strong', null, `${L.count} / ${L.total}`), `（${pctDone}%）`,
      L.next ? h('span', { class: 'small' }, `　次の称号「${L.next.name}」まであと ${L.remainingToNext}個`) : h('span', { class: 'small' }, '　このレベルをマスターしました！')),
    goldOrAbove && nextLevel ? h('p', { class: 'notice small' }, `${LEVEL_JA[L.level]}はもう十分に力がついています。${LEVEL_JA[nextLevel.level]}の単元にも挑戦してみましょう。`) : null,
    h('div', { class: 'stamp-grid', role: 'img', 'aria-label': `${L.total}個中${L.count}個のスタンプ` }, L.grid.map((on) => h('span', { class: on ? 'on' : '' }))),
    h('details', null, h('summary', null, '内訳を見る'),
      h('table', { class: 'result-table' }, h('tbody', null,
        L.categories.map((c) => h('tr', null, h('th', { scope: 'row' }, c.label), h('td', null, `${c.count} / ${c.total}`))),
        L.units.map((u) => h('tr', null, h('th', { scope: 'row' }, u.titleJa), h('td', null, `${u.count} / ${u.total}`)))))),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn btn-small btn-secondary', href: '#/review' }, 'スタンプに挑戦（復習）'),
      h('a', { class: 'btn btn-small btn-ghost', href: L.units[0] ? `#/cards/${encodeURIComponent(L.units[0].id)}` : '#/cards' }, '単語帳へ')));
}
