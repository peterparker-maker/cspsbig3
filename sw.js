// 長興國小英文學習中心 - Service Worker
// 目標：穩定的離線功能 + GitHub 更新立即生效

const CACHE_NAME = 'changxing-english-v1';
const PRECACHE_FILES = [
  './',
  './index.html',
  './sentence_game_v3.html',
  './grade6_sentence_game.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ============================================================
// INSTALL 事件：預載資源並立即接管
// ============================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_FILES).then(() => {
        // 立即接管新版本，無須等待學生關閉分頁
        return self.skipWaiting();
      });
    }).catch((err) => {
      // 若預載失敗，仍允許 Service Worker 安裝（後續可從網路取得）
    })
  );
});

// ============================================================
// ACTIVATE 事件：清理舊版快取並立即控制所有客戶端
// ============================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    // 遍歷所有快取並刪除舊版本
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // 立即控制所有頁面（不須等待下次頁面載入）
      return self.clients.claim();
    })
  );
});

// ============================================================
// FETCH 事件：智能策略分發
// ============================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 僅處理 http/https 請求，忽略 chrome-extension 等
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 判斷是否為 HTML 檔案（Network First 策略）
  if (request.destination === 'document' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirstStrategy(request));
  }
  // 靜態資源（CSS、JS、圖片等）：Stale-While-Revalidate 策略
  else {
    event.respondWith(staleWhileRevalidateStrategy(request));
  }
});

// ============================================================
// Network First 策略（HTML 檔案）
// 優先嘗試從網路抓取最新版本，失敗時才用快取
// ============================================================
async function networkFirstStrategy(request) {
  const cacheKey = new URL(request.url).pathname;

  try {
    // 從網路抓取最新版本（不添加任何時間戳參數）
    const networkResponse = await fetch(request);

    // 若請求成功，同步更新快取
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, networkResponse.clone());
    }

    return networkResponse;
  } catch (err) {
    // 網路失敗：從快取提取最後儲存的版本
    const cachedResponse = await caches.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    // 快取中也找不到：返回離線提示頁面
    return createOfflineResponse();
  }
}

// ============================================================
// Stale-While-Revalidate 策略（靜態資源）
// 立刻返回快取版本，同時在背景檢查更新
// ============================================================
async function staleWhileRevalidateStrategy(request) {
  const cacheKey = new URL(request.url).pathname;

  try {
    // 從快取取得版本（若有的話）
    const cachedResponse = await caches.match(cacheKey);
    if (cachedResponse) {
      // 異步在背景更新快取（不阻止當前響應）
      updateCacheInBackground(request, cacheKey);
      return cachedResponse;
    }

    // 快取中沒有：從網路抓取並儲存
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // 網路失敗且無快取：返回通用離線回應
    return createOfflineResponse();
  }
}

// ============================================================
// 背景更新快取
// 在不影響當前頁面的情況下，檢查並更新資源
// ============================================================
async function updateCacheInBackground(request, cacheKey) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, networkResponse.clone());
    }
  } catch (err) {
    // 背景更新失敗無須處理（快取版本已提供給用戶）
  }
}

// ============================================================
// 離線回應
// 當網路不可用且快取中無資源時返回此頁面
// ============================================================
function createOfflineResponse() {
  return new Response(
    `<!DOCTYPE html>
    <html lang="zh-TW">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>離線提示</title>
      <style>
        body {
          font-family: 'Microsoft JhengHei', sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          margin: 0;
        }
        .offline-box {
          text-align: center;
          background: white;
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
          max-width: 400px;
        }
        .icon {
          font-size: 60px;
          margin-bottom: 20px;
        }
        h1 {
          color: #333;
          font-size: 24px;
          margin: 0 0 10px;
        }
        p {
          color: #666;
          line-height: 1.6;
          margin: 10px 0;
        }
      </style>
    </head>
    <body>
      <div class="offline-box">
        <div class="icon">📡</div>
        <h1>目前離線</h1>
        <p>無法連接網路，請檢查您的網際網路連接</p>
        <p style="font-size: 14px; color: #999;">請重新整理頁面重試</p>
      </div>
    </body>
    </html>`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    }
  );
}
