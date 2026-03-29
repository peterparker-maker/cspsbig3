// ── 版本控制：使用版本號 + 固定時間戳 ──
const CACHE_VERSION = 'v5';
const CACHE_TIMESTAMP = '20260329-auto'; // 固定鍵，避免每次都新建快取
const CACHE_NAME = `changxing-english-${CACHE_VERSION}-${CACHE_TIMESTAMP}`;

// 【關鍵】獲取時間戳，每 5 秒更新一次（確保 HTML 每 5 秒拉一次最新版本）
function getVersionTimestamp() {
  return Math.floor(Date.now() / 5000); // 每 5 秒更新一次
}

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
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE).catch(() => {
      // 如果某些檔案暫時無法快取（可能網路問題），繼續進行
      console.warn('Some files could not be cached during install');
    }))
  );
  self.skipWaiting();
});

// 啟用：清除舊版快取，立即接管所有頁面
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

// ── 核心策略：網路優先（最新版本） ──
// HTML 檔案：強制每分鐘檢查一次網路（添加時間戳參數繞過快取）
// 其他資源：快取優先，但後台更新
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isHtml = event.request.destination === 'document' || url.pathname.endsWith('.html');

  event.respondWith(
    isHtml
      ? // HTML 檔案：添加時間戳參數強制拉取最新版本（每分鐘更新一次）
        (() => {
          const htmlUrl = new URL(event.request.url);
          htmlUrl.searchParams.set('v', getVersionTimestamp());
          const versionedRequest = new Request(htmlUrl, event.request);

          return fetch(versionedRequest)
            .then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, responseClone);
                });
              }
              return networkResponse;
            })
            .catch(() => {
              // 網路失敗：使用最新的快取版本
              return caches.match(event.request).then(cachedResponse => {
                return cachedResponse || caches.match('./index.html');
              });
            });
        })()
      : // 其他資源：快取優先，後台更新
        caches.match(event.request).then(cachedResponse => {
          const fetchPromise = fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return networkResponse;
          }).catch(() => null);

          return cachedResponse || fetchPromise;
        })
  );
});
