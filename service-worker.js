const CACHE_NAME = 'changxing-english-v1';

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

// 安裝：快取所有檔案
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 啟用：清除舊版快取
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList =>
      Promise.all(
        keyList.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// 攔截請求：優先使用快取，網路失敗時 fallback
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then(networkResponse => {
        // 動態快取新資源
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // 完全離線時回傳首頁
        return caches.match('./index.html');
      });
    })
  );
});
