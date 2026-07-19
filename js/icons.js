/* ============================================================
 * icons.js — FontAwesome 6 免费版 CDN 加载检测与降级
 * 约定：所有图标写作 <i class="fa-solid fa-xxx" data-emo="☕"></i>
 *  - CDN 正常：渲染为可缩放矢量图标（WebFont，天然支持高 DPI）
 *  - CDN 失败：替换为 data-emo 中的 emoji 文本兜底，并全局隐藏残余
 *    空图标，避免布局错乱
 * ============================================================ */
const Icons = (() => {

  /** 探测 FA 字体是否真正就绪（::before 有字形内容且字体族已切换为 FA） */
  function probe() {
    const el = document.createElement('i');
    el.className = 'fa-solid fa-mug-hot';
    el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
    document.body.appendChild(el);
    const st = getComputedStyle(el, '::before');
    const ok = st.content !== 'none' && st.content !== 'normal' && /Font Awesome/.test(st.fontFamily);
    el.remove();
    return ok;
  }

  /**
   * 将 root（默认全文档）内的图标元素替换为 emoji 兜底文本。
   * 仅在降级模式下生效；正常模式直接返回。
   */
  function fix(root) {
    if (!document.body.classList.contains('fa-failed')) return;
    (root || document).querySelectorAll('i[data-emo]').forEach((el) => {
      el.replaceWith(document.createTextNode(el.dataset.emo));
    });
  }

  /** 进入降级模式：打标记（CSS 隐藏残余图标）+ 全量替换一次 */
  function degrade() {
    if (document.body.classList.contains('fa-failed')) return;
    document.body.classList.add('fa-failed');
    fix(document);
  }

  /** 入口：link onerror 置标记则直接降级；否则等字体就绪后探测，失败同样降级 */
  async function init() {
    if (window.__faFailed) { degrade(); return; }
    try {
      // 等 WebFont 加载落定，最多等 2.5s
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
    } catch { /* 忽略 */ }
    if (!probe()) degrade();
  }

  return { init, fix };
})();
