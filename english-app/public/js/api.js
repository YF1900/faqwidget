// サーバー通信と「未送信の回答」の管理（アウトボックス）
// - 回答は送信前に端末へ一時保存し、サーバーの応答を受け取ってから「保存済み」とする
// - 通信できない場合は端末に残し、通信回復時・再送ボタンで送り直す
// - 各回答には clientId（UUID）を付け、サーバー側で重複登録を防ぐ（二重提出対策）
import { local } from './local.js';

export class ApiError extends Error {
  constructor(message, { status = 0, offline = false, details } = {}) { super(message); this.status = status; this.offline = offline; this.details = details; }
}

const listeners = new Set();
export function onNetChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { const s = netState(); for (const fn of listeners) fn(s); }

let lastFailure = false;
export function netState() {
  return { online: navigator.onLine !== false && !lastFailure, pending: outbox().length };
}

async function request(method, path, body) {
  let res;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin', signal: ctrl.signal,
      headers: body !== undefined ? { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' } : { 'X-Requested-With': 'fetch' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    if (!lastFailure) { lastFailure = true; emit(); }
    throw new ApiError('通信できませんでした。電波の状態を確認してください。', { offline: true });
  } finally { clearTimeout(timer); }
  if (lastFailure) { lastFailure = false; emit(); }
  let data = null;
  try { data = await res.json(); } catch { /* 空の応答 */ }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/me' && path !== '/api/auth/login') window.dispatchEvent(new CustomEvent('auth-expired'));
    throw new ApiError(data?.error || `エラーが発生しました（${res.status}）`, { status: res.status, details: data?.details });
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body = {}) => request('PUT', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),
  del: (path) => request('DELETE', path, {}),
};

// ---------------- アウトボックス ----------------
function outbox() { return local.get('outbox', []); }
function saveOutbox(items) { local.set('outbox', items); emit(); }

/**
 * 回答を確実に送る。戻り値:
 *  { status: 'saved', data } サーバー保存済み
 *  { status: 'queued' }      端末に一時保存（未送信）。通信回復後に再送
 *  { status: 'error', error } 送信内容に問題があり保存できなかった（再送しない）
 */
export async function submitReliably(method, path, body, label) {
  const item = { id: body.clientId, method, path, body, label, createdAt: new Date().toISOString() };
  const items = outbox();
  if (!items.some((i) => i.id === item.id)) { items.push(item); saveOutbox(items); }
  return sendItem(item);
}

const inflight = new Map();
function sendItem(item) {
  if (inflight.has(item.id)) return inflight.get(item.id);
  const p = (async () => {
    try {
      const data = await request(item.method, item.path, item.body);
      removeItem(item.id);
      return { status: 'saved', data };
    } catch (e) {
      if (e.offline || e.status >= 500 || e.status === 429) return { status: 'queued', error: e };
      if (e.status === 401) return { status: 'queued', error: e }; // 再ログイン後に再送
      removeItem(item.id);
      return { status: 'error', error: e };
    } finally { inflight.delete(item.id); }
  })();
  inflight.set(item.id, p);
  return p;
}
function removeItem(id) { saveOutbox(outbox().filter((i) => i.id !== id)); }

const resultListeners = new Set();
export function onOutboxResult(fn) { resultListeners.add(fn); return () => resultListeners.delete(fn); }

let flushing = false;
export async function flushOutbox() {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0; let failed = 0;
  try {
    for (const item of outbox()) {
      const r = await sendItem(item);
      if (r.status === 'saved') { sent++; for (const fn of resultListeners) fn(item, r); } else if (r.status === 'queued') { failed++; break; } else { for (const fn of resultListeners) fn(item, r); }
    }
  } finally { flushing = false; emit(); }
  return { sent, failed };
}
export function pendingItems() { return outbox(); }

window.addEventListener('online', () => { lastFailure = false; emit(); flushOutbox(); });
window.addEventListener('offline', emit);
