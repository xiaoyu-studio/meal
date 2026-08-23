import { CONFIG } from './config.js';
import { daysBetweenKeys, localDateKey } from './dates.js';
import { reduceObservations, buildEatenIndex } from './observations.js';

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

/** 这道菜的有效价格：优先用最近一次实付价，没有才用参考价。 */
export function effectivePriceOf(dish, events) {
  let latest = null;
  for (const e of events) {
    if (e.type !== 'paid' || e.dishId !== dish.id) continue;
    if (latest === null || e.ts > latest.ts) latest = e;
  }
  return latest ? latest.value : dish.refPrice;
}

/**
 * 实惠度 ∈ [0,1] = 1 - 该价格在候选集中的百分位。
 * 用相对位置而非绝对金额，因此永远不必定义"多少钱算便宜"。
 * 并列价格取相同（较优）分数。
 */
export function valueOf(price, allPrices) {
  if (allPrices.length <= 1) return 0.5;
  const cheaperCount = allPrices.filter((p) => p < price).length;
  const percentile = cheaperCount / (allPrices.length - 1);
  return 1 - Math.min(1, Math.max(0, percentile));
}

/**
 * 腻味系数 ∈ (0,1]：最近吃过的降权。
 * 菜品衰减最重（可归零），店铺次之（上限 50%），tag 最轻（上限 30%）——
 * 目的是防止连着三顿都是同一家店或同一个菜系。
 *
 * 单独返回 fDish 是因为理由生成的「好久没吃了」判据看的是它，不是 total。
 */
export function fatigueOf({
  dishLastEatenKey,
  shopLastEatenKey,
  tagLastEatenKeys = [],
  nowKey,
}) {
  const dDish = daysBetweenKeys(dishLastEatenKey, nowKey);
  const dShop = daysBetweenKeys(shopLastEatenKey, nowKey);
  const tagDays = tagLastEatenKeys.map((k) => daysBetweenKeys(k, nowKey));
  const dTag = tagDays.length ? Math.min(...tagDays) : Infinity;

  const fDish =
    dDish === Infinity ? 1 : 1 - Math.exp(-dDish / CONFIG.FATIGUE_TAU_DISH);
  const fShop =
    dShop === Infinity
      ? 1
      : 1 - CONFIG.FATIGUE_MAX_SHOP_PENALTY * Math.exp(-dShop / CONFIG.FATIGUE_TAU_SHOP);
  const fTag =
    dTag === Infinity
      ? 1
      : 1 - CONFIG.FATIGUE_MAX_TAG_PENALTY * Math.exp(-dTag / CONFIG.FATIGUE_TAU_TAG);

  const total = Math.max(CONFIG.FATIGUE_FLOOR, fDish * fShop * fTag);
  return { total, fDish, fShop, fTag };
}

/**
 * 一句话推荐理由。按 spec §6.8 的顺序取第一个命中的分支。
 * 带理由的推荐更容易被接受，能实际压低"换一个"的点击率 —— 这不是装饰。
 */
export function reasonFor({
  hasObservations,
  lastRatedValue,
  isTopTaste,
  isTopValue,
  fDish,
}) {
  if (!hasObservations) return '还没试过，试试看';
  if (lastRatedValue === 'good') return '你上次说好吃';
  if (isTopTaste) return '评价一直不错';
  if (isTopValue) return '同类里最便宜';
  if (fDish >= CONFIG.LONG_TIME_FDISH) return '好久没吃了';
  return '换换口味';
}

/**
 * 唯一对外入口：给定候选池与全部历史事件，选出这一顿该吃什么。
 *
 * now 与 random 都由调用方注入 —— 这是本模块保持纯函数、可完整测试的前提。
 */
export function recommend({
  dishes,
  shops,
  events = [],
  slot,
  now,
  excludedDishIds = [],
  random = Math.random,
}) {
  const candidates = filterCandidates({ dishes, shops, slot, excludedDishIds });
  if (candidates.length === 0) return null;

  const observations = reduceObservations(events);
  const dishesById = new Map(dishes.map((d) => [d.id, d]));
  const eaten = buildEatenIndex(observations, dishesById);
  const nowKey = localDateKey(now);

  const obsByDish = new Map();
  for (const obs of observations) {
    let list = obsByDish.get(obs.dishId);
    if (!list) obsByDish.set(obs.dishId, (list = []));
    list.push(obs);
  }

  const prices = candidates.map((d) => effectivePriceOf(d, events));

  const rows = candidates.map((dish, i) => {
    const obs = obsByDish.get(dish.id) ?? [];
    const taste = tasteOf(obs, now);
    const value = valueOf(prices[i], prices);
    const fatigue = fatigueOf({
      dishLastEatenKey: eaten.byDish.get(dish.id),
      shopLastEatenKey: eaten.byShop.get(dish.shopId),
      tagLastEatenKeys: (dish.tags ?? [])
        .map((t) => eaten.byTag.get(t))
        .filter(Boolean),
      nowKey,
    });
    const base = CONFIG.W_TASTE * taste + CONFIG.W_VALUE * value;
    const jitter =
      CONFIG.JITTER_MIN + random() * (CONFIG.JITTER_MAX - CONFIG.JITTER_MIN);
    return { dish, obs, taste, value, fatigue, score: base * fatigue.total * jitter };
  });

  const maxTaste = Math.max(...rows.map((r) => r.taste));
  const maxValue = Math.max(...rows.map((r) => r.value));
  const best = rows.reduce((a, b) => (b.score > a.score ? b : a));

  let lastRatedValue = null;
  for (const obs of best.obs) {
    if (obs.source === 'rated') lastRatedValue = obs.ratedValue; // obs 已按 ts 升序
  }

  return {
    dish: best.dish,
    reason: reasonFor({
      hasObservations: best.obs.length > 0,
      lastRatedValue,
      isTopTaste: best.taste === maxTaste,
      isTopValue: best.value === maxValue,
      fDish: best.fatigue.fDish,
    }),
  };
}
