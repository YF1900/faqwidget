// アプリの起動・画面遷移（ハッシュルーター）・ネットワーク状態表示
import { h, replace, toast, confirmDialog } from './dom.js';
import { api, onNetChange, netState, flushOutbox, pendingItems, onOutboxResult } from './api.js';
import { setLocalUser, local, recordings } from './local.js';

export const state = { me: null };

const routes = [];
export function route(pattern, loader, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ re, keys, loader, ...opts });
}

// 画面ごとの後始末（音声停止など）
let cleanups = [];
export function onLeave(fn) { cleanups.push(fn); }

const main = () => document.getElementById('app');

export function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

export function setTitle(title, { back } = {}) {
  document.title = `${title} | English Steps`;
  replace(document.getElementById('page-title'), title);
  const backBtn = document.getElementById('back-btn');
  backBtn.hidden = !back;
  backBtn.onclick = back ? () => go(back) : null;
}

/** 学習に集中する画面ではタブバーを隠す */
export function setMode(mode) { document.body.dataset.mode = mode; }

async function render() {
  for (const fn of cleanups) { try { fn(); } catch { /* 後始末の失敗は無視 */ } }
  cleanups = [];
  const path = (location.hash || '#/').slice(1) || '/';
  if (!state.me) {
    const publicPaths = ['/login', '/register', '/privacy', '/about'];
    if (!publicPaths.includes(path)) { location.replace('#/login'); return; }
  }
  let r = null; let params = {};
  for (const rt of routes) { const m = path.match(rt.re); if (m) { r = rt; params = Object.fromEntries(rt.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); break; } }
  if (!r) { location.replace(state.me ? (isTeacher() ? '#/t' : '#/home') : '#/login'); return; }
  if (r.teacher && !isTeacher()) { location.replace('#/home'); return; }
  setMode(r.mode || 'tabs');
  updateTabs(path);
  const root = main();
  replace(root, h('p', { class: 'loading', role: 'status' }, '読み込み中…'));
  try {
    const mod = await r.loader();
    const view = await mod.default({ params, root });
    if (view) replace(root, view);
    root.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    replace(root, h('div', { class: 'card error-card', role: 'alert' },
      h('p', null, e.offline ? '通信できないため、画面を表示できませんでした。' : `エラー: ${e.message}`),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => render() }, '再読み込み')));
  }
}

export const isTeacher = () => ['teacher', 'admin'].includes(state.me?.user?.role);

function updateTabs(path) {
  const tabs = document.getElementById('tabbar');
  const items = isTeacher()
    ? [['#/t', '教員', '🏫'], ['#/t/content', '教材', '🛠️'], ['#/units', '学習', '📚'], ['#/settings', '設定', '⚙️']]
    : [['#/home', 'ホーム', '🏠'], ['#/units', '単元', '📚'], ['#/review', '復習', '🔁'], ['#/settings', '設定', '⚙️']];
  replace(tabs, state.me ? items.map(([href, label, icon]) => {
    const active = ('#' + path === href) || ('#' + path).startsWith(href + '/') && !(href === '#/t' && path.startsWith('/t/content'));
    return h('a', { href, class: `tab${active ? ' active' : ''}`, 'aria-current': active ? 'page' : null }, h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, icon), h('span', null, label));
  }) : []);
}

// ---- ネットワーク状態バナー ----
function renderNet(s) {
  const el = document.getElementById('netbar');
  if (s.online && !s.pending) { el.hidden = true; replace(el); return; }
  el.hidden = false;
  replace(el,
    h('span', null, !s.online ? '通信できません。' : '', s.pending ? `未送信の回答が${s.pending}件あります（この端末に一時保存中）。` : ''),
    s.pending ? h('button', { type: 'button', class: 'btn btn-small btn-light', onclick: async () => {
      const r = await flushOutbox();
      if (r.sent && !r.failed) toast(`${r.sent}件の回答を保存しました`, 'success');
      else if (r.failed) toast('まだ通信できません。しばらくしてから再送してください。', 'error');
    } }, '再送する') : null);
}

export async function refreshMe() {
  try { state.me = await api.get('/api/me'); } catch (e) { if (e.status === 401) state.me = null; else throw e; }
  if (state.me) setLocalUser(state.me.user.id);
  return state.me;
}

export async function logout({ force = false } = {}) {
  const pending = pendingItems().length;
  if (pending && !force) {
    const ok = await confirmDialog(`未送信の回答が${pending}件あります。ログアウトすると、この端末から削除され送信できなくなります。ログアウトしますか？`, { ok: 'ログアウトする', danger: true });
    if (!ok) return;
  }
  try { await api.post('/api/auth/logout'); } catch { /* 通信できなくても端末側の情報は消す */ }
  // 共用端末に配慮し、この端末に保存した下書き・録音・未送信データを削除する
  if (state.me) { local.clearUser(state.me.user.id); await recordings.clearUser(state.me.user.id); }
  state.me = null;
  setLocalUser('anon');
  location.hash = '#/login';
  render();
}

// ---- 画面の登録 ----
route('/login', () => import('./views/auth.js').then((m) => ({ default: m.loginView })), { mode: 'plain' });
route('/register', () => import('./views/auth.js').then((m) => ({ default: m.registerView })), { mode: 'plain' });
route('/privacy', () => import('./views/auth.js').then((m) => ({ default: m.privacyView })), { mode: 'plain' });
route('/about', () => import('./views/auth.js').then((m) => ({ default: m.aboutView })), { mode: 'plain' });
route('/onboarding', () => import('./views/onboarding.js'), { mode: 'plain' });
route('/diagnostic', () => import('./views/diagnostic.js'), { mode: 'focus' });
route('/home', () => import('./views/home.js'));
route('/units', () => import('./views/units.js').then((m) => ({ default: m.unitListView })));
route('/unit/:id', () => import('./views/units.js').then((m) => ({ default: m.unitOverviewView })));
route('/unit/:id/step/:step', () => import('./views/activity.js'), { mode: 'focus' });
route('/review', () => import('./views/review.js'));
route('/settings', () => import('./views/settings.js'));
route('/t', () => import('./views/teacher.js').then((m) => ({ default: m.teacherHomeView })), { teacher: true });
route('/t/class/:id', () => import('./views/teacher.js').then((m) => ({ default: m.classView })), { teacher: true });
route('/t/class/:id/items', () => import('./views/teacher.js').then((m) => ({ default: m.itemStatsView })), { teacher: true });
route('/t/student/:id', () => import('./views/teacher.js').then((m) => ({ default: m.studentView })), { teacher: true });
route('/t/submission/:id', () => import('./views/teacher.js').then((m) => ({ default: m.submissionView })), { teacher: true });
route('/t/content', () => import('./views/editor.js').then((m) => ({ default: m.contentListView })), { teacher: true });
route('/t/content/:id', () => import('./views/editor.js').then((m) => ({ default: m.unitEditorView })), { teacher: true });

// ---- 起動 ----
async function boot() {
  // キーボード表示中は固定フッターを隠し、入力欄と提出ボタンが隠れないようにする
  const KBD = 'input[type=text], input[type=password], input[type=number], input:not([type]), textarea';
  document.addEventListener('focusin', (e) => { if (e.target.matches?.(KBD)) document.body.classList.add('kbd-open'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.matches?.(KBD)) document.body.classList.remove('kbd-open'); }, 50));
  window.addEventListener('hashchange', render);
  window.addEventListener('auth-expired', () => { toast('ログインの有効期限が切れました。もう一度ログインしてください。', 'error'); state.me = null; render(); });
  onNetChange(renderNet);
  onOutboxResult((item, r) => { if (r.status === 'error') toast(`「${item.label}」を保存できませんでした: ${r.error.message}`, 'error'); });
  try { await refreshMe(); } catch {
    replace(main(), h('div', { class: 'card error-card', role: 'alert' }, h('p', null, 'サーバーに接続できませんでした。通信状態を確認して再読み込みしてください。'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, '再読み込み')));
    return;
  }
  renderNet(netState());
  if (state.me) flushOutbox();
  if (!location.hash || location.hash === '#/') location.replace(state.me ? (isTeacher() ? '#/t' : '#/home') : '#/login');
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
