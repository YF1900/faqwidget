// 端末内の一時保存（localStorage / IndexedDB）。
// - プライベートブラウズ等で使えない場合があるため、すべて try/catch で包む
// - キーはユーザーごとに分け、ログアウト時に削除する（共用端末への配慮）
let prefix = 'es:anon:';
export function setLocalUser(userId) { prefix = `es:${userId}:`; }

export const local = {
  get(key, def = null) {
    try { const v = localStorage.getItem(prefix + key); return v == null ? def : JSON.parse(v); } catch { return def; }
  },
  set(key, value) {
    try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) { try { localStorage.removeItem(prefix + key); } catch { /* 使えない環境 */ } },
  available() {
    try { localStorage.setItem('es:test', '1'); localStorage.removeItem('es:test'); return true; } catch { return false; }
  },
  clearUser(userId) {
    try {
      const p = `es:${userId}:`;
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(p)) localStorage.removeItem(k); }
    } catch { /* 使えない環境 */ }
  },
};

// ---- 録音データ（端末内の IndexedDB のみに保存。サーバーには送信しない） ----
const DB_NAME = 'english-steps';
function openIdb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB を利用できません'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recordings');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function withStore(mode, fn) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('recordings', mode);
    const store = t.objectStore('recordings');
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const recordings = {
  async save(key, blob, meta) { return withStore('readwrite', (s) => s.put({ blob, ...meta, savedAt: new Date().toISOString() }, prefix + key)); },
  async get(key) { try { return await withStore('readonly', (s) => reqP(s.get(prefix + key))); } catch { return null; } },
  async remove(key) { try { await withStore('readwrite', (s) => s.delete(prefix + key)); } catch { /* 使えない環境 */ } },
  async clearUser(userId) {
    try {
      await withStore('readwrite', async (s) => {
        const keys = await reqP(s.getAllKeys());
        for (const k of keys) if (String(k).startsWith(`es:${userId}:`)) s.delete(k);
      });
    } catch { /* 使えない環境 */ }
  },
  async count() {
    try { return await withStore('readonly', async (s) => (await reqP(s.getAllKeys())).filter((k) => String(k).startsWith(prefix)).length); } catch { return 0; }
  },
};
