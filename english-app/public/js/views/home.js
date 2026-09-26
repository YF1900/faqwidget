// 生徒用ダッシュボード: 「今日は何をするか」を最優先に表示する
import { h, EXAM_JA, LEVEL_JA, SKILL_JA, SKILL_ICON, SOURCE_JA, fmtDate, pct } from '../dom.js';
import { api } from '../api.js';
import { state, setTitle, go } from '../main.js';
import { card, progressBar, disclaimer, emptyState } from '../components.js';
import { titleBadge } from './stamps.js';

function recHref(r) {
  if (r.type === 'onboarding') return '#/onboarding';
  if (r.type === 'diagnostic') return '#/diagnostic';
  if (r.type === 'review') return '#/review';
  return `#/unit/${encodeURIComponent(r.unitId)}/step/${r.step}`;
}

function monthsUntil(ym) {
  if (!ym) return null;
  const [y, m] = ym.split('-').map(Number);
  const n = new Date();
  return (y - n.getFullYear()) * 12 + (m - 1 - n.getMonth());
}

export default async function homeView() {
  setTitle('ホーム');
  if (state.me.needsPrivacyAgreement) { go('#/privacy'); return null; }
  if (!state.me.target) { go('#/onboarding'); return null; }
  const [d, st] = await Promise.all([api.get('/api/dashboard'), api.get('/api/stamps').catch(() => null)]);
  const [first, ...rest] = d.today;

  const today = h('section', { class: 'card today', 'aria-labelledby': 'today-title' },
    h('h2', { id: 'today-title', class: 'card-title' }, '今日やること'),
    first ? h('a', { class: 'today-main', href: recHref(first) },
      h('span', { class: 'today-title' }, first.title),
      h('span', { class: 'today-meta' }, `約${first.minutes}分`),
      h('span', { class: 'today-reason' }, first.reason),
      h('span', { class: 'btn btn-primary btn-block', 'aria-hidden': 'true' }, 'はじめる →')) : emptyState('すべての課題が終わっています。復習や、1つ上のレベルの単元に挑戦しましょう。'),
    rest.length ? h('ul', { class: 'today-more' }, rest.map((r) => h('li', null,
      h('a', { href: recHref(r) }, h('strong', null, r.title), h('span', { class: 'small muted' }, ` 約${r.minutes}分`), h('span', { class: 'small block' }, r.reason))))) : null);

  const m = monthsUntil(d.target?.planned_month);
  const target = h('section', { class: 'card target-card' },
    h('div', null, h('p', { class: 'small muted' }, '目標'), h('p', { class: 'target-exam' }, EXAM_JA[d.target.exam])),
    h('div', null, h('p', { class: 'small muted' }, '受験予定'), h('p', null, d.target.planned_month ? `${d.target.planned_month.replace('-', '年')}月${m != null && m >= 0 ? `（あと約${m}か月）` : ''}` : '未定')),
    h('a', { href: '#/onboarding', class: 'small' }, '変更'));

  const skills = card('4技能の状況',
    h('p', { class: 'small muted' }, '技能ごとに学習レベルが違ってかまいません。習熟度はアプリ独自の目安です。'),
    h('div', { class: 'skill-grid' }, ['reading', 'listening', 'writing', 'speaking'].map((s) => {
      const p = d.skills[s];
      return h('div', { class: `skill-card st-${p.status}` },
        h('p', { class: 'skill-name' }, `${SKILL_ICON[s]} ${SKILL_JA[s]}`),
        h('p', { class: 'skill-level' }, LEVEL_JA[p.level], h('span', { class: 'tag tag-light' }, SOURCE_JA[p.levelSource])),
        p.score != null ? progressBar(Math.round(p.score * 100), 100, `${SKILL_JA[s]}の習熟度`) : null,
        h('p', { class: 'skill-status' }, p.statusJa, p.score != null ? `（${pct(p.score)}）` : ''),
        p.kind === 'rated' && p.selfAvg != null && p.teacherAvg == null ? h('p', { class: 'small muted' }, `自己評価 ${p.selfAvg.toFixed(1)} / 5（参考）`) : null,
        h('details', { class: 'small' }, h('summary', null, 'どう決まる？'), h('p', null, p.explanation)));
    })),
    d.stats.supported ? h('p', { class: 'small muted' }, `スクリプトを見て解答した回数: ${d.stats.supported}回（習熟度では半分の点数で数えています）`) : null);

  const review = card('復習',
    d.dueCount ? h('a', { href: '#/review', class: 'btn btn-secondary btn-block' }, `復習する問題が ${d.dueCount} 問あります →`) : h('p', { class: 'muted' }, '今日の復習はありません。'),
    d.mistakes.items.length ? h('div', null, h('h3', { class: 'sub-title' }, 'よく間違える問題'),
      h('ul', { class: 'plain-list' }, d.mistakes.items.map((it) => h('li', null, h('span', { class: 'tag' }, `${SKILL_JA[it.skill] || ''} ${it.level || ''}`), ' ', h('span', { lang: 'en' }, it.stem), h('span', { class: 'small muted' }, `（${it.wrong}回まちがい）`))))) : null,
    d.mistakes.focus.length ? h('div', null, h('h3', { class: 'sub-title' }, '苦手な問題の種類'),
      h('ul', { class: 'plain-list' }, d.mistakes.focus.map((f) => h('li', null, `${f.label}: 正答率 ${pct(f.rate)}（${f.total}回）`)))) : null);

  const units = card('単元',
    d.unitsInProgress.length ? h('ul', { class: 'plain-list' }, d.unitsInProgress.map((u) => h('li', null, h('a', { href: `#/unit/${encodeURIComponent(u.id)}` }, `${u.titleJa}（${u.level}）`), ` ${u.completed}/${u.total} ステップ`))) : null,
    h('p', null, `完了した単元: ${d.completedUnits.length ? d.completedUnits.map((u) => `${u.titleJa}（${u.level}）`).join('、') : 'まだありません'}`),
    h('a', { href: '#/units', class: 'small' }, '単元一覧へ →'));

  const history = card('学習履歴と最近の変化',
    d.changes.length ? h('ul', { class: 'plain-list' }, d.changes.map((c) => {
      const diff = Math.round((c.current - c.previous) * 100);
      return h('li', null, `${c.label}: 今週の正答率 ${pct(c.current)}（先週 ${pct(c.previous)}、${diff >= 0 ? '+' : ''}${diff}ポイント）`);
    })) : h('p', { class: 'small muted' }, '2週間分の解答がたまると、先週との比較を表示します。'),
    d.history.length ? h('ul', { class: 'timeline' }, d.history.map((e) => h('li', null, h('time', { datetime: e.at }, fmtDate(e.at)), ' ', e.text))) : emptyState('まだ学習履歴はありません。'),
    d.diagnostic ? h('p', { class: 'small muted' }, `最後の診断: ${fmtDate(d.diagnostic.createdAt, false)}　`, h('a', { href: '#/diagnostic' }, 'もう一度診断する')) : null);

  // スタンプ帳のまとめ（自分の学習レベルと、スタンプを集め始めたレベル）
  const myLevels = new Set(Object.values(d.skills).map((x) => x.level));
  const stampCard = st ? h('a', { class: 'card stamp-summary', href: '#/stamps' },
    h('h2', { class: 'card-title' }, `⭐ スタンプ ${st.total}個`),
    st.levels.filter((L) => myLevels.has(L.level) || L.count).map((L) => h('div', { class: 'stamp-sum-row' },
      h('span', { class: 'stamp-sum-level' }, L.level), titleBadge(L.title),
      h('span', { class: 'small' }, `${L.count}/${L.total}`),
      progressBar(L.count, L.total, `${L.level} のスタンプ`),
      h('span', { class: 'small muted block' }, L.next ? `「${L.next.name}」まであと${L.remainingToNext}個` : 'マスター達成！'))),
    h('span', { class: 'small' }, 'スタンプ帳を見る →')) : null;
  return h('div', { class: 'stack' }, today, stampCard, target, skills, review, units, history, disclaimer());
}
