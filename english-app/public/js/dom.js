// DOM ヘルパー。文字列は常に textContent として挿入し、innerHTML は使わない（XSS 対策）
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (['value', 'checked', 'disabled', 'selected', 'hidden', 'open'].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function replace(el, ...children) { clear(el); append(el, children); return el; }

/** text の中の needle を <mark> で強調した要素配列を返す */
export function highlight(text, needles) {
  const list = (needles || []).filter(Boolean);
  if (!list.length) return [text];
  const out = []; let i = 0;
  while (i < text.length) {
    let best = -1; let len = 0;
    for (const n of list) { const p = text.indexOf(n, i); if (p !== -1 && (best === -1 || p < best)) { best = p; len = n.length; } }
    if (best === -1) { out.push(text.slice(i)); break; }
    if (best > i) out.push(text.slice(i, best));
    out.push(h('mark', { class: 'evidence' }, text.slice(best, best + len)));
    i = best + len;
  }
  return out;
}

export const LEVEL_JA = { A2: '基礎 A2', B1: '標準 B1', B2: '発展 B2' };
export const EXAM_JA = { A2: 'A2 Key for Schools', B1: 'B1 Preliminary for Schools', B2: 'B2 First for Schools', undecided: '未定' };
export const SKILL_JA = { reading: 'Reading', listening: 'Listening', writing: 'Writing', speaking: 'Speaking', vocabulary: '語彙', grammar: '文法' };
export const SKILL_ICON = { reading: '📖', listening: '🎧', writing: '✏️', speaking: '🗣️' };
export const SOURCE_JA = { default: '初期値', diagnostic: '診断の目安', student: '自分で調整', teacher: '先生が調整' };
export const KIND_JA = { intro: '目標と語彙', explain: '解説', reading: 'Reading', listening: 'Listening', writing: 'Writing', speaking: 'Speaking', check: '試験形式の確認', wrapup: 'ふり返り' };

/** 同じ種類の活動が複数ある単元では「Reading 2」のように番号を付ける */
export function kindLabel(activities, a) {
  const same = activities.filter((x) => x.kind === a.kind);
  return same.length > 1 ? `${KIND_JA[a.kind]} ${same.indexOf(same.find((x) => x.id === a.id)) + 1}` : KIND_JA[a.kind];
}

export function fmtDate(iso, withTime = true) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()}` + (withTime ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : '');
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function countWords(t) {
  return (String(t || '').trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

export function toast(msg, type = 'info') {
  const root = document.getElementById('toast');
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, msg);
  root.appendChild(el);
  setTimeout(() => el.classList.add('hide'), 3800);
  setTimeout(() => el.remove(), 4300);
}

export function pct(x) { return x == null ? '—' : `${Math.round(x * 100)}%`; }

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 確認ダイアログ（<dialog> 非対応ブラウザーでは confirm にフォールバック） */
export function confirmDialog(message, { ok = 'OK', cancel = 'キャンセル', danger = false } = {}) {
  if (typeof HTMLDialogElement !== 'function') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog', 'aria-label': '確認' },
      h('p', { class: 'dialog-msg' }, message),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => done(false) }, cancel),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => done(true) }, ok)));
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
