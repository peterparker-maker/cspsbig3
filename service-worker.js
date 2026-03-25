const CACHE_NAME = 'changxing-english-v2';

const FILES_TO_CACHE = [
  './index.html',
  './grade5-vocab.html',
  './grade5-phonics.html',
  './sentence_game_v3.html',
  './grade6-vocab.html',
  './grade6-phonics.html',
  './grade6_sentence_game.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// 安裝：預先快取所有檔案
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// 啟用：清除舊版快取
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }))
    )
  );
  self.clients.claim();
});

// ── 核心策略：網路優先，快取備援 ──
self.addEventListener('fetch', event => {
  // 只處理 GET 請求
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // 有網路：拿到最新檔案，同時更新快取
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // 無網路：從快取拿上次儲存的版本
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) return cachedResponse;
          // 連快取都沒有時，回傳首頁
          return caches.match('./index.html');
        });
      })
  );
});
