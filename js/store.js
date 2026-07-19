/* ============================================================
 * store.js — localForage 数据层
 * 四个 store：beans（咖啡豆）/ entries（冲煮记录）/
 *             preparations（冲煮器具）/ mills（磨豆机）
 * ============================================================ */
const Store = (() => {
  // 同一数据库下的四个 objectStore（localForage 底层走 IndexedDB）
  const beans = localforage.createInstance({ name: 'coffee-journal', storeName: 'beans' });
  const entries = localforage.createInstance({ name: 'coffee-journal', storeName: 'entries' });
  const preparations = localforage.createInstance({ name: 'coffee-journal', storeName: 'preparations' });
  const mills = localforage.createInstance({ name: 'coffee-journal', storeName: 'mills' });

  // 通用 CRUD 包装：localForage 是 key-value 形式，getAll 通过 iterate 收集
  const wrap = (store) => ({
    async getAll() {
      const list = [];
      await store.iterate((v) => { list.push(v); });
      return list;
    },
    get: (id) => store.getItem(id),
    put: (item) => store.setItem(item.id, item),
    remove: (id) => store.removeItem(id),
    clear: () => store.clear(),
  });

  // 首次运行预置的 6 个常用器具
  const DEFAULT_PREPARATIONS = [
    { name: 'V60',    type: 'pour-over'  },
    { name: 'Chemex', type: 'pour-over'  },
    { name: '爱乐压', type: 'immersion'  },
    { name: '法压壶', type: 'immersion'  },
    { name: '意式',   type: 'espresso'   },
    { name: '冷萃',   type: 'cold-brew'  },
  ];

  /** 首次运行：若无器具数据则写入预置器具 */
  async function seed() {
    const count = await preparations.length();
    if (count === 0) {
      for (let i = 0; i < DEFAULT_PREPARATIONS.length; i++) {
        const id = 'p_' + (Date.now() + i); // +i 避免同一毫秒 id 冲突
        await preparations.setItem(id, { id, ...DEFAULT_PREPARATIONS[i], isArchived: false });
      }
    }
  }

  /**
   * 调整豆子剩余克数（核心业务规则 1/2/3 的底层实现）
   * @param {string} beanId
   * @param {number} delta 负数=扣减（冲了一杯），正数=回补（删除/编辑记录）
   */
  async function adjustBeanWeight(beanId, delta) {
    const b = await beans.get(beanId);
    if (!b) return;
    b.remainingWeight = Math.round((Number(b.remainingWeight || 0) + delta) * 10) / 10;
    if (b.remainingWeight <= 0) {
      // 扣到 0 及以下：见底，状态变为 finished
      b.remainingWeight = Math.max(0, b.remainingWeight);
      b.status = 'finished';
    } else if (b.status === 'finished') {
      // 回补后大于 0：恢复 active
      b.status = 'active';
    }
    await beans.put(b);
  }

  /** 清空全部数据（设置页「清空全部数据」用） */
  async function clearAll() {
    await Promise.all([beans.clear(), entries.clear(), preparations.clear(), mills.clear()]);
  }

  return {
    beans: wrap(beans),
    entries: wrap(entries),
    preparations: wrap(preparations),
    mills: wrap(mills),
    seed,
    adjustBeanWeight,
    clearAll,
  };
})();
