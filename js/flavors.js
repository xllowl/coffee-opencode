/* ============================================================
 * flavors.js — 中国版咖啡风味轮数据
 * 分类参考：中国卓越咖啡师联盟《中国版咖啡风味轮感官词典》v1.0
 * （16 个风味大类，基于中国饮食文化的本地化风味描述）
 * 每个大类一套柔和配色：bg 底色 / fg 文字色 / bd 边框色
 * ============================================================ */
const FlavorWheel = {
  CATEGORIES: [
    { zh: '花香',      color: { bg: '#f7dce6', fg: '#9c4a68', bd: '#ecc3d2' }, items: ['茉莉花', '玉兰花', '玫瑰花', '桂花'] },
    { zh: '柑橘&李子', color: { bg: '#fcefcf', fg: '#9a6b1f', bd: '#f2ddab' }, items: ['香水柠檬', '青柠檬', '甜橙', '佛手柑'] },
    { zh: '甜味水果',  color: { bg: '#fbdcd8', fg: '#a44a3e', bd: '#f2c4bc' }, items: ['苹果', '水蜜桃', '荔枝', '西瓜'] },
    { zh: '热带水果',  color: { bg: '#fceec3', fg: '#976f14', bd: '#f3dc9a' }, items: ['菠萝', '芒果', '百香果', '椰子'] },
    { zh: '莓果',      color: { bg: '#e9d8ec', fg: '#6f4a7c', bd: '#d9c2de' }, items: ['草莓', '蓝莓', '番茄', '黑莓'] },
    { zh: '果干',      color: { bg: '#ecdcc8', fg: '#7c5a33', bd: '#dcc4a6' }, items: ['青葡萄干', '黑葡萄干', '红枣干', '陈皮'] },
    { zh: '茶感',      color: { bg: '#dfe9d6', fg: '#4d6b3f', bd: '#c8d9b8' }, items: ['绿茶', '乌龙茶', '红茶', '黑茶'] },
    { zh: '酒',        color: { bg: '#e4d5e6', fg: '#6c4570', bd: '#d3bcd7' }, items: ['白酒', '红葡萄酒', '白葡萄酒', '威士忌'] },
    { zh: '甜感',      color: { bg: '#f6e6c8', fg: '#8a5f23', bd: '#ecd4a8' }, items: ['清甜', '香草', '蜂蜜', '焦糖'] },
    { zh: '奶制品',    color: { bg: '#f5efe0', fg: '#8a7550', bd: '#e6dcc2' }, items: ['牛奶', '酸奶', '奶油', '芝士'] },
    { zh: '坚果',      color: { bg: '#eaddd0', fg: '#7a5638', bd: '#dbc6b0' }, items: ['花生', '腰果', '榛子', '杏仁'] },
    { zh: '谷物',      color: { bg: '#f0e8c8', fg: '#7d6c2f', bd: '#e2d6a8' }, items: ['香米', '小麦', '玉米', '燕麦'] },
    { zh: '香料',      color: { bg: '#e3e7cf', fg: '#5d6a35', bd: '#cfd6ae' }, items: ['薄荷', '肉桂', '胡椒', '八角'] },
    { zh: '木质',      color: { bg: '#e2d8cf', fg: '#6a563f', bd: '#d0c0b0' }, items: ['雪松', '檀木香', '沉香木', '泥土'] },
    { zh: '植物&蔬菜', color: { bg: '#dcead8', fg: '#46704a', bd: '#c3dabb' }, items: ['青草', '干草', '生土豆', '豌豆'] },
    { zh: '烘烤',      color: { bg: '#e0d6d0', fg: '#5f4f43', bd: '#cec0b6' }, items: ['烟熏', '烧焦'] },
  ],

  /** 风味名 → 所属大类；自定义风味返回 null */
  categoryOf(flavor) {
    return this.CATEGORIES.find((c) => c.items.includes(flavor)) || null;
  },

  /** 风味名 → 大类配色；自定义风味返回 null（用默认色） */
  colorOf(flavor) {
    return this.categoryOf(flavor)?.color || null;
  },
};
