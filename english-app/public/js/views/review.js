// 復習画面（間隔をあけた解き直し）
import { h, SKILL_JA, fmtDate } from '../dom.js';
import { api } from '../api.js';
import { setTitle } from '../main.js';
import { questionCard, recordAttempt, passageView, scriptView, stimulusView, emptyState } from '../components.js';

const REASON_JA = { incorrect: '前回まちがえた問題', supported: 'スクリプトを見て解いた問題' };

export default async function reviewView() {
  setTitle('復習');
  const d = await api.get('/api/review');
  const next = d.upcoming[0];
  if (!d.items.length) {
    return h('div', { class: 'stack' }, h('section', { class: 'card' }, h('h2', { class: 'card-title' }, '今日の復習はありません'),
      emptyState('まちがえた問題や、スクリプトを見て解いた問題は、1日後・3日後・7日後…と間隔をあけて復習に出てきます。'),
      next ? h('p', null, `次の復習: ${fmtDate(next)}（${d.upcoming.length}問が予定されています）`) : null,
      h('a', { class: 'btn btn-primary btn-block', href: '#/home' }, 'ホームへ')));
  }
  return h('div', { class: 'stack' },
    h('section', { class: 'card' }, h('p', null, `復習する問題が ${d.dueCount} 問あります${d.dueCount > d.items.length ? `（今回は ${d.items.length} 問）` : ''}。`),
      h('p', { class: 'small muted' }, '支援なしで正解すると、次の復習までの間隔が長くなります。5回続けて正解すると復習リストから外れます。')),
    d.items.map((it, i) => reviewBlock(it, i)));
}

function reviewBlock(it, i) {
  // リスニング問題で解答前にスクリプトを開いた場合は「支援あり」として記録する
  let scriptOpened = false;
  const q = it.question;
  const ctx = it.context ? h('details', { class: 'card', ontoggle: (e) => { if (e.target.open && it.context.type === 'script') scriptOpened = true; } },
    h('summary', null, it.context.type === 'script' ? 'スクリプトを見る（解答前に見ると支援ありとして記録）' : '英文を見る'),
    it.context.type === 'passage' ? passageView(it.context.passage) : it.context.type === 'script' ? scriptView(it.context.script) : stimulusView(it.context.text)) : null;
  const card = questionCard(q, {
    number: i + 1, allowRetry: false,
    record: (response) => recordAttempt({ q, context: 'review', response, support: { scriptOpened } }),
  }).el;
  return h('div', { class: 'stack review-block' },
    h('p', { class: 'small muted' }, `${it.unitTitle}（${it.level}）・${SKILL_JA[it.question.skill] || ''}・${REASON_JA[it.reason] || ''}`), ctx, card);
}
