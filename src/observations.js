import { CONFIG, EATEN_RATINGS } from './config.js';
import { localDateKey } from './dates.js';

const MINUTE_MS = 60 * 1000;

/**
 * 把原始事件流压成观察值：一条观察值 = 一顿饭里的一道菜。
 *
 * 两步处理：
 * Pass 1: 从 recommended 事件构建规范组（分组键：dateKey|slot|dishId；
 *         dateKey 优先取事件自带的，没有才按写入时刻推算）
 * Pass 2: 把其他事件附加到目标组 —— 带 targetTs 时精确匹配 ts 相同的那组；
 *         带 dateKey 时精确匹配 dateKey|slot|dishId 那组；
 *         都没有或找不到时退回启发式：最近的（ts 最大但 <= event.ts）匹配组
 *
 * 这样既能保留跨天历史，又能处理后序事件（例如评分可能在第二天）。
 */
export function reduceObservations(events) {
  // Pass 1: 从 recommended 事件构建规范组
  const groups = new Map(); // key = dateKey|slot|dishId -> group object
  const groupsBySlotDish = new Map(); // key = slot|dishId -> [groups]（按 ts 升序）

  for (const e of events) {
    if (e.type === 'recommended') {
      // 事件自带 dateKey 时以它为准：它记的是「这一顿」属于哪天，
      // 而写入时刻可能已经跨过零点（23:55 打开、00:05 才点下单）。
      // 老事件和导入的旧快照没有这个字段，退回按写入时刻推算。
      const dateKey = e.dateKey ?? localDateKey(e.ts);
      const key = `${dateKey}|${e.slot}|${e.dishId}`;

      if (!groups.has(key)) {
        const group = {
          dateKey,
          slot: e.slot,
          dishId: e.dishId,
          ts: e.ts,
          lastRecommendedTs: e.ts,
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
        // 同一个 dateKey|slot|dishId 有多个 recommended 事件：页面重载，
        // 或者用户在轮播里划开又划回来。
        //
        // ts 保留最早的 —— 反馈浮层的 targetTs 回指的就是它，它必须稳定。
        // lastRecommendedTs 另记最晚的 —— 判断「这一顿最后停在哪道菜」要用它。
        // 两个语义必须分开：合成一个字段就会在「A → B → 回到 A」时选错组。
        const group = groups.get(key);
        if (e.ts < group.ts) {
          group.ts = e.ts;
        }
        if (e.ts > group.lastRecommendedTs) {
          group.lastRecommendedTs = e.ts;
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

    // clicked 带着页面渲染时记下的 dateKey，直接落到那一顿 ——
    // 不靠写入先后去猜：跨零点时，启发式可能挂到另一组上。
    if (!targetGroup && e.dateKey != null) {
      targetGroup = groups.get(`${e.dateKey}|${e.slot}|${e.dishId}`) ?? null;
    }

    // 既没有 targetTs 也没有 dateKey（旧事件、导入的快照），或指向的组已不存在时，
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

  // 一顿只认最后一条推荐。
  // 用户可以在轮播里左右浏览，系统最初推的是 A、他最终在 B 上下单，
  // 这一顿的观察值就该是 B。被丢弃的组连同挂在它上面的反应事件一起作废。
  //
  // 比较用 lastRecommendedTs 而非 ts：ts 被「保留最早」的去重语义占用了，
  // 用它比较会在「A → B → 划回 A」时误选 B。
  //
  // 但带 rated 的组不能这样丢掉：浮层问的是「上顿的×怎么样」，用户答的就是那道菜，
  // 评分与菜是绑在一起的一次表态。所以先看谁带评分，都带或都不带时才比推荐时刻。
  const hasRated = (g) => g.events.some((e) => e.type === 'rated');
  const latestPerMeal = new Map(); // key = dateKey|slot -> group
  for (const group of groups.values()) {
    const mealKey = `${group.dateKey}|${group.slot}`;
    const kept = latestPerMeal.get(mealKey);
    if (!kept) {
      latestPerMeal.set(mealKey, group);
      continue;
    }
    const rated = hasRated(group);
    const keptRated = hasRated(kept);
    const wins = rated !== keptRated
      ? rated
      : group.lastRecommendedTs > kept.lastRecommendedTs;
    if (wins) latestPerMeal.set(mealKey, group);
  }

  // 减缩每个组
  const out = [];
  for (const group of latestPerMeal.values()) {
    const ratedEvents = group.events.filter((e) => e.type === 'rated');
    const rated = ratedEvents.length > 0
      ? ratedEvents.reduce((latest, e) => (e.ts > latest.ts ? e : latest))
      : null;
    const clicked = group.events.find((e) => e.type === 'clicked');

    // 推迟补问要从下单那一刻起算；观察值的 ts 是推荐时刻，不是下单时刻。
    const clickedTs = group.events
      .filter((e) => e.type === 'clicked')
      .reduce((max, e) => (max === null || e.ts > max ? e.ts : max), null);

    let value;
    let source;
    if (rated) {
      // 认不出的评分值仍算「已评分」——否则会被反复补问——但不参与计算。
      value = CONFIG.RATING_VALUES[rated.value] ?? null;
      source = 'rated';
    } else if (clicked) {
      value = CONFIG.IMPLICIT_CLICKED;
      source = 'clicked';
    } else {
      // 推了但没动作：记录照留（补问要靠它），但不折算成分数 ——
      // 切出应用可能只是去回条消息，与这道菜好不好吃无关。
      value = null;
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
      clickedTs,
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
 * 每道菜最近一次被按下「别再推这个」、且之后没被取消的本地日期键。
 * 直接从原始事件流取，不经过观察值 —— 静音是对菜的表态，
 * 不属于任何一顿饭。
 *
 * 先后比 ts 而不比日期：同一天先静音后取消，日期相同分不出先后
 * （spec 2026-09-14 §3.2）。ts 相等时算已取消。
 */
export function buildMutedIndex(events) {
  const lastMuted = new Map();   // dishId -> ts
  const lastUnmuted = new Map(); // dishId -> ts
  for (const e of events) {
    const latest = e.type === 'muted' ? lastMuted
      : e.type === 'unmuted' ? lastUnmuted
      : null;
    if (!latest) continue;
    const prev = latest.get(e.dishId);
    if (prev === undefined || e.ts > prev) latest.set(e.dishId, e.ts);
  }

  const out = new Map();
  for (const [dishId, mutedTs] of lastMuted) {
    const unmutedTs = lastUnmuted.get(dishId);
    if (unmutedTs !== undefined && unmutedTs >= mutedTs) continue;
    out.set(dishId, localDateKey(mutedTs));
  }
  return out;
}

/**
 * 该补问哪一顿 —— 不管推迟时长到没到。
 *
 * 优先挑「点过下单、还没评分、又不是当前这顿」里最近的一顿，且只看比最近
 * 一顿已评分更晚的：更早的积压不追问。没有这样的一顿，才退回旧规则 ——
 * 看最近一条观察值。
 *
 * 为什么优先下过单的：边界前下单、边界后再打开时，页面会为新饭点写一条
 * 没点过的推荐。只看最近一条的话，真正吃了的那顿就被它挡住，永远问不到。
 *
 * render() 的守卫（被补问的菜不排开场位）用这个而不是 pendingFeedback：
 * 推迟期间不补问，但刚下单的那道菜同样不该又被端上来。
 *
 * liveDishIds 是「此刻还在候选池里的菜」的 id 集合，由页面传入（纯函数读不到库）。
 * 传了就只挑菜还在的 —— 否则下过单的菜一被删，浮层找不到菜不弹，那顿却一直
 * 占着候选位，别的顿也问不到。**只用来筛候选，不参与算「最近一顿已评分」**：
 * 那条线漏掉已删菜就会往回退，把几天前的老记录翻出来重问。
 * 不传（null）时行为与加这个参数之前完全一致。
 */
export function feedbackCandidate(observations, nowTs, slot, liveDishIds = null) {
  if (observations.length === 0) return null;

  const isLive = (o) => liveDishIds === null || liveDishIds.has(o.dishId);
  const nowKey = localDateKey(nowTs);
  const isCurrent = (o) => o.dateKey === nowKey && o.slot === slot;

  let lastRatedTs = -Infinity;
  for (const o of observations) {
    if (o.source === 'rated' && o.ts > lastRatedTs) lastRatedTs = o.ts;
  }

  let candidate = null;
  for (const o of observations) {
    if (o.source !== 'clicked' || isCurrent(o) || o.ts <= lastRatedTs) continue;
    if (!isLive(o)) continue;
    if (candidate === null || o.ts > candidate.ts) candidate = o;
  }
  if (candidate) return candidate;

  // 退回旧规则时同样只看菜还在的那些；一条都不剩就不问。
  const askable = observations.filter(isLive);
  if (askable.length === 0) return null;
  const latest = askable.reduce((a, b) => (b.ts > a.ts ? b : a));
  // 早于最近一顿已评分的不追问。不过滤时这条判断不改变任何结果（那时 latest
  // 就是全局最新的一条）；过滤之后它才要紧：已删菜把那条线撑在后面，
  // 剩下的老记录不该被翻出来重问。
  if (latest.ts <= lastRatedTs) return null;
  if (isCurrent(latest)) return null;
  if (latest.source === 'rated') return null;
  return latest;
}

/**
 * 下次打开时该补问哪一顿。每次最多返回一条。
 *
 * 下过单的那顿要等 FEEDBACK_DELAY_MINUTES 才问 —— 外卖从下单到吃完要一阵子，
 * 刚下单就问只能逼人随手答个「没吃成」。推迟期间返回 null，**不拿别的记录
 * 顶上**：若改问一顿没下单的，用户随手答了，它就成了最近一顿已评分，
 * 真正下过单的那顿因为比它早而被排除，从此问不到。
 */
export function pendingFeedback(observations, nowTs, slot, liveDishIds = null) {
  const c = feedbackCandidate(observations, nowTs, slot, liveDishIds);
  if (c === null) return null;
  if (c.source === 'clicked') {
    // 手工构造的观察值（现有测试里就有）可能没有 clickedTs，退回推荐时刻。
    const clickedAt = c.clickedTs ?? c.ts;
    if (nowTs - clickedAt < CONFIG.FEEDBACK_DELAY_MINUTES * MINUTE_MS) return null;
  }
  return c;
}

/**
 * 今天这一顿的当前状态，完全从事件流推导 —— 因此页面重载不会让
 * 已经定下的这顿重新掷骰子。
 *
 * 取最后一条 recommended 而非最早那条：用户可以在轮播里浏览，
 * 最终在别的菜上下单时会补写一条，那条才代表这一顿。
 */
export function currentPick(events, slot, nowKey) {
  let latest = null;
  for (const e of events) {
    if (e.type !== 'recommended') continue;
    if (e.slot !== slot) continue;
    // 同 reduceObservations：优先认事件自带的 dateKey。
    if ((e.dateKey ?? localDateKey(e.ts)) !== nowKey) continue;
    if (latest === null || e.ts > latest.ts) latest = e;
  }

  return {
    activeDishId: latest ? latest.dishId : null,
    // 旧事件的 value 是 null，UI 那边兜底。
    activeReason: latest && typeof latest.value === 'string' ? latest.value : null,
  };
}
