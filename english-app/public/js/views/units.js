// 単元一覧・単元の概要
import { h, LEVEL_JA, SKILL_JA, KIND_JA } from '../dom.js';
import { api } from '../api.js';
import { setTitle, isTeacher } from '../main.js';
import { progressBar, disclaimer } from '../components.js';

const SKILL_OF_KIND = { reading: 'reading', listening: 'listening', writing: 'writing', speaking: 'speaking' };

export async function unitListView() {
  setTitle(isTeacher() ? '学習画面（プレビュー）' : '単元一覧');
  const { units, levels } = await api.get('/api/units');
  const themes = new Map();
  for (const u of units) { if (!themes.has(u.theme)) themes.set(u.theme, { label: u.themeLabel, units: [] }); themes.get(u.theme).units.push(u); }
  const mySkillsAt = (level) => ['reading', 'listening', 'writing', 'speaking'].filter((s) => levels[s].level === level);
  return h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('p', null, '同じテーマを A2・B1・B2 の3つのレベルで学べます。技能ごとに、あなたの学習レベルに合った単元の課題を選びましょう。'),
      h('p', { class: 'small muted' }, 'あなたの学習レベル: ', ['reading', 'listening', 'writing', 'speaking'].map((s) => `${SKILL_JA[s]} ${levels[s].level}`).join('／'))),
    [...themes.values()].map((t) => h('section', { class: 'theme' },
      h('h2', { class: 'theme-title' }, t.label),
      h('div', { class: 'unit-grid' }, t.units.sort((a, b) => a.order - b.order || a.level.localeCompare(b.level)).map((u) => {
        const mine = mySkillsAt(u.level);
        return h('a', { class: `unit-card lv-${u.level}`, href: `#/unit/${encodeURIComponent(u.id)}` },
          h('span', { class: 'unit-level' }, LEVEL_JA[u.level]),
          h('span', { class: 'unit-title' }, `第${u.order}単元 ${u.titleJa}`),
          h('span', { class: 'unit-title-en', lang: 'en' }, u.title),
          h('span', { class: 'small muted' }, `${u.exam}・約${u.estimatedMinutes}分・${u.total}ステップ`),
          progressBar(u.completed, u.total, `${u.titleJa}の進捗`),
          h('span', { class: 'small' }, u.isComplete ? '✓ 完了' : `${u.completed}/${u.total} 完了`),
          mine.length ? h('span', { class: 'tag' }, `あなたの ${mine.map((s) => SKILL_JA[s]).join('・')} のレベル`) : null);
      })))),
    h('p', { class: 'small muted' }, '旅行・地域・環境・テクノロジー・進路・異文化交流などのテーマは、今後追加できます。'),
    disclaimer());
}

export async function unitOverviewView({ params }) {
  const [{ unit }, { levels }] = await Promise.all([api.get(`/api/units/${encodeURIComponent(params.id)}`), api.get('/api/units')]);
  setTitle(`${unit.titleJa}（${unit.level}）`, { back: '#/units' });
  const next = unit.activities.find((a) => !a.completed) || unit.activities[0];
  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('p', { class: 'small muted' }, `${unit.themeLabel}・${LEVEL_JA[unit.level]}・${unit.exam}`),
      h('h2', { class: 'card-title', lang: 'en' }, unit.title),
      h('h3', { class: 'sub-title' }, 'この単元でできるようになること'),
      h('ul', null, unit.objectives.map((o) => h('li', null, o.text))),
      h('a', { class: 'btn btn-primary btn-block', href: `#/unit/${encodeURIComponent(unit.id)}/step/${next.step}` }, unit.activities.every((a) => a.completed) ? 'はじめから見直す' : `step ${next.step} から続ける →`)),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'ステップ'),
      h('ol', { class: 'step-list' }, unit.activities.map((a) => {
        const skill = SKILL_OF_KIND[a.kind];
        const mismatch = skill && levels[skill].level !== unit.level;
        return h('li', null, h('a', { href: `#/unit/${encodeURIComponent(unit.id)}/step/${a.step}`, class: a.completed ? 'done' : '' },
          h('span', { class: 'step-check', 'aria-label': a.completed ? '完了' : '未完了' }, a.completed ? '✓' : String(a.step)),
          h('span', { class: 'step-body' }, h('span', { class: 'step-kind' }, KIND_JA[a.kind]), h('span', null, a.title),
            h('span', { class: 'small muted' }, `約${a.minutes || 8}分`),
            mismatch ? h('span', { class: 'small hint-level' }, `あなたの${SKILL_JA[skill]}レベルは ${levels[skill].level} です`) : null)));
      }))),
    disclaimer());
}
