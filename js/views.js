/* ============================================================
 * views.js — 各页面渲染逻辑
 * 时间线 / 豆库（豆子·器具·磨豆机）/ 豆子表单（拍照识别）/
 * 冲煮向导（三步）/ 统计 / 设置
 * ============================================================ */
const Views = (() => {

  /* ================= 通用工具 ================= */
  const $  = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStr = () => fmtDate(new Date());
  const num = (v, dft = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : dft; };
  const view = () => document.getElementById('view');

  const TYPE_LABEL = { 'pour-over': '手冲', espresso: '意式', immersion: '浸泡', 'cold-brew': '冷萃' };
  const MILL_TYPE_LABEL = { hand: '手摇', electric: '电动' };
  const ROASTS = ['浅烘', '中浅烘', '中烘', '中深烘', '深烘'];
  const PROCESSES = ['水洗', '日晒', '蜜处理', '厌氧日晒', '酒桶发酵', '湿刨', '其他'];
  const MOODS = ['😍', '😀', '🙂', '😐', '😞', '🥱', '😴', '🤒'];
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  const prettyDate = (ds) => {
    const d = new Date(ds + 'T00:00:00');
    return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
  };

  /** 解析 'm:ss' 或 '秒数' 为秒；无法解析返回 null */
  function parseTimeToSec(s) {
    if (s == null || s === '') return null;
    const m = String(s).trim().match(/^(?:(\d+):)?(\d{1,3})$/);
    if (!m) return null;
    return (m[1] ? +m[1] * 60 : 0) + (+m[2]);
  }
  const secToStr = (sec) => `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;

  /** 养豆信息：≤7 养豆期 / 8-45 最佳赏味期 / >45 尽快喝完；无 roastDate 返回 null */
  function ageInfo(bean) {
    if (!bean.roastDate) return null;
    const days = Math.floor((new Date(todayStr()) - new Date(bean.roastDate + 'T00:00:00')) / 86400000);
    if (!Number.isFinite(days)) return null;
    let label, cls;
    if (days <= 7)       { label = '养豆期';     cls = 'age-rest'; }
    else if (days <= 45) { label = '最佳赏味期'; cls = 'age-best'; }
    else                 { label = '尽快喝完';   cls = 'age-old'; }
    return { days: Math.max(days, 0), label, cls };
  }

  /** 粉水比文本（espresso 保存时 water 已同步为液重，故统一用 water/dose） */
  function ratioText(e) {
    const dose = num(e.brew?.dose), water = num(e.brew?.water);
    if (!dose || !water) return '—';
    return '1:' + (water / dose).toFixed(1);
  }

  /* ================= Toast / 弹窗 ================= */
  let toastTimer = null;
  function toast(msg, ms = 2400) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /** 确认弹窗（Promise<boolean>），danger=true 时确认键为红色 */
  function confirmDlg(text, { danger = false, okText = '确认' } = {}) {
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML = `
        <div class="modal">
          <p class="modal-text">${esc(text)}</p>
          <div class="modal-btns">
            <button class="btn" data-act="no">取消</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(okText)}</button>
          </div>
        </div>`;
      mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.dataset.act) {
          const ok = e.target.dataset?.act === 'ok';
          mask.remove();
          resolve(ok);
        }
      });
      document.body.appendChild(mask);
    });
  }

  /** 表单弹窗：点保存 resolve(mask)（调用方读取输入后自行 mask.remove()），取消 resolve(null) */
  function formModal(title, bodyHtml) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">${esc(title)}</h3>
        ${bodyHtml}
        <div class="modal-btns">
          <button class="btn" data-act="no">取消</button>
          <button class="btn btn-primary" data-act="ok">保存</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    return new Promise((resolve) => {
      mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.dataset.act === 'no') { mask.remove(); resolve(null); }
        else if (e.target.dataset.act === 'ok') { resolve(mask); }
      });
    });
  }

  /* ================= 图表 / 计时器清理 ================= */
  let charts = [];
  let timers = [];
  let mapResize = null; // 地图页的窗口resize监听，离开视图时移除
  function cleanup() {
    charts.forEach((c) => { try { c.destroy(); } catch { /* 忽略 */ } });
    charts = [];
    timers.forEach((t) => clearInterval(t));
    timers = [];
    if (mapResize) { window.removeEventListener('resize', mapResize); mapResize = null; }
  }

  /**
   * Chart.js 安全创建：CDN 加载失败或初始化出错时返回 null 并给出占位提示，
   * 绝不让图表问题阻断表单等核心功能
   */
  function safeChart(canvas, config) {
    if (typeof Chart === 'undefined' || !canvas) {
      canvas?.closest('.radar-wrap, .chart-box')?.insertAdjacentHTML(
        'beforeend', '<div style="text-align:center;color:var(--muted);font-size:13px;padding:40px 0;">图表组件未加载，不影响记录功能</div>');
      return null;
    }
    try {
      const c = new Chart(canvas, config);
      charts.push(c);
      return c;
    } catch (err) {
      console.warn('图表初始化失败', err);
      return null;
    }
  }

  /* ================= 1. 首页 · 手账时间线 ================= */
  async function timeline() {
    const [entries, beans, preps, visits] = await Promise.all([
      Store.entries.getAll(), Store.beans.getAll(), Store.preparations.getAll(), Store.visits.getAll(),
    ]);
    const beanMap = Object.fromEntries(beans.map((b) => [b.id, b]));
    const prepMap = Object.fromEntries(preps.map((p) => [p.id, p]));

    // 合并时间线：冲煮记录 + 探店记录，按日期倒序、同日按创建时间倒序
    const items = [
      ...entries.map((e) => ({ kind: 'brew', date: e.date, createdAt: e.createdAt, data: e })),
      ...visits.map((v) => ({ kind: 'visit', date: v.date, createdAt: v.createdAt, data: v })),
    ].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt - a.createdAt));

    view().innerHTML = `
      <section class="page">
        ${heatmapHtml(entries)}
        <div class="hero-row">
          <a class="btn-hero" href="#/entry/new" style="text-decoration:none;text-align:center;">☕ 今日冲一杯</a>
          <a class="btn-hero btn-hero-visit" href="#/visit/new" style="text-decoration:none;text-align:center;">🏪 探店打卡</a>
        </div>
        ${items.length ? items.map((it) => it.kind === 'brew' ? entryCard(it.data, beanMap, prepMap) : visitCard(it.data)).join('') : emptyHtml('还没有记录，冲第一杯吧 ☕')}
      </section>`;

    // 点击卡片进入编辑（冲煮 / 探店分别跳转）
    $$('.entry-card').forEach((card) => {
      card.addEventListener('click', () => {
        location.hash = (card.dataset.kind === 'visit' ? '#/visit/edit/' : '#/entry/edit/') + card.dataset.id;
      });
    });
  }

  function emptyHtml(text) {
    return `<div class="empty"><span class="emo">📔</span>${esc(text)}</div>`;
  }

  /** 近 12 周冲煮日历热力图（纯 CSS grid，7 行 × 12 列，列=周） */
  function heatmapHtml(entries) {
    const counts = {};
    entries.forEach((e) => { counts[e.date] = (counts[e.date] || 0) + 1; });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - 7 * 12 + 1);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // 起点对齐到周一
    const cells = [];
    for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const key = fmtDate(d);
      const c = counts[key] || 0;
      const lv = c === 0 ? 0 : c >= 4 ? 4 : c; // 0/1/2/3/4+ 五档
      cells.push(`<div class="hm-cell hm-${lv}" title="${key} · ${c} 杯"></div>`);
    }
    return `<div class="heatmap card"><div class="hm-title">近 12 周</div><div class="hm-grid">${cells.join('')}</div></div>`;
  }

  function entryCard(e, beanMap, prepMap) {
    const b = beanMap[e.beanId];
    const p = prepMap[e.preparationId];
    const notes = (e.tasting?.notes || '').trim();
    return `
      <article class="card entry-card" data-kind="brew" data-id="${e.id}">
        <div class="ec-head">
          <span class="ec-date">${esc(prettyDate(e.date))}</span>
          <span class="ec-mood">${esc(e.mood || '')}</span>
        </div>
        <div class="ec-bean">${esc(b ? b.name : '（豆子已删除）')}</div>
        <div class="ec-meta">${esc(p ? p.name : '—')} · 粉水比 ${ratioText(e)} · 粉 ${num(e.brew?.dose) || '-'}g</div>
        <div class="ec-foot">
          <span class="ec-score">★ ${e.tasting?.score ?? '—'}</span>
          ${notes ? `<span class="ec-notes">${esc(notes)}</span>` : ''}
        </div>
      </article>`;
  }

  /** 探店卡片：店名 + 品种胶囊 + 评分/价格 */
  function visitCard(v) {
    const notes = (v.notes || '').trim();
    return `
      <article class="card entry-card" data-kind="visit" data-id="${v.id}">
        <div class="ec-head">
          <span class="ec-date">${esc(prettyDate(v.date))}</span>
          <span class="ec-mood">${esc(v.mood || '')}</span>
        </div>
        <div class="ec-main-row">
          ${v.photo ? `<img class="vc-photo" src="${v.photo}" alt="">` : ''}
          <div class="ec-main">
            <div class="ec-bean">🏪 ${esc(v.shopName)}</div>
            <div class="ec-meta">
              <span class="pill pill-visit">${esc(v.drinkType || '其他')}</span>${esc(v.drinkName || '')}${v.price != null ? ` · ¥${v.price}` : ''}
            </div>
          </div>
        </div>
        <div class="ec-foot">
          <span class="ec-score">★ ${v.rating ?? '—'}</span>
          ${notes ? `<span class="ec-notes">${esc(notes)}</span>` : ''}
        </div>
      </article>`;
  }

  /* ================= 2. 豆库页 ================= */
  async function library(tab = 'beans') {
    if (!['beans', 'preps', 'mills'].includes(tab)) tab = 'beans';
    const tabs = `
      <div class="subtabs">
        <a href="#/library/beans" class="${tab === 'beans' ? 'active' : ''}">豆子</a>
        <a href="#/library/preps" class="${tab === 'preps' ? 'active' : ''}">器具</a>
        <a href="#/library/mills" class="${tab === 'mills' ? 'active' : ''}">磨豆机</a>
      </div>`;
    if (tab === 'beans')      await libBeans(tabs);
    else if (tab === 'preps') await libPreps(tabs);
    else                      await libMills(tabs);
  }

  /* ---- 豆子 Tab ---- */
  async function libBeans(tabs) {
    const beans = (await Store.beans.getAll()).sort((a, b) => b.createdAt - a.createdAt);
    // 核心业务规则 5：按 status 分「在喝」「已喝完」两组，已喝完折叠在底部
    const active = beans.filter((b) => b.status !== 'finished');
    const finished = beans.filter((b) => b.status === 'finished');

    view().innerHTML = `
      <section class="page">
        ${tabs}
        <a class="btn btn-primary btn-block" href="#/bean/new" style="text-align:center;text-decoration:none;margin-bottom:12px;">＋ 添加豆子</a>
        ${active.length ? active.map(beanCard).join('') : emptyHtml('豆库空空如也，去添一支豆子吧 🫘')}
        ${finished.length ? `
          <details class="finished-wrap">
            <summary>已喝完（${finished.length}）</summary>
            ${finished.map(beanCard).join('')}
          </details>` : ''}
      </section>`;

    // 事件委托：编辑 / 删除（用 onclick 赋值，避免重复渲染时累加监听器）
    view().onclick = async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.closest('.bean-card').dataset.id;
      if (btn.dataset.act === 'edit') {
        location.hash = '#/bean/edit/' + id;
      } else if (btn.dataset.act === 'del') {
        const bean = await Store.beans.get(id);
        // 删除二次确认
        if (await confirmDlg(`确定删除「${bean?.name || ''}」吗？相关冲煮记录会保留。`, { danger: true, okText: '删除' })) {
          await Store.beans.remove(id);
          toast('已删除');
          library('beans');
        }
      }
    };
  }

  function beanCard(b) {
    const age = ageInfo(b);
    const pct = b.totalWeight > 0 ? Math.max(0, Math.min(100, (num(b.remainingWeight) / b.totalWeight) * 100)) : 0;
    return `
      <article class="card bean-card" data-id="${b.id}">
        ${b.cardPhoto
          ? `<img class="bc-photo" src="${b.cardPhoto}" alt="">`
          : `<div class="bc-photo bc-no-photo">🫘</div>`}
        <div class="bc-body">
          <div class="bc-name">${esc(b.name)}</div>
          <div class="bc-origin">${esc([b.origin, b.region].filter(Boolean).join(' · ') || '—')}</div>
          <div class="bc-pills">
            ${b.process ? `<span class="pill pill-process">${esc(b.process)}</span>` : ''}
            ${b.roastLevel ? `<span class="pill pill-roast">${esc(b.roastLevel)}</span>` : ''}
            ${age ? `<span class="pill ${age.cls}">烘焙后第 ${age.days} 天 · ${age.label}</span>` : ''}
          </div>
          <div class="bc-progress"><div class="bc-progress-bar" style="width:${pct}%"></div></div>
          <div class="bc-remain">剩余 ${Math.round(num(b.remainingWeight))} / ${num(b.totalWeight)} g</div>
        </div>
        <div class="bc-actions">
          <button class="btn btn-mini" data-act="edit">编辑</button>
          <button class="btn btn-mini btn-danger" data-act="del">删除</button>
        </div>
      </article>`;
  }

  /* ---- 器具 Tab ---- */
  async function libPreps(tabs) {
    const list = (await Store.preparations.getAll()).sort((a, b) => Number(a.isArchived) - Number(b.isArchived));
    view().innerHTML = `
      <section class="page">
        ${tabs}
        <button class="btn btn-primary btn-block" id="btn-add" style="margin-bottom:12px;">＋ 添加器具</button>
        <div class="card">
          ${list.length ? list.map((p) => `
            <div class="list-row ${p.isArchived ? 'is-archived' : ''}" data-id="${p.id}">
              <span class="lr-name">${esc(p.name)}</span>
              <span class="pill pill-type">${TYPE_LABEL[p.type] || p.type}</span>
              ${p.isArchived ? '<span class="pill pill-archived">已归档</span>' : ''}
              <button class="btn btn-mini" data-act="edit">编辑</button>
              <button class="btn btn-mini" data-act="arch">${p.isArchived ? '恢复' : '归档'}</button>
              <button class="btn btn-mini btn-danger" data-act="del">删除</button>
            </div>`).join('') : emptyHtml('还没有器具')}
        </div>
      </section>`;

    $('#btn-add').addEventListener('click', () => prepModal(null));
    view().onclick = async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.closest('.list-row').dataset.id;
      const p = await Store.preparations.get(id);
      if (!p) return;
      if (btn.dataset.act === 'edit') prepModal(p);
      else if (btn.dataset.act === 'arch') { p.isArchived = !p.isArchived; await Store.preparations.put(p); libPreps(tabs); }
      else if (btn.dataset.act === 'del' && await confirmDlg(`确定删除「${p.name}」吗？`, { danger: true, okText: '删除' })) {
        await Store.preparations.remove(id); toast('已删除'); libPreps(tabs);
      }
    };
  }

  /** 器具 新增/编辑 弹窗 */
  async function prepModal(p) {
    const isNew = !p;
    p = p || { id: 'p_' + Date.now(), name: '', type: 'pour-over', isArchived: false };
    const mask = await formModal(isNew ? '添加器具' : '编辑器具', `
      <label class="f-label">名称<input id="m-name" class="input" value="${esc(p.name)}" placeholder="如 V60 02 树脂"></label>
      <label class="f-label">类型
        <select id="m-type" class="input">
          ${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>`);
    if (!mask) return;
    const name = $('#m-name', mask).value.trim();
    p.type = $('#m-type', mask).value;
    mask.remove();
    if (!name) { toast('请填写名称'); return; }
    p.name = name;
    await Store.preparations.put(p);
    toast('已保存');
    library('preps');
  }

  /* ---- 磨豆机 Tab ---- */
  async function libMills(tabs) {
    const list = (await Store.mills.getAll()).sort((a, b) => Number(a.isArchived) - Number(b.isArchived));
    view().innerHTML = `
      <section class="page">
        ${tabs}
        <button class="btn btn-primary btn-block" id="btn-add" style="margin-bottom:12px;">＋ 添加磨豆机</button>
        <div class="card">
          ${list.length ? list.map((m) => `
            <div class="list-row ${m.isArchived ? 'is-archived' : ''}" data-id="${m.id}">
              <span class="lr-name">${esc(m.name)}</span>
              <span class="pill pill-type">${MILL_TYPE_LABEL[m.type] || m.type}</span>
              ${m.isArchived ? '<span class="pill pill-archived">已归档</span>' : ''}
              <button class="btn btn-mini" data-act="edit">编辑</button>
              <button class="btn btn-mini btn-danger" data-act="del">删除</button>
            </div>`).join('') : emptyHtml('还没有磨豆机')}
        </div>
      </section>`;

    $('#btn-add').addEventListener('click', () => millModal(null));
    view().onclick = async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.closest('.list-row').dataset.id;
      const m = await Store.mills.get(id);
      if (!m) return;
      if (btn.dataset.act === 'edit') millModal(m);
      else if (btn.dataset.act === 'del' && await confirmDlg(`确定删除「${m.name}」吗？`, { danger: true, okText: '删除' })) {
        await Store.mills.remove(id); toast('已删除'); libMills(tabs);
      }
    };
  }

  /** 磨豆机 新增/编辑 弹窗 */
  async function millModal(m) {
    const isNew = !m;
    m = m || { id: 'm_' + Date.now(), name: '', type: 'hand', isArchived: false };
    const mask = await formModal(isNew ? '添加磨豆机' : '编辑磨豆机', `
      <label class="f-label">名称<input id="m-name" class="input" value="${esc(m.name)}" placeholder="如 C40 MK4"></label>
      <label class="f-label">类型
        <select id="m-type" class="input">
          ${Object.entries(MILL_TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${m.type === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>`);
    if (!mask) return;
    const name = $('#m-name', mask).value.trim();
    m.type = $('#m-type', mask).value;
    mask.remove();
    if (!name) { toast('请填写名称'); return; }
    m.name = name;
    await Store.mills.put(m);
    toast('已保存');
    library('mills');
  }

  /* ================= 3. 豆子表单（拍照识别） ================= */
  async function beanForm(id) {
    const editing = id ? await Store.beans.get(id) : null;
    let cardPhoto = editing?.cardPhoto || null; // 压缩后的 base64，同时用于识别与存储
    let tags = [...(editing?.flavorNotes || [])];

    const selOpts = (arr, cur) =>
      `<option value="">请选择</option>` + arr.map((v) => `<option ${cur === v ? 'selected' : ''}>${v}</option>`).join('');

    view().innerHTML = `
      <section class="page">
        <h2 class="page-title">${editing ? '编辑豆子' : '添加豆子'}</h2>

        <button type="button" class="btn-photo" id="btn-photo">📷 拍摄咖啡卡片识别</button>
        <input type="file" id="file-photo" accept="image/*" capture="environment" hidden>
        <div id="recog-status"></div>
        <div id="photo-preview">${cardPhoto ? `<img src="${cardPhoto}" alt="卡片照片">` : ''}</div>

        <form id="bean-form" class="form card" novalidate>
          <label class="f-label">名称 *<input name="name" required value="${esc(editing?.name || '')}" placeholder="如 埃塞俄比亚 耶加雪菲"></label>
          <div class="f-row">
            <label class="f-label">产地国家<input name="origin" value="${esc(editing?.origin || '')}"></label>
            <label class="f-label">产区 / 庄园<input name="region" value="${esc(editing?.region || '')}"></label>
          </div>
          <div class="f-row">
            <label class="f-label">豆种<input name="variety" value="${esc(editing?.variety || '')}"></label>
            <label class="f-label">海拔<input name="altitude" value="${esc(editing?.altitude || '')}" placeholder="如 1800-2000m"></label>
          </div>
          <div class="f-row">
            <label class="f-label">烘焙度
              <select name="roastLevel">${selOpts(ROASTS, editing?.roastLevel)}</select>
            </label>
            <label class="f-label">处理法
              <select name="process">${selOpts(PROCESSES, editing?.process)}</select>
            </label>
          </div>
          <div class="f-row">
            <label class="f-label">烘焙商 / 品牌<input name="roaster" value="${esc(editing?.roaster || '')}"></label>
            <label class="f-label">烘焙日期<input name="roastDate" type="date" value="${esc(editing?.roastDate || '')}"></label>
          </div>
          <div class="f-row">
            <label class="f-label">购入克数 g *<input name="totalWeight" type="number" inputmode="decimal" min="0" value="${editing ? num(editing.totalWeight) : ''}" placeholder="如 200"></label>
            <label class="f-label">价格 ¥<input name="price" type="number" inputmode="decimal" min="0" value="${editing?.price ?? ''}"></label>
          </div>
          ${editing ? `<label class="f-label">剩余克数 g<input name="remainingWeight" type="number" inputmode="decimal" min="0" value="${num(editing.remainingWeight)}"></label>` : ''}
          <label class="f-label">风味标签（回车添加）
            <div class="tag-box" id="tag-box">
              ${tags.map((t, i) => tagChip(t, i)).join('')}
              <input id="tag-input" placeholder="如 茉莉花香，回车添加">
            </div>
          </label>
          <button type="submit" class="btn btn-primary btn-block" style="padding:14px;font-size:16px;">保存</button>
        </form>
      </section>`;

    /* ---- 风味标签 ---- */
    const tagBox = $('#tag-box');
    const tagInput = $('#tag-input');
    function tagChip(t, i) {
      return `<span class="tag-chip">${esc(t)}<button type="button" data-i="${i}">×</button></span>`;
    }
    function redrawTags() {
      $$('.tag-chip', tagBox).forEach((c) => c.remove());
      tags.forEach((t, i) => tagInput.insertAdjacentHTML('beforebegin', tagChip(t, i)));
    }
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = tagInput.value.trim();
        if (v) { tags.push(v); tagInput.value = ''; redrawTags(); }
      }
    });
    tagBox.addEventListener('click', (e) => {
      if (e.target.dataset.i != null) { tags.splice(+e.target.dataset.i, 1); redrawTags(); }
    });

    /* ---- 拍照识别流程 ---- */
    const status = $('#recog-status');
    $('#btn-photo').addEventListener('click', () => $('#file-photo').click());
    $('#file-photo').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = ''; // 允许重选同一文件
      if (!file) return;
      try {
        status.innerHTML = `<div class="recog-loading">正在压缩照片</div>`;
        // 1) canvas 压缩：最长边 1280px，JPEG 0.8
        cardPhoto = await ImageUtil.compress(file);
        $('#photo-preview').innerHTML = `<img src="${cardPhoto}" alt="卡片照片">`;
        await runRecognize(); // 2) 调大模型识别
      } catch (err) {
        showRecogError(err);
      }
    });

    async function runRecognize() {
      try {
        status.innerHTML = `<div class="recog-loading">🔍 大模型识别中</div>`;
        const info = await LLM.recognize(cardPhoto);
        fillForm(info); // 3) 解析 JSON → 回填表单（由用户确认后再保存，禁止直接入库）
        status.innerHTML = `<div class="recog-ok">✅ 识别完成，请核对表单后再保存</div>`;
      } catch (err) {
        showRecogError(err);
      }
    }

    function showRecogError(err) {
      status.innerHTML = `<div class="recog-error">❌ ${esc(err.message || '识别失败')}
        <button type="button" class="btn btn-mini" id="btn-retry" style="margin-left:8px;">重试</button></div>`;
      $('#btn-retry')?.addEventListener('click', () => { if (cardPhoto) runRecognize(); });
    }

    /** 识别结果回填：仅覆盖模型返回的非空字段 */
    function fillForm(info) {
      const f = $('#bean-form');
      const setVal = (name, v) => { if (v != null && v !== '') f.elements[name].value = v; };
      setVal('name', info.name);
      setVal('origin', info.origin);
      setVal('region', info.region);
      setVal('variety', info.variety);
      setVal('altitude', info.altitude);
      setVal('roaster', info.roaster);
      setVal('roastDate', info.roastDate);
      // 烘焙度 / 处理法：归一化到下拉枚举（处理法可能返回 "其他(注明)"）
      if (info.roastLevel) {
        const hit = ROASTS.find((r) => String(info.roastLevel).includes(r));
        if (hit) f.elements.roastLevel.value = hit;
      }
      if (info.process) {
        const hit = PROCESSES.find((p) => String(info.process).includes(p));
        f.elements.process.value = hit || '其他';
      }
      if (Array.isArray(info.flavorNotes) && info.flavorNotes.length) {
        tags = [...new Set([...tags, ...info.flavorNotes.filter(Boolean)].map(String))];
        redrawTags();
      }
    }

    /* ---- 保存 ---- */
    $('#bean-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const name = f.elements.name.value.trim();
      const totalWeight = num(f.elements.totalWeight.value);
      if (!name) { toast('请填写豆子名称'); return; }
      if (!(totalWeight > 0)) { toast('请填写购入克数'); return; }
      const orNull = (v) => (v && String(v).trim() !== '' ? String(v).trim() : null);
      const bean = {
        id: editing?.id || 'b_' + Date.now(),
        name,
        origin: orNull(f.elements.origin.value),
        region: orNull(f.elements.region.value),
        variety: orNull(f.elements.variety.value),
        roastLevel: orNull(f.elements.roastLevel.value),
        process: orNull(f.elements.process.value),
        altitude: orNull(f.elements.altitude.value),
        roaster: orNull(f.elements.roaster.value),
        roastDate: orNull(f.elements.roastDate.value),
        flavorNotes: [...tags],
        cardPhoto,
        totalWeight,
        // 新建：剩余=购入；编辑：保留用户可手动微调的剩余克数
        remainingWeight: editing ? num(f.elements.remainingWeight.value, editing.remainingWeight) : totalWeight,
        price: f.elements.price.value !== '' ? num(f.elements.price.value) : null,
        status: editing?.status || 'active',
        createdAt: editing?.createdAt || Date.now(),
      };
      if (bean.remainingWeight <= 0) bean.status = 'finished';
      else if (bean.status === 'finished') bean.status = 'active';
      await Store.beans.put(bean);
      toast('已保存 🫘');
      location.hash = '#/library/beans';
    });
  }

  /* ================= 4. 新建/编辑冲煮记录（三步向导） ================= */
  let wiz = null;          // 草稿（最终成为 entry 对象）
  let wizStep = 1;
  let wizOriginal = null;  // 编辑模式下的原始记录
  let wizCtx = null;       // {beans, preps, mills, entries}

  async function entryForm(editId) {
    const [beans, preps, mills, entries] = await Promise.all([
      Store.beans.getAll(), Store.preparations.getAll(), Store.mills.getAll(), Store.entries.getAll(),
    ]);
    wizCtx = { beans, preps, mills, entries };

    wizOriginal = editId ? await Store.entries.get(editId) : null;
    if (wizOriginal) {
      wiz = JSON.parse(JSON.stringify(wizOriginal)); // 深拷贝，避免改到库里
    } else {
      wiz = {
        date: todayStr(),
        beanId: null,
        preparationId: null,
        millId: null,
        brew: { dose: 15, water: 225, temp: 92, millSetting: '', steps: [], totalTime: '', yield: null, pressure: null, extractionTime: null },
        tasting: { acidity: 3, sweetness: 3, bitterness: 3, body: 3, aroma: 3, score: 7, notes: '' },
        mood: '😀',
      };
    }
    wizStep = 1;
    renderWiz();
  }

  const curPrep = () => wizCtx.preps.find((p) => p.id === wiz.preparationId) || null;

  function renderWiz() {
    stopPourTimer(); stopCountdown();
    view().innerHTML = `
      <section class="page">
        <h2 class="page-title">${wizOriginal ? '编辑冲煮记录' : '新建冲煮记录'}</h2>
        <div class="wiz-steps">
          <span class="${wizStep === 1 ? 'on' : ''}">1 选豆子</span>
          <span class="${wizStep === 2 ? 'on' : ''}">2 器具参数</span>
          <span class="${wizStep === 3 ? 'on' : ''}">3 品鉴</span>
        </div>
        <div id="wiz-body"></div>
        <div class="wiz-foot">
          ${wizStep > 1 ? '<button class="btn" id="wiz-back">上一步</button>' : ''}
          ${wizStep < 3
            ? '<button class="btn btn-primary" id="wiz-next">下一步</button>'
            : '<button class="btn btn-accent" id="wiz-save">保存记录</button>'}
        </div>
        ${wizOriginal && wizStep === 3
          ? '<button class="btn btn-danger btn-block" id="wiz-del" style="margin-top:10px;">删除这条记录</button>' : ''}
      </section>`;

    // 先绑定底部按钮，再渲染步骤内容：即使步骤内容渲染出错，保存/导航按钮依然可用
    $('#wiz-back')?.addEventListener('click', () => { wizStep--; renderWiz(); });
    $('#wiz-next')?.addEventListener('click', () => {
      if (wizStep === 1 && !wiz.beanId) { toast('先选一支豆子'); return; }
      if (wizStep === 2) {
        if (!wiz.preparationId) { toast('先选一个冲煮器具'); return; }
        if (!(num(wiz.brew.dose) > 0)) { toast('请填写粉量'); return; }
      }
      wizStep++; renderWiz();
    });
    $('#wiz-save')?.addEventListener('click', saveEntry);
    $('#wiz-del')?.addEventListener('click', deleteEntry);

    try {
      if (wizStep === 1) renderStep1();
      else if (wizStep === 2) renderStep2();
      else renderStep3();
    } catch (err) {
      console.error('向导渲染失败', err);
      $('#wiz-body').innerHTML = `<div class="recog-error">⚠️ 页面渲染出错：${esc(err.message)}<br>仍可尝试点击底部按钮。</div>`;
    }
  }

  /* ---- 第一步：选豆子 ---- */
  function renderStep1() {
    // 仅显示 active 的豆子（编辑模式下当前引用的豆子即使 finished 也显示）
    const list = wizCtx.beans
      .filter((b) => b.status === 'active' || b.id === wiz.beanId)
      .sort((a, b) => b.createdAt - a.createdAt);

    $('#wiz-body').innerHTML = `
      <label class="f-label" style="margin-bottom:12px;">日期
        <input type="date" id="wiz-date" class="input" value="${esc(wiz.date)}">
      </label>
      ${list.length ? `<div class="pick-grid">${list.map((b) => {
        const age = ageInfo(b);
        return `
        <div class="pick-item ${wiz.beanId === b.id ? 'sel' : ''}" data-id="${b.id}">
          <div class="pi-name">${esc(b.name)}</div>
          <div class="pi-sub">${esc(b.origin || '')} · 剩 ${Math.round(num(b.remainingWeight))}g</div>
          ${age ? `<span class="pill ${age.cls}" style="margin-top:6px;">${age.label}</span>` : ''}
        </div>`;
      }).join('')}</div>` : emptyHtml('没有在喝的豆子，先去豆库添加吧')}
      <div id="copy-last-wrap"></div>`;

    $('#wiz-date').addEventListener('change', (e) => { wiz.date = e.target.value || todayStr(); });

    $$('#wiz-body .pick-item').forEach((el) => {
      el.addEventListener('click', () => {
        wiz.beanId = el.dataset.id;
        $$('#wiz-body .pick-item').forEach((x) => x.classList.toggle('sel', x === el));
        showCopyLastBtn();
      });
    });
    showCopyLastBtn();
  }

  /** 选中豆子后，若有历史记录则显示「复制上次参数」 */
  function showCopyLastBtn() {
    const wrap = $('#copy-last-wrap');
    if (!wrap) return;
    const last = wizCtx.entries
      .filter((e) => e.beanId === wiz.beanId && (!wizOriginal || e.id !== wizOriginal.id))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    wrap.innerHTML = last
      ? `<button class="btn btn-block copy-last" id="btn-copy-last">📋 复制上次参数（${esc(prettyDate(last.date))}）</button>`
      : '';
    $('#btn-copy-last')?.addEventListener('click', () => {
      // 一键带出上次的器具 / 磨豆机 / 全部冲煮参数
      wiz.preparationId = last.preparationId;
      wiz.millId = last.millId;
      wiz.brew = JSON.parse(JSON.stringify(last.brew));
      toast('已复制上次参数');
      wizStep = 2;
      renderWiz();
    });
  }

  /* ---- 第二步：器具 + 磨豆机 + 动态参数区 ---- */
  function renderStep2() {
    // 未归档的器具/磨豆机（编辑时当前选中的即使已归档也保留显示）
    const preps = wizCtx.preps.filter((p) => !p.isArchived || p.id === wiz.preparationId);
    const mills = wizCtx.mills.filter((m) => !m.isArchived || m.id === wiz.millId);

    $('#wiz-body').innerHTML = `
      <div class="f-label" style="margin-bottom:6px;">冲煮器具</div>
      <div class="pick-grid" id="prep-grid">
        ${preps.map((p) => `
          <div class="pick-item ${wiz.preparationId === p.id ? 'sel' : ''}" data-id="${p.id}">
            <div class="pi-name">${esc(p.name)}</div>
            <div class="pi-sub">${TYPE_LABEL[p.type] || ''}</div>
          </div>`).join('')}
      </div>
      <div class="f-label" style="margin-bottom:6px;">磨豆机（可跳过）</div>
      <div class="pick-grid" id="mill-grid">
        <div class="pick-item ${!wiz.millId ? 'sel' : ''}" data-id="">
          <div class="pi-name">不记录</div>
        </div>
        ${mills.map((m) => `
          <div class="pick-item ${wiz.millId === m.id ? 'sel' : ''}" data-id="${m.id}">
            <div class="pi-name">${esc(m.name)}</div>
            <div class="pi-sub">${MILL_TYPE_LABEL[m.type] || ''}</div>
          </div>`).join('')}
      </div>
      <div id="params-area"></div>`;

    // 选器具 → 按 type 动态渲染参数区
    $$('#prep-grid .pick-item').forEach((el) => {
      el.addEventListener('click', () => {
        wiz.preparationId = el.dataset.id;
        $$('#prep-grid .pick-item').forEach((x) => x.classList.toggle('sel', x === el));
        renderParams();
      });
    });
    $$('#mill-grid .pick-item').forEach((el) => {
      el.addEventListener('click', () => {
        wiz.millId = el.dataset.id || null;
        $$('#mill-grid .pick-item').forEach((x) => x.classList.toggle('sel', x === el));
      });
    });
    renderParams();
  }

  /** 按器具类型渲染参数区 */
  function renderParams() {
    const area = $('#params-area');
    const type = curPrep()?.type;
    if (!type) { area.innerHTML = ''; return; }
    const b = wiz.brew;
    const v = (x) => (x == null ? '' : x);

    if (type === 'pour-over') {
      area.innerHTML = `
        <div class="card">
          <div class="f-row">
            <label class="f-label">粉量 g<input type="number" inputmode="decimal" data-brew="dose" value="${v(b.dose)}"></label>
            <label class="f-label">水量 g<input type="number" inputmode="decimal" data-brew="water" value="${v(b.water)}"></label>
          </div>
          <div class="ratio-hint" id="ratio-hint"></div>
          <div class="f-row">
            <label class="f-label">水温 ℃<input type="number" inputmode="decimal" data-brew="temp" value="${v(b.temp)}"></label>
            <label class="f-label">研磨刻度<input data-brew="millSetting" value="${esc(b.millSetting || '')}" placeholder="如 C40 24格"></label>
          </div>
          <div class="f-label" style="margin:10px 0 4px;">分段注水（累计水量）
            <button type="button" class="btn btn-mini" id="btn-tpl" style="margin-left:8px;">✨ 经典三段式</button>
          </div>
          <div class="steps-head"><span>时间</span><span>累计g</span><span>备注</span><span></span></div>
          <div id="steps-wrap"></div>
          <button type="button" class="btn btn-mini" id="btn-add-step">＋ 加一段</button>
          <label class="f-label" style="margin-top:10px;">总时长
            <input data-brew="totalTime" id="in-totalTime" value="${esc(b.totalTime || '')}" placeholder="如 2:10">
          </label>
          ${timerHtml('冲煮计时器')}
        </div>`;
      redrawSteps();
      $('#btn-add-step').addEventListener('click', () => { b.steps.push({ time: '', water: '', note: '' }); redrawSteps(); });
      $('#btn-tpl').addEventListener('click', () => { b.steps = classicSteps(b.water); redrawSteps(); toast('已填入经典三段式'); });
      bindPourTimer();
    } else if (type === 'immersion') {
      area.innerHTML = `
        <div class="card">
          <div class="f-row">
            <label class="f-label">粉量 g<input type="number" inputmode="decimal" data-brew="dose" value="${v(b.dose)}"></label>
            <label class="f-label">水量 g<input type="number" inputmode="decimal" data-brew="water" value="${v(b.water)}"></label>
          </div>
          <div class="ratio-hint" id="ratio-hint"></div>
          <div class="f-row">
            <label class="f-label">水温 ℃<input type="number" inputmode="decimal" data-brew="temp" value="${v(b.temp)}"></label>
            <label class="f-label">研磨刻度<input data-brew="millSetting" value="${esc(b.millSetting || '')}"></label>
          </div>
          <label class="f-label" style="margin-top:10px;">浸泡总时长
            <input data-brew="totalTime" id="in-totalTime" value="${esc(b.totalTime || '')}" placeholder="如 4:00">
          </label>
          ${timerHtml('浸泡倒计时')}
        </div>`;
      bindCountdown();
    } else if (type === 'espresso') {
      area.innerHTML = `
        <div class="card">
          <div class="f-row">
            <label class="f-label">粉量 g<input type="number" inputmode="decimal" data-brew="dose" value="${v(b.dose)}"></label>
            <label class="f-label">液重 g<input type="number" inputmode="decimal" data-brew="yield" value="${v(b.yield)}"></label>
          </div>
          <div class="ratio-hint" id="ratio-hint"></div>
          <div class="f-row">
            <label class="f-label">萃取时间<input data-brew="extractionTime" value="${esc(b.extractionTime || '')}" placeholder="如 28s"></label>
            <label class="f-label">压力 bar<input type="number" inputmode="decimal" data-brew="pressure" value="${v(b.pressure)}"></label>
          </div>
          <label class="f-label" style="margin-top:10px;">研磨刻度<input data-brew="millSetting" value="${esc(b.millSetting || '')}"></label>
        </div>`;
    } else if (type === 'cold-brew') {
      area.innerHTML = `
        <div class="card">
          <div class="f-row">
            <label class="f-label">粉量 g<input type="number" inputmode="decimal" data-brew="dose" value="${v(b.dose)}"></label>
            <label class="f-label">水量 g<input type="number" inputmode="decimal" data-brew="water" value="${v(b.water)}"></label>
          </div>
          <div class="ratio-hint" id="ratio-hint"></div>
          <div class="f-row">
            <label class="f-label">研磨刻度<input data-brew="millSetting" value="${esc(b.millSetting || '')}"></label>
            <label class="f-label">冷藏时长<input data-brew="totalTime" value="${esc(b.totalTime || '')}" placeholder="如 12小时"></label>
          </div>
        </div>`;
    }

    // 绑定参数输入：实时写回 wiz.brew
    $$('#params-area [data-brew]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.brew;
        wiz.brew[key] = inp.type === 'number' ? (inp.value === '' ? null : num(inp.value)) : inp.value;
        updateRatioHint();
      });
    });
    updateRatioHint();
  }

  /** 粉水比 / 粉液比实时提示 */
  function updateRatioHint() {
    const el = $('#ratio-hint');
    if (!el) return;
    const dose = num(wiz.brew.dose);
    const type = curPrep()?.type;
    const water = type === 'espresso' ? num(wiz.brew.yield) : num(wiz.brew.water);
    el.textContent = dose > 0 && water > 0
      ? `${type === 'espresso' ? '粉液比' : '粉水比'} 1:${(water / dose).toFixed(1)}`
      : '';
  }

  /* ---- 分段注水 ---- */
  function redrawSteps() {
    const wrap = $('#steps-wrap');
    if (!wrap) return;
    wrap.innerHTML = wiz.brew.steps.map((st, i) => `
      <div class="step-row" data-idx="${i}">
        <input data-f="time" value="${esc(st.time || '')}" placeholder="0:00">
        <input data-f="water" type="number" inputmode="decimal" value="${st.water ?? ''}" placeholder="0">
        <input data-f="note" value="${esc(st.note || '')}" placeholder="备注">
        <button type="button" class="del" title="删除">×</button>
      </div>`).join('');
  }

  // 事件委托：steps 行输入 / 删除（挂在 document 上一次即可）
  document.addEventListener('input', (e) => {
    const row = e.target.closest?.('.step-row');
    if (!row || !wiz) return;
    const i = +row.dataset.idx;
    const f = e.target.dataset.f;
    if (!f || !wiz.brew.steps[i]) return;
    wiz.brew.steps[i][f] = f === 'water' ? (e.target.value === '' ? '' : num(e.target.value)) : e.target.value;
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.step-row .del');
    if (!btn || !wiz) return;
    wiz.brew.steps.splice(+btn.closest('.step-row').dataset.idx, 1);
    redrawSteps();
  });

  /** 经典三段式模板：按当前水量等比缩放（基准 15g 粉 / 225g 水） */
  function classicSteps(water) {
    const f = (num(water) || 225) / 225;
    const r = (x) => Math.round((x * f) / 5) * 5;
    return [
      { time: '0:00', water: r(50),  note: '闷蒸' },
      { time: '0:45', water: r(150), note: '中心注水' },
      { time: '1:30', water: r(225), note: '大水流绕圈' },
    ];
  }

  /* ---- 冲煮计时器（pour-over 正计时，到点高亮步骤 + 震动） ---- */
  function timerHtml(title) {
    return `
      <div class="timer-box">
        <div class="f-label" style="align-items:center;">${title}</div>
        <div class="timer-display" id="timer-display">0:00</div>
        <div class="timer-btns">
          <button type="button" class="btn btn-primary" id="tm-start">开始</button>
          <button type="button" class="btn" id="tm-pause">暂停</button>
          <button type="button" class="btn" id="tm-reset">重置</button>
        </div>
      </div>`;
  }

  let tIv = null, tStart = 0, tAcc = 0, tRun = false, curStepIdx = -1;
  const tElapsedMs = () => tAcc + (tRun ? Date.now() - tStart : 0);

  function stopPourTimer() {
    if (tIv) { clearInterval(tIv); tIv = null; }
    tRun = false; tAcc = 0; curStepIdx = -1;
  }

  function bindPourTimer() {
    stopPourTimer();
    const disp = $('#timer-display');
    $('#tm-start').addEventListener('click', () => {
      if (tRun) return;
      tRun = true; tStart = Date.now();
      $('#tm-start').textContent = '计时中';
      tIv = setInterval(() => {
        const sec = Math.floor(tElapsedMs() / 1000);
        disp.textContent = secToStr(sec);
        // 当前步骤 = time ≤ 已计时 的最后一段，变化时高亮 + 震动
        let idx = -1;
        wiz.brew.steps.forEach((st, i) => {
          const t = parseTimeToSec(st.time);
          if (t != null && t <= sec) idx = i;
        });
        if (idx !== curStepIdx) {
          curStepIdx = idx;
          $$('.step-row').forEach((r, i) => r.classList.toggle('current', i === idx));
          if (idx >= 0 && navigator.vibrate) navigator.vibrate(200);
        }
      }, 200);
      timers.push(tIv);
    });
    $('#tm-pause').addEventListener('click', () => {
      if (!tRun) return;
      tAcc = tElapsedMs(); tRun = false;
      clearInterval(tIv); tIv = null;
      $('#tm-start').textContent = '继续';
      // 暂停时把计时填入总时长
      const s = Math.floor(tAcc / 1000);
      wiz.brew.totalTime = secToStr(s);
      const inp = $('#in-totalTime');
      if (inp) inp.value = wiz.brew.totalTime;
    });
    $('#tm-reset').addEventListener('click', () => {
      stopPourTimer();
      disp.textContent = '0:00';
      $('#tm-start').textContent = '开始';
      $$('.step-row').forEach((r) => r.classList.remove('current'));
    });
  }

  /* ---- 浸泡倒计时（immersion） ---- */
  let cdIv = null, cdEnd = 0;
  function stopCountdown() { if (cdIv) { clearInterval(cdIv); cdIv = null; } }

  function bindCountdown() {
    stopCountdown();
    const disp = $('#timer-display');
    const inp = $('#in-totalTime');
    $('#tm-start').addEventListener('click', () => {
      const total = parseTimeToSec(wiz.brew.totalTime ?? inp?.value);
      if (!total) { toast('请先填写浸泡总时长，如 4:00'); return; }
      cdEnd = Date.now() + total * 1000;
      stopCountdown();
      cdIv = setInterval(() => {
        const remain = Math.max(0, Math.round((cdEnd - Date.now()) / 1000));
        disp.textContent = secToStr(remain);
        if (remain <= 0) {
          stopCountdown();
          $('#tm-start').textContent = '开始';
          if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
          toast('⏰ 浸泡完成，可以出品了');
        }
      }, 200);
      timers.push(cdIv);
      $('#tm-start').textContent = '倒计时中';
    });
    $('#tm-pause').style.display = 'none'; // 倒计时不需要暂停，简单起见隐藏
    $('#tm-reset').addEventListener('click', () => {
      stopCountdown();
      disp.textContent = secToStr(parseTimeToSec(wiz.brew.totalTime) || 0);
      $('#tm-start').textContent = '开始';
    });
  }

  /* ---- 第三步：品鉴 ---- */
  function renderStep3() {
    const t = wiz.tasting;
    const slider = (key, label, min, max, step) => `
      <div class="slider-row">
        <div class="sl-head"><span>${label}</span><span class="sl-val" id="sv-${key}">${t[key]}</span></div>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${t[key]}" data-taste="${key}">
      </div>`;

    $('#wiz-body').innerHTML = `
      <div class="card">
        <div class="radar-wrap"><canvas id="taste-radar"></canvas></div>
        ${slider('acidity', '酸质', 1, 5, 0.5)}
        ${slider('sweetness', '甜感', 1, 5, 0.5)}
        ${slider('bitterness', '苦度', 1, 5, 0.5)}
        ${slider('body', '醇厚度', 1, 5, 0.5)}
        ${slider('aroma', '香气', 1, 5, 0.5)}
        ${slider('score', '总评分', 0, 10, 0.5)}
        <div class="f-label" style="margin:10px 0 6px;">心情</div>
        <div class="mood-row" id="mood-row">
          ${MOODS.map((m) => `<button type="button" class="${wiz.mood === m ? 'sel' : ''}" data-m="${m}">${m}</button>`).join('')}
        </div>
        <label class="f-label" style="margin-top:12px;">品鉴笔记
          <textarea id="taste-notes" placeholder="今天的风味如何？">${esc(t.notes || '')}</textarea>
        </label>
      </div>`;

    // 五维雷达图预览（拖动滑块实时更新）；图表失败不影响表单
    const dims = ['acidity', 'sweetness', 'bitterness', 'body', 'aroma'];
    const radar = safeChart($('#taste-radar'), {
      type: 'radar',
      data: {
        labels: ['酸质', '甜感', '苦度', '醇厚度', '香气'],
        datasets: [{
          data: dims.map((k) => t[k]),
          fill: true,
          backgroundColor: 'rgba(192,133,82,.25)',
          borderColor: '#c08552',
          pointBackgroundColor: '#6f4e37',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { r: { min: 0, max: 5, ticks: { display: false, stepSize: 1 }, grid: { color: '#e6dbc9' }, angleLines: { color: '#e6dbc9' } } },
      },
    });

    // 滑块输入 → 写回 + 数值气泡 + 雷达图联动
    $$('#wiz-body [data-taste]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.taste;
        t[k] = num(inp.value);
        $('#sv-' + k).textContent = t[k];
        const di = dims.indexOf(k);
        if (radar && di >= 0) { radar.data.datasets[0].data[di] = t[k]; radar.update('none'); }
      });
    });

    $('#mood-row').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-m]');
      if (!btn) return;
      wiz.mood = btn.dataset.m;
      $$('#mood-row button').forEach((x) => x.classList.toggle('sel', x === btn));
    });
    $('#taste-notes').addEventListener('input', (e) => { t.notes = e.target.value; });
  }

  /* ---- 保存 / 删除记录（核心业务规则 1/2/3） ---- */
  async function saveEntry() {
    try {
      const e = JSON.parse(JSON.stringify(wiz));
      // espresso：water 字段同步为液重，保证粉水比语义统一
      if (curPrep()?.type === 'espresso') e.brew.water = num(e.brew.yield);
      if (wizOriginal) {
        // 规则 3：编辑 —— 先按旧 dose 回补，再按新 dose 扣减
        await Store.adjustBeanWeight(wizOriginal.beanId, +num(wizOriginal.brew.dose));
        e.id = wizOriginal.id;
        e.createdAt = wizOriginal.createdAt;
      } else {
        e.id = 'e_' + Date.now();
        e.createdAt = Date.now();
      }
      // 规则 1：保存 —— 扣减豆量；remainingWeight<=0 自动转 finished（在 adjustBeanWeight 内完成）
      await Store.adjustBeanWeight(e.beanId, -num(e.brew.dose));
      await Store.entries.put(e);
      toast('已记录一杯 ☕');
      location.hash = '#/';
    } catch (err) {
      // 失败时给出具体原因（如 IndexedDB 不可用/存储超限），不再静默
      console.error('保存失败', err);
      toast('保存失败：' + (err.message || err), 4000);
    }
  }

  async function deleteEntry() {
    if (!(await confirmDlg('确定删除这条冲煮记录吗？豆量会自动回补。', { danger: true, okText: '删除' }))) return;
    try {
      // 规则 2：删除 —— 回补 dose；原为 finished 且回补后 >0 自动恢复 active
      await Store.adjustBeanWeight(wizOriginal.beanId, +num(wizOriginal.brew.dose));
      await Store.entries.remove(wizOriginal.id);
      toast('已删除，豆量已回补');
      location.hash = '#/';
    } catch (err) {
      console.error('删除失败', err);
      toast('删除失败：' + (err.message || err), 4000);
    }
  }

  /* ================= 4b. 探店记录表单 ================= */
  // 出品品种：四大类；奶咖内置常见品类，datalist 之外可直接输入自定义品种
  const DRINK_TYPES = ['黑咖', '奶咖', '特调', '其他'];
  const DRINK_SUGGESTIONS = {
    '黑咖': ['美式', '手冲单品', '冷萃', '浓缩', 'Long Black', '滴滤咖啡'],
    '奶咖': ['拿铁', '卡布奇诺', 'Flat White', '澳白', 'Dirty', '燕麦拿铁', '摩卡', '焦糖玛奇朵', '短笛'],
    '特调': ['特调', '气泡美式', '橙C美式', '生椰拿铁', '阿芙佳朵', '柠檬冷萃'],
    '其他': ['无咖啡因', '抹茶拿铁', '热巧克力', '康宝蓝'],
  };

  async function visitForm(id) {
    const editing = id ? await Store.visits.get(id) : null;
    let photo = editing?.photo || null;      // 压缩后的 base64 照片（饮品/菜单/店面）
    let drinkType = editing?.drinkType || '奶咖';
    let mood = editing?.mood || '😀';

    view().innerHTML = `
      <section class="page">
        <h2 class="page-title">${editing ? '编辑探店记录' : '🏪 探店打卡'}</h2>

        <button type="button" class="btn-photo" id="btn-photo">📷 拍照识别出品 / 菜单</button>
        <input type="file" id="file-photo" accept="image/*" capture="environment" hidden>
        <div id="recog-status"></div>
        <div id="photo-preview">${photo ? `<img src="${photo}" alt="探店照片">` : ''}</div>

        <form id="visit-form" class="form card" novalidate>
          <div class="f-row">
            <label class="f-label">日期<input name="date" type="date" value="${esc(editing?.date || todayStr())}"></label>
            <label class="f-label">价格 ¥<input name="price" type="number" inputmode="decimal" min="0" value="${editing?.price ?? ''}"></label>
          </div>
          <label class="f-label">店名 *<input name="shopName" required value="${esc(editing?.shopName || '')}" placeholder="如 % Arabica"></label>
          <label class="f-label">地址 / 城市<input name="location" value="${esc(editing?.location || '')}"></label>
          <div class="f-label">出品品种</div>
          <div class="drink-pills" id="drink-pills">
            ${DRINK_TYPES.map((t) => `<button type="button" class="drink-pill ${t === drinkType ? 'sel' : ''}" data-t="${t}">${t}</button>`).join('')}
          </div>
          <label class="f-label">具体饮品（可选择，也可直接输入自定义品种）
            <input name="drinkName" list="drink-list" value="${esc(editing?.drinkName || '')}" placeholder="如 Dirty / 燕麦拿铁 / 店家特调">
            <datalist id="drink-list"></datalist>
          </label>
          <div class="slider-row">
            <div class="sl-head"><span>评分</span><span class="sl-val" id="sv-rating">${editing?.rating ?? 7}</span></div>
            <input type="range" min="0" max="10" step="0.5" value="${editing?.rating ?? 7}" name="rating">
          </div>
          <div class="f-label" style="margin:2px 0 4px;">心情</div>
          <div class="mood-row" id="mood-row">
            ${MOODS.map((m) => `<button type="button" class="${mood === m ? 'sel' : ''}" data-m="${m}">${m}</button>`).join('')}
          </div>
          <label class="f-label">笔记
            <textarea name="notes" placeholder="环境、出品、豆子风味…">${esc(editing?.notes || '')}</textarea>
          </label>
          <button type="submit" class="btn btn-primary btn-block" style="padding:14px;font-size:16px;">保存</button>
          ${editing ? '<button type="button" class="btn btn-danger btn-block" id="btn-del">删除这条记录</button>' : ''}
        </form>
      </section>`;

    const form = $('#visit-form');

    // 品种联想随 drinkType 切换；自定义品种直接输入即可（datalist 不限制输入）
    const updateSuggestions = () => {
      $('#drink-list').innerHTML = (DRINK_SUGGESTIONS[drinkType] || []).map((d) => `<option value="${esc(d)}">`).join('');
    };
    updateSuggestions();
    $('#drink-pills').addEventListener('click', (e) => {
      const pill = e.target.closest('.drink-pill');
      if (!pill) return;
      drinkType = pill.dataset.t;
      $$('.drink-pill').forEach((x) => x.classList.toggle('sel', x === pill));
      updateSuggestions();
    });

    // 评分滑块实时数值
    form.elements.rating.addEventListener('input', (e) => { $('#sv-rating').textContent = e.target.value; });

    // 心情选择
    $('#mood-row').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-m]');
      if (!btn) return;
      mood = btn.dataset.m;
      $$('#mood-row button').forEach((x) => x.classList.toggle('sel', x === btn));
    });

    /* ---- 拍照识别出品 / 菜单 ---- */
    const status = $('#recog-status');
    $('#btn-photo').addEventListener('click', () => $('#file-photo').click());
    $('#file-photo').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      try {
        status.innerHTML = `<div class="recog-loading">正在压缩照片</div>`;
        photo = await ImageUtil.compress(file);
        $('#photo-preview').innerHTML = `<img src="${photo}" alt="探店照片">`;
        await runRecognize();
      } catch (err) { showRecogError(err); }
    });

    async function runRecognize() {
      try {
        status.innerHTML = `<div class="recog-loading">🔍 大模型识别中</div>`;
        const info = await LLM.recognizeVisit(photo);
        fillForm(info); // 仅回填表单，品种细节由用户确认/修改后再保存
        status.innerHTML = `<div class="recog-ok">✅ 识别完成，请核对品种细节后再保存</div>`;
      } catch (err) { showRecogError(err); }
    }

    function showRecogError(err) {
      status.innerHTML = `<div class="recog-error">❌ ${esc(err.message || '识别失败')}
        <button type="button" class="btn btn-mini" id="btn-retry" style="margin-left:8px;">重试</button></div>`;
      $('#btn-retry')?.addEventListener('click', () => { if (photo) runRecognize(); });
    }

    /** 识别结果回填：仅覆盖非空字段；drinkType 归一化到四大类 */
    function fillForm(info) {
      const setVal = (name, v) => { if (v != null && v !== '') form.elements[name].value = v; };
      setVal('shopName', info.shopName);
      setVal('location', info.location);
      setVal('drinkName', info.drinkName);
      setVal('notes', info.notes);
      if (info.price != null && info.price !== '') form.elements.price.value = num(info.price);
      if (info.drinkType) {
        const hit = DRINK_TYPES.find((t) => String(info.drinkType).includes(t));
        if (hit) {
          drinkType = hit;
          $$('.drink-pill').forEach((x) => x.classList.toggle('sel', x.dataset.t === hit));
          updateSuggestions();
        }
      }
    }

    /* ---- 保存 ---- */
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const shopName = form.elements.shopName.value.trim();
      if (!shopName) { toast('请填写店名'); return; }
      const orNull = (v) => (v && String(v).trim() !== '' ? String(v).trim() : null);
      const visit = {
        id: editing?.id || 'v_' + Date.now(),
        date: form.elements.date.value || todayStr(),
        shopName,
        location: orNull(form.elements.location.value),
        drinkType,
        drinkName: orNull(form.elements.drinkName.value),
        price: form.elements.price.value !== '' ? num(form.elements.price.value) : null,
        rating: num(form.elements.rating.value, 7),
        notes: form.elements.notes.value || '',
        photo,
        mood,
        createdAt: editing?.createdAt || Date.now(),
      };
      try {
        await Store.visits.put(visit);
        toast('已记录一次探店 🏪');
        location.hash = '#/';
      } catch (err) {
        console.error('保存失败', err);
        toast('保存失败：' + (err.message || err), 4000);
      }
    });

    $('#btn-del')?.addEventListener('click', async () => {
      if (!(await confirmDlg('确定删除这条探店记录吗？', { danger: true, okText: '删除' }))) return;
      await Store.visits.remove(editing.id);
      toast('已删除');
      location.hash = '#/';
    });
  }

  /* ================= 5b. 世界产地地图 ================= */
  let mapState = null; // { groups, bubbles, sel }：聚合结果 / 气泡位置（点击命中用）/ 选中国家

  async function mapView() {
    const [beans, entries] = await Promise.all([Store.beans.getAll(), Store.entries.getAll()]);

    // 每支豆子的杯数与平均评分
    const stat = {};
    entries.forEach((e) => {
      const s = (stat[e.beanId] = stat[e.beanId] || { cups: 0, sum: 0, n: 0 });
      s.cups++;
      if (e.tasting?.score != null) { s.sum += num(e.tasting.score); s.n++; }
    });

    // 按产国聚合（bean.origin → 国家质心，匹配不到归入 unmatched）
    const agg = {};
    const unmatched = [];
    beans.forEach((b) => {
      const c = WorldMap.match(b.origin);
      if (!c) { if (b.origin) unmatched.push(b); return; }
      const g = (agg[c.key] = agg[c.key] || { country: c, cups: 0, beans: [] });
      const st = stat[b.id] || { cups: 0 };
      g.cups += st.cups;
      g.beans.push({ bean: b, cups: st.cups, avg: st.n ? st.sum / st.n : null });
    });
    const groups = Object.values(agg).sort((a, b) => b.cups - a.cups);
    mapState = { groups, bubbles: [], sel: groups[0]?.country.key || null };

    view().innerHTML = `
      <section class="page">
        <h2 class="page-title">世界产地地图</h2>
        <div class="stat-cards">
          <div class="card stat-card"><div class="sc-num">${groups.length}</div><div class="sc-label">喝过产国</div></div>
          <div class="card stat-card"><div class="sc-num">${beans.filter((b) => b.origin).length}</div><div class="sc-label">有产地豆子</div></div>
          <div class="card stat-card"><div class="sc-num">${entries.length}</div><div class="sc-label">总杯数</div></div>
        </div>
        ${groups.length ? `
        <div class="card map-card">
          <canvas id="world-map"></canvas>
          <div class="map-legend"><span class="dot-demo"></span>陆地　<span class="bubble-demo"></span>气泡大小 = 杯数，点击看明细</div>
        </div>
        <div class="map-chips" id="map-chips">
          ${groups.map((g) => `<button class="map-chip ${g.country.key === mapState.sel ? 'sel' : ''}" data-key="${g.country.key}">${esc(g.country.zh)} ${g.cups}杯</button>`).join('')}
        </div>
        <div id="map-detail"></div>` : emptyHtml('还没有带产地信息的豆子，去豆库补充产地国家吧 🌍')}
        ${unmatched.length ? `<div class="map-unmatched">未识别产地的豆子：${unmatched.map((b) => esc(b.name)).join('、')}，可在豆库编辑补充「产地国家」</div>` : ''}
      </section>`;

    if (!groups.length) return;
    drawWorldMap();
    renderMapDetail();

    // 国家胶囊快速定位
    $('#map-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.map-chip');
      if (!chip) return;
      mapState.sel = chip.dataset.key;
      $$('.map-chip').forEach((x) => x.classList.toggle('sel', x === chip));
      drawWorldMap();
      renderMapDetail();
    });

    // 点击画布：命中最近的气泡则选中
    $('#world-map').addEventListener('click', (ev) => {
      const rect = ev.currentTarget.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      let best = null, bd = Infinity;
      mapState.bubbles.forEach((b) => {
        const d = Math.hypot(b.x - x, b.y - y);
        if (d < Math.max(b.r + 8, 22) && d < bd) { bd = d; best = b; }
      });
      mapState.sel = best ? best.key : null;
      $$('.map-chip').forEach((x) => x.classList.toggle('sel', x.dataset.key === mapState.sel));
      drawWorldMap();
      renderMapDetail();
    });

    // 横竖屏/窗口变化时重绘
    mapResize = () => drawWorldMap();
    window.addEventListener('resize', mapResize);
  }

  /** Canvas 绘制：陆地点阵 + 产国气泡 */
  function drawWorldMap() {
    const canvas = $('#world-map');
    if (!canvas || !mapState) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    if (!w) return;
    const h = Math.round((w * WorldMap.H) / WorldMap.W);
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 1) 陆地点阵（纸张色小圆点）
    const dx = w / WorldMap.W, dy = h / WorldMap.H;
    const dotR = Math.max(0.6, Math.min(dx, dy) * 0.36);
    ctx.fillStyle = '#dcc9ac';
    for (let row = 0; row < WorldMap.H; row++) {
      const line = WorldMap.GRID[row];
      for (let col = 0; col < WorldMap.W; col++) {
        if (line[col] === '1') {
          ctx.beginPath();
          ctx.arc((col + 0.5) * dx, (row + 0.5) * dy, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 2) 产国气泡（杯数开平方映射半径，避免悬殊过大）
    mapState.bubbles = [];
    const maxCups = Math.max(1, ...mapState.groups.map((g) => g.cups));
    mapState.groups.forEach((g) => {
      const { x, y } = WorldMap.project(g.country.lat, g.country.lng, w, h);
      const isSel = g.country.key === mapState.sel;
      const br = g.cups > 0
        ? Math.min(7 + Math.sqrt(g.cups / maxCups) * (w * 0.05), w * 0.075)
        : 4; // 有豆未冲：空心小点
      mapState.bubbles.push({ key: g.country.key, x, y, r: br });
      if (isSel) { // 选中高亮光环
        ctx.beginPath(); ctx.arc(x, y, br + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#c08552'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, y, br, 0, Math.PI * 2);
      if (g.cups > 0) {
        ctx.fillStyle = 'rgba(111,78,55,.92)';
        ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#fffdf8'; ctx.stroke();
        if (br >= 9) { // 气泡够大时写入杯数
          ctx.fillStyle = '#fffdf8';
          ctx.font = `bold ${Math.max(9, br * 0.72)}px Georgia`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(g.cups), x, y + 0.5);
        }
      } else {
        ctx.fillStyle = '#fffdf8'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#6f4e37'; ctx.stroke();
      }
    });
  }

  /** 选中国家的明细卡片 */
  function renderMapDetail() {
    const box = $('#map-detail');
    if (!box || !mapState) return;
    const g = mapState.groups.find((x) => x.country.key === mapState.sel);
    if (!g) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div class="card">
        <div class="map-detail-head">
          <span class="map-detail-title">📍 ${esc(g.country.zh)}</span>
          <span class="map-detail-sub">${g.beans.length} 支豆 · ${g.cups} 杯</span>
        </div>
        ${g.beans.sort((a, b) => b.cups - a.cups).map(({ bean, cups, avg }) => `
          <div class="list-row">
            <span class="lr-name">${esc(bean.name)}</span>
            <span class="map-bean-meta">${cups} 杯${avg != null ? ' · ★' + avg.toFixed(1) : ''}</span>
          </div>`).join('')}
      </div>`;
  }

  /* ================= 5. 统计页 ================= */
  async function stats() {
    const [entries, beans, preps] = await Promise.all([
      Store.entries.getAll(), Store.beans.getAll(), Store.preparations.getAll(),
    ]);
    if (!entries.length) {
      view().innerHTML = `<section class="page"><h2 class="page-title">统计</h2>${emptyHtml('还没有数据，冲几杯后再来看吧 📊')}</section>`;
      return;
    }
    const beanMap = Object.fromEntries(beans.map((b) => [b.id, b]));
    const prepMap = Object.fromEntries(preps.map((p) => [p.id, p]));

    // 连续冲煮天数：今天没冲则从昨天往前数
    const daySet = new Set(entries.map((e) => e.date));
    let streak = 0;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (!daySet.has(fmtDate(d))) d.setDate(d.getDate() - 1);
    while (daySet.has(fmtDate(d))) { streak++; d.setDate(d.getDate() - 1); }

    const activeBeans = beans.filter((b) => b.status === 'active').length;

    // 五维平均分
    const dims = ['acidity', 'sweetness', 'bitterness', 'body', 'aroma'];
    const avg = dims.map((k) => entries.reduce((s, e) => s + num(e.tasting?.[k]), 0) / entries.length);

    // 每支豆子杯数排行（前 8）
    const perBean = {};
    entries.forEach((e) => { perBean[e.beanId] = (perBean[e.beanId] || 0) + 1; });
    const top = Object.entries(perBean).sort((a, b) => b[1] - a[1]).slice(0, 8);

    // 评分趋势（按日期升序，取每天均值）
    const perDay = {};
    entries.forEach((e) => {
      (perDay[e.date] = perDay[e.date] || []).push(num(e.tasting?.score));
    });
    const days = Object.keys(perDay).sort();
    const dayAvg = days.map((k) => perDay[k].reduce((a, b) => a + b, 0) / perDay[k].length);

    // 按器具类型的杯数分布
    const perType = {};
    entries.forEach((e) => {
      const t = prepMap[e.preparationId]?.type || 'pour-over';
      perType[t] = (perType[t] || 0) + 1;
    });

    view().innerHTML = `
      <section class="page">
        <h2 class="page-title">统计</h2>
        <div class="stat-cards">
          <div class="card stat-card"><div class="sc-num">${entries.length}</div><div class="sc-label">总杯数</div></div>
          <div class="card stat-card"><div class="sc-num">${streak}</div><div class="sc-label">连续冲煮天数</div></div>
          <div class="card stat-card"><div class="sc-num">${activeBeans}</div><div class="sc-label">在喝豆子</div></div>
        </div>
        <a class="card map-entry" href="#/map">🌍 世界产地地图 · 看看咖啡来自哪里 ›</a>
        <div class="card chart-card"><h3>五维平均分</h3><div class="chart-box"><canvas id="c-radar"></canvas></div></div>
        <div class="card chart-card"><h3>豆子杯数排行</h3><div class="chart-box"><canvas id="c-bar"></canvas></div></div>
        <div class="card chart-card"><h3>评分趋势</h3><div class="chart-box"><canvas id="c-line"></canvas></div></div>
        <div class="card chart-card"><h3>器具类型分布</h3><div class="chart-box"><canvas id="c-pie"></canvas></div></div>
      </section>`;

    const COFFEE = '#6f4e37', ACCENT = '#c08552';
    const PALETTE = ['#6f4e37', '#c08552', '#a3764b', '#8a5a34', '#d9b98f', '#57704f', '#635287', '#b0442e'];
    const baseOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };

    // 雷达图：五维平均分
    safeChart($('#c-radar'), {
      type: 'radar',
      data: { labels: ['酸质', '甜感', '苦度', '醇厚度', '香气'],
        datasets: [{ data: avg, fill: true, backgroundColor: 'rgba(192,133,82,.25)', borderColor: ACCENT, pointBackgroundColor: COFFEE }] },
      options: { ...baseOpts, scales: { r: { min: 0, max: 5, ticks: { display: false }, grid: { color: '#e6dbc9' }, angleLines: { color: '#e6dbc9' } } } },
    });

    // 横向条形图：豆子杯数排行
    safeChart($('#c-bar'), {
      type: 'bar',
      data: { labels: top.map(([id]) => (beanMap[id]?.name || '已删除').slice(0, 10)),
        datasets: [{ data: top.map(([, c]) => c), backgroundColor: PALETTE, borderRadius: 6 }] },
      options: { ...baseOpts, indexAxis: 'y', scales: { x: { ticks: { stepSize: 1 }, grid: { color: '#eee4d4' } }, y: { grid: { display: false } } } },
    });

    // 折线图：评分趋势
    safeChart($('#c-line'), {
      type: 'line',
      data: { labels: days.map((k) => k.slice(5)),
        datasets: [{ data: dayAvg, borderColor: COFFEE, backgroundColor: 'rgba(111,78,55,.12)', fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: ACCENT }] },
      options: { ...baseOpts, scales: { y: { min: 0, max: 10, grid: { color: '#eee4d4' } }, x: { grid: { display: false } } } },
    });

    // 环形图：器具类型分布
    safeChart($('#c-pie'), {
      type: 'doughnut',
      data: { labels: Object.keys(perType).map((t) => TYPE_LABEL[t] || t),
        datasets: [{ data: Object.values(perType), backgroundColor: PALETTE, borderColor: '#fffdf8', borderWidth: 2 }] },
      options: { ...baseOpts, plugins: { legend: { position: 'right' } } },
    });
  }

  /* ================= 6. 设置页 ================= */
  async function settingsPage() {
    const s = LLM.getSettings();
    const P = LLM.PROVIDERS;

    view().innerHTML = `
      <section class="page">
        <h2 class="page-title">设置</h2>

        <div class="card settings-sec">
          <h3>大模型识别</h3>
          <div class="form">
            <label class="f-label">服务商
              <select id="set-provider">
                ${Object.entries(P).map(([k, v]) => `<option value="${k}" ${s.provider === k ? 'selected' : ''}>${v.name}</option>`).join('')}
              </select>
            </label>
            <label class="f-label">API Key
              <input id="set-key" type="password" value="${esc(s.apiKey)}" placeholder="只存在本机浏览器，不会上传" autocomplete="off">
            </label>
            <label class="f-label">模型名（留空用默认）
              <input id="set-model" value="${esc(s.model)}" placeholder="">
            </label>
            <div style="display:flex;gap:10px;">
              <button class="btn btn-primary" id="btn-save-set" style="flex:1;">保存设置</button>
              <button class="btn" id="btn-test" style="flex:1;">测试连接</button>
            </div>
            <div id="test-result"></div>
          </div>
        </div>

        <div class="card settings-sec">
          <h3>数据管理</h3>
          <div class="form">
            <button class="btn" id="btn-export">📤 导出全部数据（JSON）</button>
            <button class="btn" id="btn-import">📥 导入数据（JSON）</button>
            <input type="file" id="file-import" accept="application/json,.json" hidden>
            <button class="btn btn-danger" id="btn-clear">🗑 清空全部数据</button>
          </div>
        </div>
      </section>`;

    // 切换服务商时，模型占位符提示默认模型
    const providerSel = $('#set-provider'), modelInp = $('#set-model');
    const syncPlaceholder = () => { modelInp.placeholder = '默认 ' + P[providerSel.value].model; };
    providerSel.addEventListener('change', syncPlaceholder);
    syncPlaceholder();

    $('#btn-save-set').addEventListener('click', () => {
      LLM.saveSettings({ provider: providerSel.value, apiKey: $('#set-key').value.trim(), model: modelInp.value.trim() });
      toast('设置已保存');
    });

    // 测试连接：发纯文本请求验证 Key
    $('#btn-test').addEventListener('click', async () => {
      LLM.saveSettings({ provider: providerSel.value, apiKey: $('#set-key').value.trim(), model: modelInp.value.trim() });
      const box = $('#test-result');
      const btn = $('#btn-test');
      btn.disabled = true; btn.textContent = '测试中…';
      box.innerHTML = '';
      try {
        const reply = await LLM.testConnection();
        box.innerHTML = `<div class="test-result ok">✅ 连接成功：${esc(String(reply).slice(0, 50))}</div>`;
      } catch (err) {
        box.innerHTML = `<div class="test-result err">❌ ${esc(err.message)}</div>`;
      } finally {
        btn.disabled = false; btn.textContent = '测试连接';
      }
    });

    // 数据导出：五个 store 打包成 JSON 下载，文件名含日期
    $('#btn-export').addEventListener('click', async () => {
      const data = {
        beans: await Store.beans.getAll(),
        entries: await Store.entries.getAll(),
        preparations: await Store.preparations.getAll(),
        mills: await Store.mills.getAll(),
        visits: await Store.visits.getAll(),
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `coffee-journal-${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('已导出');
    });

    // 数据导入：选 JSON 恢复，导入前确认
    $('#btn-import').addEventListener('click', () => $('#file-import').click());
    $('#file-import').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        // visits 为后加的 store，旧版导出文件可能没有，缺省为空数组
        const KEYS = ['beans', 'entries', 'preparations', 'mills', 'visits'];
        for (const k of KEYS) {
          if (data[k] == null) data[k] = [];
          if (!Array.isArray(data[k])) throw new Error('文件格式不正确：' + k + ' 应为数组');
        }
        const n = KEYS.reduce((s, k) => s + data[k].length, 0);
        if (!(await confirmDlg(`将清空现有数据并导入 ${n} 条记录，确定继续吗？`, { okText: '导入' }))) return;
        await Store.clearAll();
        for (const k of KEYS) {
          for (const item of data[k]) await Store[k].put(item);
        }
        toast('导入完成 ✅');
      } catch (err) {
        toast('导入失败：' + err.message, 3200);
      }
    });

    // 清空全部数据：输入「确认」才执行
    $('#btn-clear').addEventListener('click', async () => {
      const mask = await formModal('清空全部数据', `
        <p class="modal-text">此操作不可恢复！请输入「确认」二字：</p>
        <input id="m-clear" class="input" placeholder="确认" autocomplete="off">`);
      if (!mask) return;
      const ok = $('#m-clear', mask).value.trim() === '确认';
      mask.remove();
      if (!ok) { toast('未输入「确认」，已取消'); return; }
      await Store.clearAll();
      await Store.seed(); // 重新写入预置器具
      toast('已清空全部数据');
      location.hash = '#/';
    });
  }

  /* ================= 路由分发 ================= */
  async function render(parts) {
    cleanup(); // 销毁旧图表与计时器，防止泄漏
    const [a, b, c] = parts;
    switch (a || '') {
      case '':         return timeline();
      case 'library':  return library(b || 'beans');
      case 'bean':     return beanForm(b === 'edit' ? c : null);
      case 'entry':    return entryForm(b === 'edit' ? c : null);
      case 'visit':    return visitForm(b === 'edit' ? c : null);
      case 'stats':    return stats();
      case 'map':      return mapView();
      case 'settings': return settingsPage();
      default:         return timeline();
    }
  }

  return { render, toast };
})();
