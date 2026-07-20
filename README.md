# 咖啡手账 · Coffee Journal

[English](#english) | [中文](#中文)

---

## 中文

一个纯静态、移动端优先的个人咖啡手账 PWA：记录每天的咖啡冲煮、咖啡豆档案、探店打卡与品鉴笔记。数据全部保存在浏览器 IndexedDB 中，无需任何后端；拍摄咖啡豆包装卡片即可调用视觉大模型自动识别并回填表单。

### 功能特性

- **手账时间线**：冲煮记录与探店记录按日期混排，GitHub 风格 12 周热力图（月份/周几标签），卡片**左滑删除**（冲煮删除自动回补豆量）
- **冲煮向导（三步）**：选豆（支持「复制上次参数」）→ 按器具类型动态渲染参数（手冲分段注水+计时震动提醒 / 浸泡倒计时 / 意式 / 冷萃）→ 五维滑块 + 雷达图实时预览、风味标签、心情
- **豆库管理**：在喝/已喝完分组、养豆天数与赏味期状态、剩余克数进度条、风味标签（按风味轮 16 大类着色）；器具与磨豆机增删改/归档
- **拍照识别**：咖啡豆包装卡 → 压缩 → 大模型识别产地/产区/烘焙度/处理法等并回填（需用户确认）；探店菜单/出品卡识别，奶咖自动归类并记录意式豆种类，手冲记录豆子品种信息
- **探店打卡**：黑咖/奶咖/手冲/特调/其他五大品类，支持自定义品种；奶咖可选意式豆种类（拼配/SOE 等），手冲可记录产地/豆种/处理法
- **世界产地地图**：零依赖 Canvas 点阵世界地图，杯数气泡、按常规产区（非洲/中美与加勒比/南美洲/亚太）放大细节视图并标注国名
- **中国版风味轮**：16 大类 64 种本地化风味的 Canvas 环形轮盘选择器，风味标签全局按大类着色
- **统计**：总杯数、连续冲煮天数、五维平均分雷达图、豆子杯数排行、评分趋势、器具类型分布
- **设置**：4 家大模型服务商切换（智谱 GLM / 通义千问 / OpenAI / Gemini）、连接测试、JSON 导出/导入、清空数据

### 技术栈

- 原生 HTML + CSS + JavaScript (ES6+)，**无构建工具**，直接部署即可运行
- 仅 3+1 个 CDN 依赖：localForage 1.10（IndexedDB）、Chart.js 4（图表）、霞鹜文楷字体、FontAwesome 6 免费版（图标，带 emoji 降级）
- Hash 路由单页应用（规避 GitHub Pages 刷新 404）
- PWA：`manifest.json` + Service Worker（应用文件网络优先、CDN 缓存优先，离线可用；SW 注册失败静默降级）

### 文件结构

```
├── index.html        # SPA 外壳（视图容器 + 底部 Tab）
├── manifest.json     # PWA 清单
├── sw.js             # Service Worker 离线缓存
├── icon.svg          # 应用图标
├── .nojekyll
├── css/style.css     # 手账风格样式（CSS 变量、纸张纹理）
└── js/
    ├── app.js        # 初始化、hash 路由、Tab 切换、首次运行预置数据
    ├── store.js      # localForage 数据层（beans/entries/preparations/mills/visits）
    ├── llm.js        # 大模型识别（4 服务商、JSON 兜底解析、连接测试）
    ├── image.js      # 照片压缩（最长边 1280px，JPEG 0.8）
    ├── views.js      # 全部视图渲染逻辑
    ├── worldmap.js   # 世界点阵地图数据 + 产国坐标/别名/国旗/产区分组
    ├── flavors.js    # 中国版风味轮数据（16 大类 64 风味 + 配色）
    └── icons.js      # FontAwesome 加载检测与 emoji 降级
```

### 核心业务规则

1. 保存冲煮记录：对应豆子 `remainingWeight -= dose`，≤0 自动转为「已喝完」
2. 删除冲煮记录：回补豆量，原为「已喝完」且回补后 >0 自动恢复「在喝」
3. 编辑冲煮记录：先按旧粉量回补，再按新粉量扣减
4. 养豆天数 = 今天 − 烘焙日期：≤7 养豆期 / 8–45 最佳赏味期 / >45 尽快喝完

### 部署（GitHub Pages）

1. `git init && git add . && git commit -m "coffee journal"`
2. GitHub 新建仓库，关联并 `git push -u origin main`
3. 仓库 **Settings → Pages**，Source 选 `Deploy from a branch`，分支 `main` / 目录 `/(root)`
4. 等待 1–2 分钟，访问 `https://<用户名>.github.io/<仓库名>/`
5. 打开站点 →「设置」填入任一服务商 API Key →「测试连接」成功后即可拍照识别

> 本地预览：`python3 -m http.server 8080` 后访问 `http://localhost:8080`。API Key 仅保存在本机 localStorage，不会上传。

---

## English

A pure-static, mobile-first personal coffee journal PWA. Log your daily brews, coffee bean archives, café visits and tasting notes. All data lives in the browser's IndexedDB — no backend required. Snap a photo of a coffee bean card and a vision LLM auto-fills the form for you.

### Features

- **Journal timeline**: brew logs and café visits merged by date, GitHub-style 12-week heatmap (month/weekday labels), **swipe left to delete** (bean weight is restored automatically when deleting a brew)
- **Brew wizard (3 steps)**: pick a bean ("copy last parameters" supported) → parameters rendered per brewer type (pour-over staged pours with timer & vibration, immersion countdown, espresso, cold brew) → 5-dimension sliders with live radar chart, flavor tags, mood
- **Bean library**: active/finished grouping, roast-age & prime-window badges, remaining-weight progress bar, flavor tags colored by the 16 flavor-wheel categories; brewers & grinders CRUD/archive
- **Photo recognition**: bean card → compression → LLM extracts origin/region/roast/process into the form (user confirms before saving); café menu/cup recognition with milk-drink classification, espresso-bean options, and pour-over bean details
- **Café visits**: 5 drink categories (black / milk / pour-over / signature / other) with custom names; milk drinks track espresso bean type, pour-overs track origin/variety/process
- **World origin map**: dependency-free Canvas dot-matrix world map with cup-count bubbles; zoom into conventional coffee regions (Africa / Central America & Caribbean / South America / Asia-Pacific) with country labels
- **Chinese flavor wheel**: Canvas donut-wheel picker with 16 categories & 64 localized flavors; flavor tags colored by category everywhere
- **Stats**: total cups, brewing streak, average radar, bean leaderboard, score trend, brewer-type distribution
- **Settings**: 4 LLM providers (Zhipu GLM / Qwen / OpenAI / Gemini), connection test, JSON export/import, data wipe

### Tech Stack

- Vanilla HTML + CSS + JavaScript (ES6+). **No build tools** — push and run
- CDN-only dependencies: localForage 1.10 (IndexedDB), Chart.js 4, LXGW Wenkai font, FontAwesome 6 Free (with emoji fallback)
- Hash-routed SPA (avoids GitHub Pages 404 on refresh)
- PWA: `manifest.json` + Service Worker (network-first for app files, cache-first for CDN, offline capable; silently degrades if SW registration fails)

### Core Business Rules

1. Saving a brew: `remainingWeight -= dose`; ≤ 0 → bean marked as finished
2. Deleting a brew: weight restored; a finished bean returns to active if weight > 0
3. Editing a brew: restore old dose first, then deduct the new one
4. Roast age = today − roastDate: ≤7 resting / 8–45 prime / >45 drink soon

### Deployment (GitHub Pages)

1. `git init && git add . && git commit -m "coffee journal"`
2. Create a GitHub repo and `git push -u origin main`
3. **Settings → Pages** → `Deploy from a branch` → `main` / `/(root)`
4. Visit `https://<username>.github.io/<repo>/` after 1–2 minutes
5. Open Settings, paste any provider's API Key, test the connection, and start scanning

> Local preview: `python3 -m http.server 8080` → `http://localhost:8080`. API keys are stored only in your browser's localStorage and never uploaded.
