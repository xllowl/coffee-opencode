/* ============================================================
 * sw.js — Service Worker：离线缓存
 * 策略：
 *  - 同源应用文件（html/js/css）：网络优先，失败回退缓存
 *    （保证代码更新能立即到达用户，不会被旧缓存卡住）
 *  - CDN 资源（jsdelivr）：缓存优先（内容稳定，减少请求）
 * 版本号CACHE 每次发布更新，activate 时清理旧缓存
 * ============================================================ */
const CACHE = 'coffee-journal-v2';

// 预缓存清单（CDN 部分；同源文件走网络优先 + 运行时缓存）
const ASSETS = [
  'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4',
  'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Promise.allSettled：CDN 被拦截时静默跳过，不阻断安装
    await Promise.allSettled(ASSETS.map((u) => cache.add(u)));
    self.skipWaiting(); // 立即接管，不等旧 SW 退出
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 清理所有旧版本缓存（包括 v1 那份有 bug 的代码）
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // 大模型 API 均为 POST，不缓存直接放行
  const url = new URL(req.url);

  // CDN 资源：缓存优先，未命中则网络并回写
  if (url.hostname.endsWith('jsdelivr.net')) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    })());
    return;
  }

  // 同源应用文件：网络优先，离线回退缓存；导航请求离线兜底 index.html
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw err;
      }
    })());
  }
  // 其他跨域 GET：直接放行（不干预）
});
