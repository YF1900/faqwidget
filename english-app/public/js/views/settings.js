// 設定: 目標・技能別レベルの手動調整・アカウント・データの書き出しと削除
import { h, replace, EXAM_JA, SKILL_JA, SOURCE_JA, LEVEL_JA, toast, confirmDialog, downloadJson } from '../dom.js';
import { api, pendingItems } from '../api.js';
import { local, recordings } from '../local.js';
import { state, setTitle, refreshMe, logout, isTeacher, go } from '../main.js';
import { disclaimer } from '../components.js';

export default async function settingsView() {
  setTitle('設定');
  await refreshMe();
  const me = state.me;
  const teacher = isTeacher();
  const sections = [];

  sections.push(h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'アカウント'),
    h('p', null, `ログインID: ${me.user.loginId}`),
    nameForm(me),
    me.classes.length ? h('p', { class: 'small' }, `所属クラス: ${me.classes.map((c) => c.name).join('、')}`) : null,
    teacher ? null : joinForm(),
    passwordForm()));

  if (!teacher) {
    sections.push(h('section', { class: 'card' }, h('h2', { class: 'card-title' }, '目標'),
      h('p', null, `${me.target ? EXAM_JA[me.target.exam] : '未設定'}${me.target?.planned_month ? `（受験予定 ${me.target.planned_month}）` : ''}`),
      h('a', { class: 'btn btn-secondary', href: '#/onboarding' }, '目標を変更する'),
      h('a', { class: 'btn btn-ghost', href: '#/diagnostic' }, '診断を受け直す')));
    sections.push(levelsCard(me));
  }

  const pending = pendingItems().length;
  const recCount = await recordings.count();
  sections.push(h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'データと個人情報'),
    h('p', { class: 'small' }, `この端末に保存中: 未送信の回答 ${pending} 件・録音 ${recCount} 件${local.available() ? '' : '（この端末では一時保存を利用できません）'}`),
    h('div', { class: 'btn-col' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: async () => {
        try { downloadJson(await api.get('/api/me/export'), `english-steps-${me.user.loginId}.json`); } catch (e) { toast(e.message, 'error'); }
      } }, '自分のデータをダウンロード（JSON）'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: async () => {
        if (!(await confirmDialog('この端末に保存した下書き・録音・未送信の回答を削除します。サーバーに保存済みのデータは消えません。よろしいですか？', { ok: '削除する', danger: true }))) return;
        local.clearUser(me.user.id); await recordings.clearUser(me.user.id); toast('この端末のデータを削除しました', 'success'); go('#/settings');
      } }, 'この端末に保存したデータを削除'),
      h('a', { class: 'btn btn-ghost btn-block', href: '#/privacy' }, '個人情報の取り扱い'),
      h('a', { class: 'btn btn-ghost btn-block', href: '#/about' }, 'このアプリについて'))));

  if (!teacher) sections.push(deleteCard());
  sections.push(h('section', { class: 'card' }, h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => logout() }, 'ログアウト'),
    h('p', { class: 'small muted' }, 'ログアウトすると、この端末に保存した下書き・録音・未送信の回答は削除されます（共用端末でも安心して使えます）。')));
  sections.push(disclaimer());
  return h('div', { class: 'stack narrow' }, sections);
}

function levelsCard(me) {
  const rows = ['reading', 'listening', 'writing', 'speaking'].map((s) => {
    const cur = me.levels[s];
    const sel = h('select', { id: `lv-${s}`, onchange: async () => {
      sel.disabled = true;
      try { await api.put('/api/me/levels', { skill: s, level: sel.value }); toast(`${SKILL_JA[s]} のレベルを ${sel.value} にしました`, 'success'); await refreshMe(); replace(src, SOURCE_JA.student); } catch (e) { toast(e.message, 'error'); sel.value = cur.level; }
      sel.disabled = false;
    } }, ['A2', 'B1', 'B2'].map((L) => h('option', { value: L, selected: cur.level === L }, LEVEL_JA[L])));
    const src = h('span', { class: 'tag tag-light' }, SOURCE_JA[cur.level_source]);
    return h('div', { class: 'field level-row' }, h('label', { for: `lv-${s}` }, SKILL_JA[s]), sel, src);
  });
  return h('section', { class: 'card' }, h('h2', { class: 'card-title' }, '技能ごとの学習レベル'),
    h('p', { class: 'small muted' }, '診断の目安から自分で調整できます。先生が調整することもあります。レベルを変えると、そのレベルの課題が「今日やること」に出るようになります。'), rows);
}

function nameForm(me) {
  const input = h('input', { type: 'text', id: 'dname', value: me.user.displayName, maxlength: 20, autocomplete: 'nickname' });
  return h('form', { class: 'inline-form', onsubmit: async (e) => {
    e.preventDefault();
    try { await api.put('/api/me/profile', { displayName: input.value }); await refreshMe(); toast('表示名を変更しました', 'success'); } catch (err) { toast(err.message, 'error'); }
  } }, h('label', { for: 'dname' }, '表示名（本名は使わないでください）'), h('div', { class: 'row' }, input, h('button', { class: 'btn btn-secondary', type: 'submit' }, '変更')));
}

function joinForm() {
  const input = h('input', { type: 'text', id: 'jcode', autocapitalize: 'characters', autocomplete: 'off', maxlength: 12 });
  return h('form', { class: 'inline-form', onsubmit: async (e) => {
    e.preventDefault();
    try { const r = await api.post('/api/me/classes', { joinCode: input.value }); toast(`「${r.class.name}」に参加しました`, 'success'); input.value = ''; } catch (err) { toast(err.message, 'error'); }
  } }, h('label', { for: 'jcode' }, '別のクラスに参加（参加コード）'), h('div', { class: 'row' }, input, h('button', { class: 'btn btn-secondary', type: 'submit' }, '参加')));
}

function passwordForm() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password', id: 'pw-cur' });
  const next = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, id: 'pw-new' });
  return h('details', null, h('summary', null, 'パスワードを変更する'),
    h('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      try { await api.post('/api/me/password', { current: cur.value, next: next.value }); toast('パスワードを変更しました', 'success'); cur.value = ''; next.value = ''; } catch (err) { toast(err.message, 'error'); }
    } }, h('div', { class: 'field' }, h('label', { for: 'pw-cur' }, '現在のパスワード'), cur), h('div', { class: 'field' }, h('label', { for: 'pw-new' }, '新しいパスワード（8文字以上）'), next),
    h('button', { class: 'btn btn-secondary', type: 'submit' }, '変更する')));
}

function deleteCard() {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', id: 'del-pw' });
  return h('details', { class: 'card danger-zone' }, h('summary', null, '退会（アカウントとデータの削除）'),
    h('p', { class: 'small' }, 'アカウントと、解答・提出物・先生の評価などすべての学習データをサーバーから完全に削除します。元に戻せません。必要なら先に「自分のデータをダウンロード」してください。'),
    h('div', { class: 'field' }, h('label', { for: 'del-pw' }, '確認のためパスワードを入力'), pw),
    h('button', { type: 'button', class: 'btn btn-danger btn-block', onclick: async () => {
      if (!(await confirmDialog('本当に退会しますか？すべての学習データが削除され、元に戻せません。', { ok: '退会する', danger: true }))) return;
      try { await api.post('/api/me/delete', { password: pw.value }); toast('アカウントを削除しました', 'success'); await logout({ force: true }); } catch (e) { toast(e.message, 'error'); }
    } }, '退会する'));
}
