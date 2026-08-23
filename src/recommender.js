import { CONFIG } from './config.js';

const DAY_MS = 86400000;

/**
 * 硬过滤：把不该出现在今天这一顿的菜品全部剔除。
 * 店铺不存在的孤儿菜品也一并剔除 —— 没有店就没有跳转链接。
 */
export function filterCandidates({ dishes, shops, slot, excludedDishIds = [] }) {
  const shopById = new Map(shops.map((s) => [s.id, s]));
  const excluded = new Set(excludedDishIds);

  return dishes.filter((d) => {
    if (d.active === false) return false;
    if (excluded.has(d.id)) return false;
    if (!Array.isArray(d.slots) || !d.slots.includes(slot)) return false;
    const shop = shopById.get(d.shopId);
    if (!shop) return false;
    if (shop.hygiene === 'blocked') return false;
    return true;
  });
}

/**
 * 好吃度 ∈ [0,1]：对全部观察值做时间加权平均，半衰期 60 天。
 * 零观察值时返回乐观初值 0.7，让新录入的菜有机会被推出来试。
 */
export function tasteOf(observations, nowTs) {
  if (observations.length === 0) return CONFIG.COLD_START_TASTE;

  let numerator = 0;
  let denominator = 0;
  for (const obs of observations) {
    const daysAgo = (nowTs - obs.ts) / DAY_MS;
    const weight = Math.pow(0.5, daysAgo / CONFIG.TASTE_HALFLIFE_DAYS);
    numerator += weight * obs.value;
    denominator += weight;
  }
  return numerator / denominator;
}
