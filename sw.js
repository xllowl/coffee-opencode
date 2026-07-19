/* ============================================================
 * sw.js — Service Worker：应用壳离线缓存
 * 策略：静态资源缓存优先，网络成功后回写缓存；导航请求离线兜底 index.html
 * ============================================================ */
const CACHE = 'coffee-journal-v1';

// 应用壳资源（含 CDN 库，逐个缓存，单个失败不影响整体）
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/views.js',
  './js/llm.js',
  './js/image.js',
  'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4',
  'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Promise.allSettled：CDN 被拦截时静默跳过，不阻断安装
    await Promise.allSettled(ASSETS.map((u) => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 清理旧版本缓存
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // 大模型 API 均为 POST，不缓存直接放行

  e.respondWith((async () => {
    // 1) 先查缓存
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // 2) 走网络，成功则回写缓存（仅同源与 jsdelivr，避免缓存 API 响应）
    try {
      const res = await fetch(req);
      const url = new URL(req.url);
      if (res.ok && (url.origin === location.origin || url.hostname.endsWith('jsdelivr.net'))) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // 3) 离线兜底：页面导航回退到应用壳（hash 路由由前端接管）
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }
  })());
});
