import { CONFIG, EATEN_RATINGS } from './config.js';
import { localDateKey } from './dates.js';

/**
 * 把原始事件流压成观察值：一条观察值 = 一顿饭里的一道菜。
 *
 * 两步处理：
 * Pass 1: 从 recommended 事件构建规范组（分组键：dateKey|slot|dishId）
 * Pass 2: 把其他事件附加到目标组 —— 事件带 targetTs 时精确匹配 ts 相同的那组，
 *         否则退回启发式：最近的（ts 最大但 <= event.ts）匹配组
 *
 * 这样既能保留跨天历史，又能处理后序事件（例如评分可能在第二天）。
 */
export function reduceObservations(events) {
  // Pass 1: 从 recommended 事件构建规范组
  const groups = new Map(); // key = dateKey|slot|dishId -> group object
  const groupsBySlotDish = new Map(); // key = slot|dishId -> [groups]（按 ts 升序）

  for (const e of events) {
    if (e.type === 'recommended') {
      const dateKey = localDateKey(e.ts);
      const key = `${dateKey}|${e.slot}|${e.dishId}`;

      if (!groups.has(key)) {
        const group = {
          dateKey,
          slot: e.slot,
          dishId: e.dishId,
          ts: e.ts,
          events: [e],
        };
        groups.set(key, group);

        // 也保存到 groupsBySlotDish 中，用于 Pass 2 的查找
        const slotDishKey = `${e.slot}|${e.dishId}`;
        if (!groupsBySlotDish.has(slotDishKey)) {
          groupsBySlotDish.set(slotDishKey, []);
        }
        groupsBySlotDish.get(slotDishKey).push(group);
      } else {
        // 同一个 dateKey|slot|dishId 有多个 recommended 事件（页面重载）
        // 保留最早的 ts
        const group = groups.get(key);
        if (e.ts < group.ts) {
          group.ts = e.ts;
        }
        group.events.push(e);
      }
    }
  }

  // 确保每个 slotDish 的组按 ts 升序排列
  for (const groupList of groupsBySlotDish.values()) {
    groupList.sort((a, b) => a.ts - b.ts);
  }

  // Pass 2: 将非 recommended 事件附加到目标组
  for (const e of events) {
    if (e.type === 'recommended') continue;

    const slotDishKey = `${e.slot}|${e.dishId}`;
    const candidates = groupsBySlotDish.get(slotDishKey);
    if (!candidates) continue;

    let targetGroup = null;

    // 反馈浮层写 rated / paid / sick 时会带上被问那一组的 ts。
    // 有它就精确落到那一组 —— 否则「今天又推了同一道菜」会把昨天的评分
    // 抢走：既丢了用户对昨天那顿的表态，又让今天这顿被误标为已评分。
    if (e.targetTs != null) {
      targetGroup = candidates.find((g) => g.ts === e.targetTs) ?? null;
    }

    // 没有 targetTs（旧事件、导入的快照），或它指向的组已不存在时，
    // 退回原启发式：找到满足 group.ts <= e.ts 的最大 ts 的组。
    if (!targetGroup) {
      for (const group of candidates) {
        if (group.ts <= e.ts) {
          targetGroup = group;
        } else {
          break; // 因为列表已排序，后续都不符合
        }
      }
    }

    if (targetGroup) {
      targetGroup.events.push(e);
    }
  }

  // 减缩每个组
  const out = [];
  for (const group of groups.values()) {
    const ratedEvents = group.events.filter((e) => e.type === 'rated');
    const rated = ratedEvents.length > 0
      ? ratedEvents.reduce((latest, e) => (e.ts > latest.ts ? e : latest))
      : null;
    const swapped = group.events.find((e) => e.type === 'swapped');
    const clicked = group.events.find((e) => e.type === 'clicked');

    let value;
    let source;
    if (rated) {
      value = CONFIG.RATING_VALUES[rated.value] ?? CONFIG.IMPLICIT_NO_ACTION;
      source = 'rated';
    } else if (swapped) {
      value = CONFIG.IMPLICIT_SWAPPED;
      source = 'swapped';
    } else if (clicked) {
      value = CONFIG.IMPLICIT_CLICKED;
      source = 'clicked';
    } else {
      value = CONFIG.IMPLICIT_NO_ACTION;
      source = 'none';
    }

    out.push({
      dishId: group.dishId,
      dateKey: group.dateKey,
      slot: group.slot,
      ts: group.ts,
      value,
      source,
      ratedValue: rated ? rated.value : null,
      eaten: rated ? EATEN_RATINGS.includes(rated.value) : false,
    });
  }

  return out.sort((a, b) => a.ts - b.ts);
}

/**
 * 建立「上一次真的吃过是哪天」的索引，按菜品 / 店铺 / tag 三个维度。
 * 日期键是 'YYYY-MM-DD' 字符串，字典序即时间序，可直接比较。
 */
export function buildEatenIndex(observations, dishesById) {
  const byDish = new Map();
  const byShop = new Map();
  const byTag = new Map();

  const keepLatest = (map, key, dateKey) => {
    const prev = map.get(key);
    if (prev === undefined || dateKey > prev) map.set(key, dateKey);
  };

  for (const o of observations) {
    if (!o.eaten) continue;
    const dish = dishesById.get(o.dishId);
    if (!dish) continue; // 候选池里已删除的菜

    keepLatest(byDish, dish.id, o.dateKey);
    keepLatest(byShop, dish.shopId, o.dateKey);
    for (const tag of dish.tags ?? []) keepLatest(byTag, tag, o.dateKey);
  }

  return { byDish, byShop, byTag };
}

/**
 * 下次打开时该补问哪一顿。每次最多返回一条 —— 积压再多也只问最近那顿，
 * 避免一次弹出一串问题。
 *
 * 被「换一个」换掉的观察值不补问：用户按了换，说明他没吃这道菜。
 */
export function pendingFeedback(observations, nowTs, slot) {
  if (observations.length === 0) return null;

  const latest = observations.reduce((a, b) => (b.ts > a.ts ? b : a));
  const nowKey = localDateKey(nowTs);

  if (latest.dateKey === nowKey && latest.slot === slot) return null;
  if (latest.source === 'rated') return null;
  if (latest.source === 'swapped') return null;
  return latest;
}

/**
 * 今天这一顿的当前状态，完全从事件流推导 —— 因此页面重载不会丢失
 * 已换次数，也不会让已经定下的这顿重新掷骰子。
 */
export function currentPick(events, slot, nowKey) {
  const todays = events.filter(
    (e) => e.slot === slot && localDateKey(e.ts) === nowKey,
  );

  const swappedDishIds = [
    ...new Set(todays.filter((e) => e.type === 'swapped').map((e) => e.dishId)),
  ];
  const swapped = new Set(swappedDishIds);

  const alive = todays
    .filter((e) => e.type === 'recommended' && !swapped.has(e.dishId))
    .sort((a, b) => a.ts - b.ts);

  return {
    activeDishId: alive.length ? alive[alive.length - 1].dishId : null,
    swappedDishIds,
    swapCount: swappedDishIds.length,
  };
}
