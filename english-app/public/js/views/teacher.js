// 教員画面: クラス・生徒の状況・誤答の多い問題・Writing/Speaking の評価
import { h, replace, SKILL_JA, LEVEL_JA, EXAM_JA, SOURCE_JA, fmtDate, pct, toast, confirmDialog } from '../dom.js';
import { api } from '../api.js';
import { setTitle, go } from '../main.js';
import { emptyState, disclaimer } from '../components.js';

const SKILLS = ['reading', 'listening', 'writing', 'speaking'];
const METHOD_JA = { auto: '自動採点', self: '自己評価' };

export async function teacherHomeView() {
  setTitle('教員ダッシュボード');
  const [{ classes, pendingFeedback }, { submissions }] = await Promise.all([api.get('/api/teacher/classes'), api.get('/api/teacher/submissions')]);
  const name = h('input', { type: 'text', id: 'cname', maxlength: 40, placeholder: '例: 1年A組 英語' });
  return h('div', { class: 'stack wide' },
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'クラス'),
      classes.length ? h('ul', { class: 'class-list' }, classes.map((c) => h('li', null,
        h('a', { href: `#/t/class/${c.id}` }, h('strong', null, c.name), h('span', { class: 'small muted' }, ` 生徒 ${c.students}人`)),
        h('span', { class: 'small' }, `参加コード: `, h('code', null, c.joinCode), c.joinOpen ? '' : '（受付停止中）')))) : emptyState('まだクラスがありません。'),
      h('form', { class: 'inline-form', onsubmit: async (e) => {
        e.preventDefault();
        try { await api.post('/api/teacher/classes', { name: name.value }); toast('クラスを作成しました', 'success'); go('#/t'); } catch (err) { toast(err.message, 'error'); }
      } }, h('label', { for: 'cname' }, '新しいクラスを作成'), h('div', { class: 'row' }, name, h('button', { class: 'btn btn-secondary', type: 'submit' }, '作成')))),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, `評価待ちの提出物（${pendingFeedback}件）`),
      submissions.length ? h('ul', { class: 'plain-list' }, submissions.slice(0, 30).map((s) => h('li', null,
        h('a', { href: `#/t/submission/${s.id}` }, `${s.displayName}（${s.loginId}）: ${s.kind === 'writing' ? 'Writing' : 'Speaking'} ${s.level} 「${s.activityTitle}」`),
        h('span', { class: 'small muted' }, ` ${fmtDate(s.createdAt)}${s.revision > 1 ? `・再提出${s.revision}回目` : ''}`)))) : emptyState('評価待ちの提出物はありません。')),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, '教材'),
      h('p', null, h('a', { href: '#/t/content' }, '教材の編集・公開設定・JSON 入出力 →')),
      h('p', null, h('a', { href: '#/units' }, '生徒の学習画面をプレビュー →'))),
    disclaimer());
}

export async function classView({ params }) {
  const c = await api.get(`/api/teacher/classes/${params.id}`);
  setTitle(c.name, { back: '#/t' });
  const codeInfo = h('p', null, '参加コード: ', h('code', { class: 'join-code' }, c.joinCode), c.joinOpen ? '（受付中）' : '（受付停止中）');
  const table = h('table', { class: 'data-table' },
    h('thead', null, h('tr', null, h('th', null, '生徒'), SKILLS.map((s) => h('th', null, SKILL_JA[s])), h('th', null, '目標'), h('th', null, '評価待ち'), h('th', null, '最終利用'))),
    h('tbody', null, c.students.map((s) => h('tr', null,
      h('th', { scope: 'row' }, h('a', { href: `#/t/student/${s.id}` }, s.displayName), h('span', { class: 'small muted block' }, s.loginId)),
      SKILLS.map((k) => h('td', { class: `st-${s.skills[k].status}` }, h('strong', null, s.skills[k].level), h('span', { class: 'small block' }, s.skills[k].score != null ? pct(s.skills[k].score) : s.skills[k].statusJa))),
      h('td', null, s.target ? EXAM_JA[s.target.exam] : '未設定'),
      h('td', null, s.pending ? String(s.pending) : ''),
      h('td', { class: 'small' }, fmtDate(s.lastActiveAt, false))))));
  return h('div', { class: 'stack wide' },
    h('section', { class: 'card' }, codeInfo,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: async () => { await api.patch(`/api/teacher/classes/${c.id}`, { joinOpen: !c.joinOpen }); go(`#/t/class/${c.id}`); } }, c.joinOpen ? '参加受付を停止' : '参加受付を再開'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: async () => {
          if (!(await confirmDialog('参加コードを新しくします。古いコードでは登録できなくなります。', { ok: '変更する' }))) return;
          await api.patch(`/api/teacher/classes/${c.id}`, { regenerateCode: true }); go(`#/t/class/${c.id}`);
        } }, '参加コードを再発行'),
        h('a', { class: 'btn btn-primary', href: `#/t/class/${c.id}/items` }, 'まちがいの多い問題'))),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, `生徒（${c.students.length}人）`),
      h('p', { class: 'small muted' }, '各技能: 学習レベルと習熟度（Reading/Listening は正答スコア、Writing/Speaking は教員評価）。'),
      c.students.length ? h('div', { class: 'table-wrap' }, table) : emptyState('まだ生徒がいません。参加コードを生徒に伝えてください。')),
    disclaimer());
}

export async function itemStatsView({ params }) {
  const [{ items }, c] = await Promise.all([api.get(`/api/teacher/classes/${params.id}/item-stats`), api.get(`/api/teacher/classes/${params.id}`)]);
  setTitle(`まちがいの多い問題`, { back: `#/t/class/${params.id}` });
  return h('div', { class: 'stack wide' },
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, c.name),
      h('p', { class: 'small muted' }, '各生徒の最初の解答で集計しています。問題を修正した場合は、どの版で解答したかの内訳を表示します。'),
      items.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
        h('thead', null, h('tr', null, h('th', null, '問題'), h('th', null, '誤答率'), h('th', null, '人数'), h('th', null, '種類'), h('th', null, '版'))),
        h('tbody', null, items.map((it) => h('tr', null,
          h('td', null, h('span', { lang: 'en' }, it.stem), h('span', { class: 'small muted block' }, `${it.unitTitle}（${it.level}）「${it.activityTitle}」 ID: ${it.questionId}`)),
          h('td', null, pct(it.wrongRate)), h('td', null, `${it.wrong}/${it.students}${it.supported ? `（支援${it.supported}）` : ''}`),
          h('td', { class: 'small' }, `${SKILL_JA[it.skill] || ''} ${it.focus || ''}`),
          h('td', { class: 'small' }, Object.entries(it.versions).map(([v, n]) => `v${v}:${n}人`).join(' '), it.currentVersion ? h('span', { class: 'block muted' }, `現在 v${it.currentVersion}`) : null)))))) : emptyState('まだ誤答のデータがありません。')),
    disclaimer());
}

export async function studentView({ params }) {
  const s = await api.get(`/api/teacher/students/${params.id}`);
  setTitle(s.displayName, { back: '#/t' });
  const levelRows = SKILLS.map((k) => {
    const d = s.skillsDetail[k];
    const sel = h('select', { 'aria-label': `${SKILL_JA[k]}のレベル`, onchange: async () => {
      try { await api.put(`/api/teacher/students/${s.id}/levels`, { skill: k, level: sel.value }); toast(`${SKILL_JA[k]} を ${sel.value} に変更しました`, 'success'); go(`#/t/student/${s.id}`); } catch (e) { toast(e.message, 'error'); }
    } }, ['A2', 'B1', 'B2'].map((L) => h('option', { value: L, selected: d.level === L }, LEVEL_JA[L])));
    return h('tr', null, h('th', { scope: 'row' }, SKILL_JA[k]), h('td', null, sel, h('span', { class: 'small muted block' }, SOURCE_JA[d.levelSource])),
      h('td', null, d.statusJa, d.score != null ? `（${pct(d.score)}）` : ''), h('td', { class: 'small' }, d.explanation));
  });
  const confirmId = h('input', { type: 'text', id: 'confirm-id', autocomplete: 'off', autocapitalize: 'off' });
  return h('div', { class: 'stack wide' },
    h('section', { class: 'card' }, h('p', null, `ログインID: ${s.loginId}　目標: ${s.target ? EXAM_JA[s.target.exam] : '未設定'}${s.target?.planned_month ? `（${s.target.planned_month}）` : ''}　最終利用: ${fmtDate(s.lastActiveAt)}`),
      h('p', { class: 'small' }, `解答数 ${s.attempts}・完了ステップ ${s.completed}・復習待ち ${s.dueReviews}`)),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, '技能別の状況とレベル調整'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' }, h('thead', null, h('tr', null, h('th', null, '技能'), h('th', null, 'レベル'), h('th', null, '状況'), h('th', null, '算出根拠'))), h('tbody', null, levelRows)))),
    s.diagnostic ? h('section', { class: 'card' }, h('h2', { class: 'card-title' }, `診断（${fmtDate(s.diagnostic.createdAt, false)}）`),
      h('ul', null, SKILLS.map((k) => { const d = s.diagnostic.skills[k]; return h('li', null, `${SKILL_JA[k]}: ${d.level}（${METHOD_JA[d.method]}${d.method === 'auto' ? ` A2 ${d.correct.A2}/3・B1 ${d.correct.B1}/3・B2 ${d.correct.B2}/3` : ` A2 ${d.canDoCount.A2}/3・B1 ${d.canDoCount.B1}/3・B2 ${d.canDoCount.B2}/3`}${d.scriptOpened ? '・スクリプト使用' : ''}${d.noAudio ? '・音声なし' : ''}）`); })),
      s.diagnostic.writingText ? h('details', null, h('summary', null, '診断で書いた英文'), h('p', { lang: 'en', class: 'submission-text' }, s.diagnostic.writingText)) : null) : null,
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, '弱点'),
      s.mistakes.focus.length ? h('ul', null, s.mistakes.focus.map((f) => h('li', null, `${f.label}: 正答率 ${pct(f.rate)}（${f.total}回）`))) : h('p', { class: 'muted' }, '特に目立つ苦手な問題の種類はありません（またはデータ不足）。'),
      s.mistakes.items.length ? h('ul', { class: 'plain-list' }, s.mistakes.items.map((m) => h('li', null, h('span', { lang: 'en' }, m.stem), h('span', { class: 'small muted' }, `（${m.wrong}回まちがい）`)))) : null),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Writing・Speaking の提出物'),
      s.submissions.length ? h('ul', { class: 'plain-list' }, s.submissions.map((sub) => h('li', null,
        h('a', { href: `#/t/submission/${sub.id}` }, `${sub.kind === 'writing' ? 'Writing' : 'Speaking'} ${sub.level}「${sub.activityTitle}」${sub.revision > 1 ? `（再提出${sub.revision}回目）` : ''}`),
        h('span', { class: 'small muted' }, ` ${fmtDate(sub.createdAt)} ${sub.feedback.length ? '評価済み' : '評価待ち'}`)))) : emptyState('提出物はありません。')),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, '学習履歴'),
      s.history.length ? h('ul', { class: 'timeline' }, s.history.map((e) => h('li', null, h('time', null, fmtDate(e.at)), ' ', e.text))) : emptyState('履歴はありません。')),
    h('details', { class: 'card danger-zone' }, h('summary', null, 'アカウントの削除（本人・保護者からの削除依頼への対応）'),
      h('p', { class: 'small' }, 'この生徒のアカウントと学習データをすべて完全に削除します。元に戻せません。'),
      h('div', { class: 'field' }, h('label', { for: 'confirm-id' }, `確認のためログインID「${s.loginId}」を入力`), confirmId),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
        if (!(await confirmDialog(`${s.displayName}（${s.loginId}）のアカウントとデータを削除します。`, { ok: '削除する', danger: true }))) return;
        try { await api.post(`/api/teacher/students/${s.id}/delete`, { confirmLoginId: confirmId.value }); toast('削除しました', 'success'); go('#/t'); } catch (e) { toast(e.message, 'error'); }
      } }, '削除する')),
    disclaimer());
}

export async function submissionView({ params }) {
  const d = await api.get(`/api/teacher/submissions/${params.id}`);
  const s = d.submission;
  setTitle(`${d.student.displayName} の提出物`, { back: `#/t/student/${d.student.id}` });
  const rubric = d.rubric;
  const scores = {};
  const last = s.feedback[s.feedback.length - 1];
  if (last) Object.assign(scores, last.scores);
  const msg = h('p', { 'aria-live': 'polite' });
  const comment = h('textarea', { id: 'fb-comment', rows: 5, maxlength: 3000, value: '' });
  const groups = (rubric?.criteria || []).map((c) => h('fieldset', { class: 'score-group' }, h('legend', null, c.label),
    h('div', { class: 'score-buttons' }, [0, 1, 2, 3, 4, 5].map((v) => h('label', { class: 'score' },
      h('input', { type: 'radio', name: `fb-${c.key}`, value: String(v), checked: scores[c.key] === v, onchange: () => { scores[c.key] = v; } }), h('span', null, String(v))))),
    h('ul', { class: 'small muted' }, Object.entries(c.descriptors).map(([k, t]) => h('li', null, `${k}: ${t}`)))));
  const selfLabel = (k) => rubric?.criteria.find((c) => c.key === k)?.label || k;
  const selfCheckItems = d.activity.task?.selfCheck || [];
  return h('div', { class: 'stack wide two-col' },
    h('div', { class: 'stack' },
      h('section', { class: 'card' }, h('p', { class: 'small muted' }, `${d.activity.unitTitle}（${d.activity.level}）・${d.activity.kind === 'writing' ? 'Writing' : 'Speaking'}・課題 v${s.activityVersion}${d.activity.currentVersion !== s.activityVersion ? `（現在 v${d.activity.currentVersion}）` : ''}`),
        h('h2', { class: 'card-title' }, d.activity.title),
        d.activity.task?.promptEn ? h('p', { lang: 'en', class: 'prompt-en' }, d.activity.task.promptEn) : null,
        d.activity.task?.parts ? h('ol', null, d.activity.task.parts.map((p) => h('li', { lang: 'en' }, p.question))) : null),
      h('section', { class: 'card' }, h('h3', { class: 'sub-title' }, `生徒の回答（${s.revision > 1 ? `再提出 ${s.revision}回目` : '1回目'}・${fmtDate(s.createdAt)}${s.kind === 'writing' ? `・${s.wordCount}語` : ''}）`),
        s.text ? h('p', { class: 'submission-text', lang: 'en' }, s.text) : h('p', { class: 'muted' }, '（テキストなし）'),
        s.kind === 'speaking' ? h('p', { class: 'small muted' }, s.recordedLocally ? '生徒は録音して練習しました（録音は生徒の端末内にのみ保存され、サーバーにはありません）。' : '録音なしで練習しました。') : null,
        h('h3', { class: 'sub-title' }, '生徒の自己点検・自己評価'),
        h('ul', { class: 'small' }, selfCheckItems.map((t, i) => h('li', null, `${s.selfCheck.includes(i) ? '☑' : '☐'} ${t}`))),
        Object.keys(s.selfScores).length ? h('p', { class: 'small' }, Object.entries(s.selfScores).map(([k, v]) => `${selfLabel(k)} ${v}`).join('・')) : h('p', { class: 'small muted' }, '自己評価なし')),
      d.history.length > 1 ? h('details', { class: 'card' }, h('summary', null, `提出の履歴（${d.history.length}件）`),
        d.history.map((x) => h('div', { class: 'submission' }, h('p', { class: 'small muted' }, `${x.revision}回目・${fmtDate(x.createdAt)}${x.feedback.length ? '・評価済み' : ''}`), h('p', { lang: 'en', class: 'submission-text' }, x.text)))) : null),
    h('form', { class: 'card form', onsubmit: async (e) => {
      e.preventDefault();
      try { await api.post(`/api/teacher/submissions/${s.id}/feedback`, { scores, comment: comment.value }); toast('評価を保存しました', 'success'); go(`#/t/submission/${s.id}`); } catch (err) { replace(msg, h('span', { class: 'error-text' }, err.message)); }
    } },
      h('h2', { class: 'card-title' }, '教員評価'),
      rubric ? h('p', { class: 'small muted' }, `${rubric.title}（各観点 0〜5）`) : h('p', { class: 'error-text' }, '評価基準が見つかりません'),
      groups,
      h('div', { class: 'field' }, h('label', { for: 'fb-comment' }, 'コメント（生徒に表示されます）'), comment),
      h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, s.feedback.length ? '評価を追加で保存' : '評価を保存'), msg,
      s.feedback.length ? h('div', null, h('h3', { class: 'sub-title' }, '保存済みの評価'), s.feedback.map((f) => h('div', { class: 'feedback' },
        h('p', { class: 'small muted' }, `${f.author || ''}・${fmtDate(f.createdAt)}`),
        h('p', { class: 'small' }, Object.entries(f.scores).map(([k, v]) => `${selfLabel(k)} ${v}`).join('・')), f.comment ? h('p', null, f.comment) : null))) : null));
}
