/* ============================================================
 * llm.js — 视觉大模型识别调用
 * 支持 4 个服务商：智谱 / 通义千问 / OpenAI / Gemini
 * API Key 只存 localStorage（键 coffee_settings），绝不硬编码
 * ============================================================ */
const LLM = (() => {
  const SETTINGS_KEY = 'coffee_settings';
  const FAIL_MSG = '识别失败，请保持卡片平整、光线充足后重拍';

  // 服务商配置：type=openai 表示 OpenAI 兼容格式
  const PROVIDERS = {
    zhipu: {
      name: '智谱 GLM', type: 'openai',
      url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      model: 'glm-4v-flash',
    },
    qwen: {
      name: '通义千问', type: 'openai',
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: 'qwen-vl-max',
    },
    openai: {
      name: 'OpenAI', type: 'openai',
      url: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
    },
    gemini: {
      name: 'Gemini', type: 'gemini',
      // {model} 占位符在请求时替换为实际模型名
      url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
      model: 'gemini-2.0-flash',
    },
  };

  // 识别用 Prompt（按需求原样嵌入，勿改动）
  const PROMPT = `你是专业咖啡师。识别图片中的咖啡豆包装/信息卡，仅输出 JSON（不要 markdown 代码块）：
{
  "name": "咖啡名称（翻译为中文，可附原文）",
  "origin": "产地国家",
  "region": "产区/庄园",
  "variety": "豆种，如 瑰夏/铁皮卡/波旁/卡杜拉/SL28/原生种",
  "roastLevel": "浅烘|中浅烘|中烘|中深烘|深烘",
  "process": "水洗|日晒|蜜处理|厌氧日晒|酒桶发酵|湿刨|其他(注明)",
  "altitude": "海拔，如 1800-2000m",
  "roaster": "烘焙商/品牌",
  "roastDate": "烘焙日期 YYYY-MM-DD",
  "flavorNotes": ["风味描述，翻译为中文"]
}
规则：英文标签请翻译成中文；无法确定的字段填 null；roastLevel 和 process 必须归一化到给定枚举。`;

  // 探店识别用 Prompt：识别菜单 / 出品卡 / 杯贴
  const VISIT_PROMPT = `你是专业咖啡师。识别图片（咖啡馆菜单/价目表/出品卡/咖啡杯贴），仅输出 JSON（不要 markdown 代码块）：
{
  "shopName": "咖啡馆名称",
  "location": "地址/城市",
  "drinkName": "饮品名称（翻译为中文，可附原文）",
  "drinkType": "黑咖|奶咖|手冲|特调|其他",
  "temperature": "热|冰（根据杯型/冰块/热气判断，无法确定填 null）",
  "price": 数字（单价，无法确定填 null）,
  "espressoBean": "意式豆种类：深烘拼配|中烘拼配|中浅烘拼配|SOE|低因拼配（仅奶咖类填写，菜单注明用豆时）",
  "beanOrigin": "产地国家（仅手冲类填写）",
  "beanVariety": "豆种，如 瑰夏/铁皮卡/波旁/卡杜拉/SL28/原生种（仅手冲类填写）",
  "beanProcess": "处理法：水洗|日晒|蜜处理|厌氧日晒|酒桶发酵|湿刨|其他（仅手冲类填写）",
  "notes": "杯量/温度/做法等补充信息"
}
规则：无法确定的字段填 null；drinkType 必须归一化到给定枚举：含牛奶或植物奶的饮品（拿铁/卡布奇诺/Dirty/Flat White/澳白/摩卡/燕麦拿铁等）归奶咖；手冲/单品/精品滴滤归手冲；美式/冷萃/浓缩归黑咖；菜单上有多个饮品时选最招牌或最清晰的一个；espressoBean 和 beanProcess 必须归一化到给定枚举。`;

  /** 读取设置（localStorage 键：coffee_settings） */
  function getSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { /* 忽略损坏数据 */ }
    return { provider: 'zhipu', apiKey: '', model: '', bochaKey: '', ...s };
  }

  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      provider: s.provider || 'zhipu',
      apiKey: s.apiKey || '',
      model: s.model || '',
      bochaKey: s.bochaKey || '', // 博查搜索 API Key（可选，用于自动查找店铺官网）
    }));
  }

  /** 用户未填模型名时用各服务商默认模型 */
  function effectiveModel(s) {
    return (s.model && s.model.trim()) || PROVIDERS[s.provider].model;
  }

  /**
   * 识别咖啡豆卡片
   * @param {string} dataUrl 压缩后的 base64 dataURL
   * @returns {Promise<object>} 解析出的豆子信息 JSON
   */
  async function recognize(dataUrl) {
    return recognizeWithPrompt(dataUrl, PROMPT);
  }

  /** 探店识别：菜单 / 出品卡 / 杯贴 */
  async function recognizeVisit(dataUrl) {
    return recognizeWithPrompt(dataUrl, VISIT_PROMPT);
  }

  /** 通用识别入口：同一套调用链，仅 Prompt 不同 */
  async function recognizeWithPrompt(dataUrl, prompt) {
    const s = getSettings();
    if (!s.apiKey) throw new Error('未配置 API Key，请先到「设置」页填写');
    const p = PROVIDERS[s.provider];
    const text = p.type === 'gemini'
      ? await callGemini(s, dataUrl, prompt)
      : await callOpenAICompat(s, dataUrl, prompt);
    return parseJsonLoose(text);
  }

  /** OpenAI 兼容格式（智谱 / 通义 / OpenAI 通用） */
  async function callOpenAICompat(s, dataUrl, prompt) {
    const p = PROVIDERS[s.provider];
    const res = await fetch(p.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.apiKey,
      },
      body: JSON.stringify({
        model: effectiveModel(s),
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）：${(await res.text()).slice(0, 120)}`);
    const j = await res.json();
    return j.choices?.[0]?.message?.content || '';
  }

  /** Gemini 原生格式 */
  async function callGemini(s, dataUrl, prompt) {
    const p = PROVIDERS[s.provider];
    const url = p.url.replace('{model}', effectiveModel(s)) + '?key=' + encodeURIComponent(s.apiKey);
    const base64 = dataUrl.split(',')[1] || ''; // 去掉 data:image/jpeg;base64, 前缀
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: base64 } },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    });
    if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）：${(await res.text()).slice(0, 120)}`);
    const j = await res.json();
    return j.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  /**
   * JSON 解析兜底链：
   * 1) 直接 JSON.parse
   * 2) 正则提取 ```json 代码块
   * 3) 提取首个 {...} 片段
   * 全失败则抛出友好提示
   */
  function parseJsonLoose(text) {
    if (!text) throw new Error(FAIL_MSG);
    try { return JSON.parse(text); } catch { /* 继续兜底 */ }
    const block = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (block) { try { return JSON.parse(block[1].trim()); } catch { /* 继续兜底 */ } }
    const i = text.indexOf('{');
    const j = text.lastIndexOf('}');
    if (i >= 0 && j > i) { try { return JSON.parse(text.slice(i, j + 1)); } catch { /* 继续兜底 */ } }
    throw new Error(FAIL_MSG);
  }

  /** 测试连接：发一条纯文本请求验证 Key 是否可用 */
  async function testConnection() {
    const s = getSettings();
    if (!s.apiKey) throw new Error('请先填写 API Key');
    const p = PROVIDERS[s.provider];

    if (p.type === 'gemini') {
      const url = p.url.replace('{model}', effectiveModel(s)) + '?key=' + encodeURIComponent(s.apiKey);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: '你好，请只回复：连接成功' }] }] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}：${(await res.text()).slice(0, 120)}`);
      const j = await res.json();
      return j.candidates?.[0]?.content?.parts?.[0]?.text || 'OK';
    }

    const res = await fetch(p.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.apiKey,
      },
      body: JSON.stringify({
        model: effectiveModel(s),
        temperature: 0.1,
        max_tokens: 16,
        messages: [{ role: 'user', content: '你好，请只回复：连接成功' }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}：${(await res.text()).slice(0, 120)}`);
    const j = await res.json();
    return j.choices?.[0]?.message?.content || 'OK';
  }

  return { PROVIDERS, PROMPT, VISIT_PROMPT, getSettings, saveSettings, recognize, recognizeVisit, testConnection };
})();
