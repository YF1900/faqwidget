// Service Worker: アプリの画面ファイルだけをキャッシュする（ホーム画面から起動したときの表示用）
// 学習データ（/api/）はキャッシュしない。個人の回答が端末のキャッシュに残らないようにするため。
const CACHE = 'english-steps-v1';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/main.js', '/js/dom.js', '/js/api.js', '/js/local.js', '/js/media.js', '/js/components.js', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // ネットワーク優先（常に最新の画面を使う）。通信できないときだけキャッシュを使う
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});
