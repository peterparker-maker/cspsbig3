// 長興國小英文學習中心 - Service Worker v3
// 目標：Lie-Fi 防禦 + 100% 離線可用性 + GitHub Pages 完全相容

// ============================================================
// 全域狀態管理：單次會話離線鎖定機制
// ============================================================
let isOfflineLocked = false;

const CACHE_NAME = 'changxing-english-v3';
const PRECACHE_FILES = [
  './',
  './index.html',
  './sentence_game_v3.html',
  './grade6_sentence_game.html',
  './grade5-vocab.html',
  './grade5-phonics.html',
  './grade6-vocab.html',
  './grade6-phonics.html',
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
      console.warn('Service Worker 預載失敗:', err);
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
            console.log('刪除舊版快取:', cacheName);
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
// 帶超時的 Fetch 輔助函式
// 使用 Promise.race 實現精密超時控制
// ============================================================
async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(request, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ============================================================
// FETCH 事件：智能策略分發
// 優先檢查離線鎖定狀態
// ============================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 僅處理 http/https 請求，忽略 chrome-extension 等
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 若已進入離線鎖定模式，直接返回快取
  if (isOfflineLocked) {
    event.respondWith(
      caches.match(request).then((response) => {
        if (response) {
          return response;
        }
        // 快取中找不到，嘗試返回首頁
        return caches.match('./index.html').then((indexResponse) => {
          return indexResponse || createOfflineResponse();
        });
      })
    );
    return;
  }

  // 判斷是否為 HTML 檔案（Network First 策略，帶精密超時）
  if (request.destination === 'document' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirstStrategyWithTimeout(request));
  }
  // 靜態資源（CSS、JS、圖片等）：Stale-While-Revalidate 策略（帶超時保護）
  else {
    event.respondWith(staleWhileRevalidateWithTimeout(request));
  }
});

// ============================================================
// Network First 策略 - 帶兩階段超時
// 第一階段 (啟動期)：index.html 或 ./ → 3000ms
// 第二階段 (執行期)：其他 HTML → 1500ms
// ============================================================
async function networkFirstStrategyWithTimeout(request) {
  // 判定超時時間：啟動期 vs 執行期
  const url = new URL(request.url);
  const isBootPhase = url.pathname === '/' || url.pathname.endsWith('index.html') || url.pathname === '';
  const timeoutMs = isBootPhase ? 3000 : 1500;

  try {
    // 嘗試從網路抓取（帶超時保護）
    const networkResponse = await fetchWithTimeout(request, timeoutMs);

    // 若請求成功，同步更新快取
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (err) {
    // 超時或網路錯誤：啟動離線鎖定機制
    console.warn('[Lie-Fi 防禦] 網路延遲或超時，啟動離線模式:', request.url, err.message);
    isOfflineLocked = true;

    // 從快取提取資源
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // 快取中也找不到：返回離線提示頁面
    return createOfflineResponse();
  }
}

// ============================================================
// Stale-While-Revalidate 策略 - 帶超時保護
// 立刻返回快取版本，同時在背景檢查更新（1500ms 超時）
// ============================================================
async function staleWhileRevalidateWithTimeout(request) {
  try {
    // 優先從快取取得版本（若有的話）
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      // 異步在背景更新快取（帶超時保護）
      updateCacheInBackgroundWithTimeout(request, 1500);
      return cachedResponse;
    }

    // 快取中沒有：從網路抓取並儲存（帶超時）
    const networkResponse = await fetchWithTimeout(request, 1500);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // 網路失敗或超時：啟動離線鎖定
    console.warn('[Lie-Fi 防禦] 靜態資源超時，啟動離線模式:', request.url);
    isOfflineLocked = true;

    // 嘗試從快取提取
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // 若沒有被請求過的資源快取，嘗試返回首頁
    const indexResponse = await caches.match('./index.html');
    if (indexResponse && request.destination === 'document') {
      return indexResponse;
    }

    return createOfflineResponse();
  }
}

// ============================================================
// 背景更新快取 - 帶超時保護
// 在不影響當前頁面的情況下，檢查並更新資源
// ============================================================
async function updateCacheInBackgroundWithTimeout(request, timeoutMs) {
  try {
    const networkResponse = await fetchWithTimeout(request, timeoutMs);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, networkResponse.clone());
    }
  } catch (err) {
    // 背景更新失敗無須處理（快取版本已提供給用戶）
    // 但若超時，也應啟動離線鎖定
    if (err.name === 'AbortError') {
      console.warn('[背景更新超時]', request.url);
      isOfflineLocked = true;
    }
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
        .info {
          font-size: 14px;
          color: #999;
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid #eee;
        }
      </style>
    </head>
    <body>
      <div class="offline-box">
        <div class="icon">📡</div>
        <h1>目前離線</h1>
        <p>網路連接中斷或不可用</p>
        <div class="info">
          <p style="margin: 5px 0;">已快取的內容仍可正常使用</p>
          <p style="margin: 5px 0; font-size: 12px;">💡 提示：若 Wi-Fi 訊號不穩定，請考慮更換位置或使用行動網路</p>
        </div>
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
