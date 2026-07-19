/* ============================================================
 * app.js — 初始化、hash 路由、底部 Tab 切换、首次运行预置数据
 * 用 hash 切换视图，避免 GitHub Pages 刷新 404
 * ============================================================ */
(() => {
  /** 解析 hash：'#/bean/edit/b_123' → ['bean','edit','b_123'] */
  function parseHash() {
    return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  }

  // 路由首段 → 底部 Tab 的对应关系（bean 表单归属于豆库 Tab）
  const TAB_MAP = { '': 'timeline', library: 'library', bean: 'library', entry: 'add', stats: 'stats', settings: 'settings' };

  function setActiveTab(parts) {
    const key = TAB_MAP[parts[0] || ''] || 'timeline';
    document.querySelectorAll('.tabbar a').forEach((a) => {
      a.classList.toggle('active', a.dataset.tab === key);
    });
  }

  async function render() {
    const parts = parseHash();
    setActiveTab(parts);
    try {
      await Views.render(parts);
    } catch (err) {
      console.error(err);
      document.getElementById('view').innerHTML =
        `<div class="page-error">😵 页面渲染失败：${String(err.message || err)}</div>`;
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);

  window.addEventListener('DOMContentLoaded', async () => {
    // 首次运行预置 6 个冲煮器具
    try { await Store.seed(); } catch (e) { console.warn('预置数据失败', e); }

    // PWA：注册 Service Worker，失败时静默降级（不影响任何功能）
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* 静默降级 */ });
      // 若页面此前由旧版 SW 控制，新版接管后自动刷新一次，避免一直跑旧缓存代码
      if (navigator.serviceWorker.controller) {
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return;
          reloaded = true;
          location.reload();
        });
      }
    }

    if (!location.hash) location.hash = '#/';
    render();
  });
})();
