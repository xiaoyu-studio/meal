# 浏览式选菜与隐式信号重设计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「换一个」从有上限的拒绝动作改成无上限的循环浏览，并让浏览与「无动作」不再影响口味评分。

**Architecture:** 归约层改两处（`swapped` 退场、一顿只认最后一条 `recommended`），评分层加一个静音系数并让 `tasteOf` 跳过无数值观察值，推荐器新增返回完整排序候选的入口，UI 层把单张卡片改成本地轮播。纯模块不碰时钟与 DOM，全部新逻辑由 `node --test` 覆盖。

**Tech Stack:** 原生 ES Modules，无任何运行时依赖；测试用 Node 自带的 `node:test` 与 `node:assert/strict`。

**Spec:** `docs/superpowers/specs/2026-08-26-browse-and-implicit-signals-design.md`
（其修订对象为 `docs/superpowers/specs/2026-08-22-meal-recommender-design.md`）

## Global Constraints

- **零运行时依赖，零构建步骤。** `package.json` 只允许有 `name` / `private` / `type` 三个字段。不得安装任何 npm 包。
- **纯函数边界。** `src/config.js`、`src/dates.js`、`src/observations.js`、`src/recommender.js`、`src/snapshot.js` 不得触碰时钟、随机数、DOM 或存储。时间与随机源一律作为参数注入（`now`、`random`、`nowKey`）。
- **`src/store.js` 是唯一被允许调用 `indexedDB`、`Date.now()`、`crypto.randomUUID()` 的模块。**
- **不注册 Service Worker。**
- **面向用户的文案一律简体中文**，包括抛出的错误消息。
- **可调常数只放 `src/config.js`。** 单位换算与结构标识不算可调项。
- 事件日志**只追加，从不修改**。观察值每次读取时现算，从不存储。
- 测试命令：`node --test`。本地预览：`python -m http.server 8000`。
- `src/store.js` 与 `src/ui-*.js` 没有自动化测试，由 `README.md` 的真机验收清单覆盖。

---

### Task 1: 无动作与 `swapped` 退出计分

**Files:**
- Modify: `src/config.js:7-8`
- Modify: `src/observations.js:99-113`（归约的取值分支）、`src/observations.js:173`（`pendingFeedback` 的 swapped 分支）
- Modify: `src/recommender.js:30-42`（`tasteOf`）
- Test: `test/observations.test.js`、`test/recommender.test.js`

**Interfaces:**
- Consumes: 无
- Produces: 观察值的 `value` 从「必为 number」放宽为 `number | null`；`null` 表示不参与口味计算。`source` 取值集合变为 `'rated' | 'clicked' | 'none'`（`'swapped'` 不再产生）。`tasteOf(observations, nowTs)` 签名不变，行为改为跳过 `value === null` 的观察值。

- [ ] **Step 1: 改掉三条既有测试的期望值**

`test/observations.test.js` 第 12 行那条改成：

```js
test('只有 recommended，无任何后续动作 → 不带数值', () => {
  const obs = reduceObservations([ev('recommended', 'd1', at(0, 12))]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, null);
  assert.equal(obs[0].source, 'none');
  assert.equal(obs[0].eaten, false);
});
```

第 29 行那条（`swapped → 0.2`）整条替换成：

```js
test('旧的 swapped 事件被忽略，该组等同于无动作', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('swapped', 'd1', at(0, 12) + 5000),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, null);
  assert.equal(obs[0].source, 'none');
});
```

第 188 行那条断言数组里的 `['2026-08-23', 'none', 0.45, false]` 改成 `['2026-08-23', 'none', null, false]`。

第 205 行的 `obs` 辅助函数改成：

```js
const obs = (dishId, dateKey, eaten) => ({
  dishId, dateKey, slot: 'lunch', ts: new Date(`${dateKey}T12:00:00`).getTime(),
  value: eaten ? 1 : null, source: eaten ? 'rated' : 'none',
  ratedValue: eaten ? 'good' : null, eaten,
});
```

删掉第 287 行整条 `pendingFeedback 跳过被换掉的（用户没吃它）`。

第 307 行那条改成不含 swapped 的版本：

```js
test('pendingFeedback 在同一顿换过再点的情况下问最后点的那个', () => {
  const r = pendingFeedback([
    obsAt('a', -1, 19, 'dinner', 'none'),
    { ...obsAt('b', -1, 19, 'dinner', 'clicked'), ts: new Date(2026, 7, 21, 19, 5).getTime() },
  ], NOW, 'lunch');
  assert.equal(r.dishId, 'b');
});
```

- [ ] **Step 2: 加一条 `tasteOf` 的新测试**

追加到 `test/recommender.test.js` 末尾：

```js
test('tasteOf 跳过不带数值的观察值', () => {
  const withNulls = tasteOf([o(1.0, 1), { ...o(0, 1), value: null }], NOW);
  assert.equal(withNulls, tasteOf([o(1.0, 1)], NOW));
});

test('tasteOf 在观察值全部不带数值时退回冷启动值', () => {
  assert.equal(tasteOf([{ ...o(0, 1), value: null }], NOW), CONFIG.COLD_START_TASTE);
});
```

若该文件尚未导入 `CONFIG`，在顶部加上 `import { CONFIG } from '../src/config.js';`。

- [ ] **Step 3: 运行测试，确认失败**

Run: `node --test`
Expected: FAIL —— `只有 recommended...` 断言 `0.45 !== null`，`tasteOf 跳过...` 断言不相等。

- [ ] **Step 4: 改归约的取值分支**

`src/observations.js` 中删掉 `const swapped = group.events.find((e) => e.type === 'swapped');` 一行，并把取值分支整体替换为：

```js
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
```

- [ ] **Step 5: 删掉 `pendingFeedback` 的 swapped 分支**

删除 `src/observations.js` 中的 `if (latest.source === 'swapped') return null;` 一行，并把该函数文档注释里「被『换一个』换掉的观察值不补问」那句删掉。

- [ ] **Step 6: 改 `tasteOf`**

```js
export function tasteOf(observations, nowTs) {
  let numerator = 0;
  let denominator = 0;
  for (const obs of observations) {
    if (obs.value === null || obs.value === undefined) continue;
    const daysAgo = (nowTs - obs.ts) / DAY_MS;
    const weight = Math.pow(0.5, daysAgo / CONFIG.TASTE_HALFLIFE_DAYS);
    numerator += weight * obs.value;
    denominator += weight;
  }
  // 一条带数值的观察值都没有时（含空数组），退回乐观初值，
  // 让新录入的菜有机会被推出来试。
  if (denominator === 0) return CONFIG.COLD_START_TASTE;
  return numerator / denominator;
}
```

- [ ] **Step 7: 删掉两个不再使用的常数**

`src/config.js` 删除 `IMPLICIT_SWAPPED: 0.2,` 与 `IMPLICIT_NO_ACTION: 0.45,` 两行。

- [ ] **Step 8: 运行测试，确认全绿**

Run: `node --test`
Expected: PASS，且总数不少于改动前减去删掉的那一条。

- [ ] **Step 9: 确认没有残留引用**

Run: `grep -rn "IMPLICIT_SWAPPED\|IMPLICIT_NO_ACTION" src/ test/`
Expected: 无输出。

- [ ] **Step 10: 提交**

```bash
git add src/config.js src/observations.js src/recommender.js test/observations.test.js test/recommender.test.js
git commit -m "feat: 无动作与旧 swapped 事件不再影响口味评分

观察值照常生成（pendingFeedback 要靠它挑该补问哪一顿），但不带数值，
不进入 tasteOf 的加权平均。切出应用可能只是去回条消息，与这道菜
好不好吃无关。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 一顿只认最后一条 `recommended`

**Files:**
- Modify: `src/observations.js:14-93`（`reduceObservations` 的 Pass 2 之后、缩减之前）
- Test: `test/observations.test.js`

**Interfaces:**
- Consumes: Task 1 产出的 `value: number | null` 契约
- Produces: `reduceObservations(events)` 对同一 `dateKey` + `slot` 至多返回一条观察值（`ts` 最大的那条）。这是 UI 层「系统推了 A、用户浏览后在 B 上下单」得以正确归属的前提。

- [ ] **Step 1: 写失败的测试**

替换 `test/observations.test.js` 第 75 行那条 `同一顿换两次产生三条独立观察值`：

```js
test('同一顿有多条 recommended 时只留最后一条', () => {
  const obs = reduceObservations([
    ev('recommended', 'a', at(0, 12)),
    ev('recommended', 'b', at(0, 12) + 2000),
    ev('recommended', 'c', at(0, 12) + 4000),
    ev('clicked', 'c', at(0, 12) + 5000),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].dishId, 'c');
  assert.equal(obs[0].value, 0.65);
});

test('被丢弃那条上的反应事件一并丢弃', () => {
  const obs = reduceObservations([
    ev('recommended', 'a', at(0, 12)),
    ev('clicked', 'a', at(0, 12) + 1000),
    ev('recommended', 'b', at(0, 12) + 2000),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].dishId, 'b');
  assert.equal(obs[0].value, null);
});

test('不同饭点、不同日期各自保留自己最后那条', () => {
  const obs = reduceObservations([
    ev('recommended', 'a', at(0, 12), 'lunch'),
    ev('recommended', 'b', at(0, 12) + 1000, 'lunch'),
    ev('recommended', 'c', at(0, 19), 'dinner'),
    ev('recommended', 'd', at(1, 12), 'lunch'),
  ]);
  assert.deepEqual(
    obs.map((o) => [o.dateKey, o.slot, o.dishId]).sort(),
    [
      ['2026-08-22', 'dinner', 'c'],
      ['2026-08-22', 'lunch', 'b'],
      ['2026-08-23', 'lunch', 'd'],
    ].sort(),
  );
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test test/observations.test.js`
Expected: FAIL —— `同一顿有多条 recommended 时只留最后一条` 报 `obs.length` 为 3 而非 1。

- [ ] **Step 3: 在缩减之前加入筛选**

`src/observations.js` 中，Pass 2 的 `for` 循环结束后、`// 减缩每个组` 之前，插入：

```js
  // 一顿只认最后一条推荐。
  // 用户可以在轮播里左右浏览，系统最初推的是 A、他最终在 B 上下单，
  // 这一顿的观察值就该是 B。被丢弃的组连同挂在它上面的反应事件一起作废。
  const latestPerMeal = new Map(); // key = dateKey|slot -> group
  for (const group of groups.values()) {
    const mealKey = `${group.dateKey}|${group.slot}`;
    const kept = latestPerMeal.get(mealKey);
    if (!kept || group.ts > kept.ts) latestPerMeal.set(mealKey, group);
  }
```

然后把缩减循环的遍历对象从 `groups.values()` 改为 `latestPerMeal.values()`：

```js
  const out = [];
  for (const group of latestPerMeal.values()) {
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test`
Expected: PASS，全部测试通过。

- [ ] **Step 5: 提交**

```bash
git add src/observations.js test/observations.test.js
git commit -m "feat: 归约时一顿只认最后一条 recommended

用户在轮播里浏览后可能在别的菜上下单。系统最初推 A、他最终选 B，
这一顿的观察值应当是 B。被丢弃的组连同挂在其上的反应事件一起作废。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 静音系数

**Files:**
- Modify: `src/config.js`（新增两个常数）
- Modify: `src/observations.js`（新增 `buildMutedIndex`）
- Modify: `src/recommender.js`（新增 `muteOf`，并接入最终评分）
- Test: `test/observations.test.js`、`test/recommender.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `buildMutedIndex(events)` → `Map<dishId, dateKey>`，值为该菜最近一次 `muted` 事件的本地日期键
  - `muteOf({ lastMutedKey, nowKey })` → `number`，无 `muted` 记录时返回 `1`
  - 最终评分变为 `base * fatigue.total * mute * jitter`

- [ ] **Step 1: 写失败的测试**

追加到 `test/observations.test.js`：

```js
test('buildMutedIndex 取每道菜最近一次 muted 的日期', () => {
  const idx = buildMutedIndex([
    ev('muted', 'd1', at(0, 12)),
    ev('muted', 'd1', at(2, 12)),
    ev('muted', 'd2', at(1, 12)),
    ev('recommended', 'd3', at(1, 12)),
  ]);
  assert.equal(idx.get('d1'), '2026-08-24');
  assert.equal(idx.get('d2'), '2026-08-23');
  assert.equal(idx.get('d3'), undefined);
});
```

并把该文件顶部的 import 改成包含 `buildMutedIndex`。

追加到 `test/recommender.test.js`：

```js
test('muteOf 无 muted 记录时不打折', () => {
  assert.equal(muteOf({ lastMutedKey: undefined, nowKey: '2026-08-26' }), 1);
});

test('muteOf 当天压到地板值', () => {
  assert.equal(
    muteOf({ lastMutedKey: '2026-08-26', nowKey: '2026-08-26' }),
    CONFIG.MUTE_FLOOR,
  );
});

test('muteOf 随天数单调回升且始终小于 1', () => {
  const at7 = muteOf({ lastMutedKey: '2026-08-19', nowKey: '2026-08-26' });
  const at30 = muteOf({ lastMutedKey: '2026-07-27', nowKey: '2026-08-26' });
  assert.ok(at7 > CONFIG.MUTE_FLOOR, `期望 >${CONFIG.MUTE_FLOOR}，实际 ${at7}`);
  assert.ok(at30 > at7, `期望 ${at30} > ${at7}`);
  assert.ok(at30 < 1, `期望 <1，实际 ${at30}`);
});
```

并把该文件顶部的 import 改成包含 `muteOf`。

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test`
Expected: FAIL —— `buildMutedIndex is not a function`、`muteOf is not a function`。

- [ ] **Step 3: 加常数**

`src/config.js` 的 `FATIGUE_FLOOR` 之后加入：

```js
  MUTE_FLOOR: 0.05,
  MUTE_TAU_DAYS: 14,
```

- [ ] **Step 4: 实现 `buildMutedIndex`**

加到 `src/observations.js` 中 `buildEatenIndex` 的旁边：

```js
/**
 * 每道菜最近一次被按下「别再推这个」的本地日期键。
 * 直接从原始事件流取，不经过观察值 —— 静音是对菜的表态，
 * 不属于任何一顿饭。
 */
export function buildMutedIndex(events) {
  const out = new Map();
  for (const e of events) {
    if (e.type !== 'muted') continue;
    const key = localDateKey(e.ts);
    const prev = out.get(e.dishId);
    if (prev === undefined || key > prev) out.set(e.dishId, key);
  }
  return out;
}
```

- [ ] **Step 5: 实现 `muteOf`**

加到 `src/recommender.js` 中 `fatigueOf` 之后：

```js
/**
 * 静音系数 ∈ [MUTE_FLOOR, 1)：按过「别再推这个」的菜大幅降权，随天数自行回升。
 * 形状与腻味系数一致，只是时间常数长得多。
 *
 * 注意这是降权不是排除 —— 候选池小的时候，被静音的菜仍可能排在最前。
 * 这是设计时明知并接受的取舍（见 2026-08-26 spec §3.3）；若真机上出现
 * 「按了没用」的观感，应回到该节重新评估改为硬过滤。
 */
export function muteOf({ lastMutedKey, nowKey }) {
  const d = daysBetweenKeys(lastMutedKey, nowKey);
  if (d === Infinity) return 1;
  return (
    CONFIG.MUTE_FLOOR +
    (1 - CONFIG.MUTE_FLOOR) * (1 - Math.exp(-d / CONFIG.MUTE_TAU_DAYS))
  );
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `node --test`
Expected: PASS。

- [ ] **Step 7: 接入最终评分**

`src/recommender.js` 的 `recommend` 中，在 `const eaten = ...` 之后加入：

```js
  const muted = buildMutedIndex(events);
```

并把 import 改为 `import { reduceObservations, buildEatenIndex, buildMutedIndex } from './observations.js';`

然后在 `rows` 的 map 回调里，`const base = ...` 之前加入：

```js
    const mute = muteOf({ lastMutedKey: muted.get(dish.id), nowKey });
```

并把 `score` 改为：

```js
    return { dish, obs, taste, value, fatigue, score: base * fatigue.total * mute * jitter };
```

- [ ] **Step 8: 写一条端到端测试确认静音真的压低了排序**

追加到 `test/recommender.test.js`：

```js
test('被静音的菜在评分中被压低', () => {
  const dishes = [
    { id: 'a', shopId: 's1', name: 'A', refPrice: 20, slots: ['lunch'], tags: [] },
    { id: 'b', shopId: 's1', name: 'B', refPrice: 20, slots: ['lunch'], tags: [] },
  ];
  const shops = [{ id: 's1', name: 'S', hygiene: 'unknown' }];
  const events = [{ id: 'm1', ts: NOW, slot: 'lunch', dishId: 'a', type: 'muted', value: null }];
  // 固定 random 消除抖动，两道菜其余条件完全相同。
  const r = recommend({ dishes, shops, events, slot: 'lunch', now: NOW, random: () => 0.5 });
  assert.equal(r.dish.id, 'b');
});
```

- [ ] **Step 9: 运行测试，确认通过**

Run: `node --test`
Expected: PASS。

- [ ] **Step 10: 提交**

```bash
git add src/config.js src/observations.js src/recommender.js test/observations.test.js test/recommender.test.js
git commit -m "feat: 新增静音系数，为「别再推这个」提供评分侧支撑

形状与腻味系数一致：按下当天压到 MUTE_FLOOR，之后按 MUTE_TAU_DAYS
指数回升，不需要另造「到期恢复」的机制。

这是降权不是排除，候选池小时被静音的菜仍可能排最前 —— 已知取舍，
注释里记了触发重新评估的条件。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `rankCandidates` —— 返回完整排序候选

**Files:**
- Modify: `src/recommender.js:123-186`
- Test: `test/recommender.test.js`

**Interfaces:**
- Consumes: Task 3 的 `muteOf` 与 `buildMutedIndex`
- Produces: `rankCandidates({ dishes, shops, events, slot, now, excludedDishIds, random })` → `Array<{ dish, reason, score }>`，按 `score` 降序；无候选时返回 `[]`。`recommend(...)` 保留为取首项的薄封装，签名与返回值不变（`{ dish, reason } | null`），既有调用方无需改动。

- [ ] **Step 1: 写失败的测试**

追加到 `test/recommender.test.js`：

```js
test('rankCandidates 返回全部候选并按分数降序', () => {
  const dishes = [
    { id: 'a', shopId: 's1', name: 'A', refPrice: 10, slots: ['lunch'], tags: [] },
    { id: 'b', shopId: 's1', name: 'B', refPrice: 20, slots: ['lunch'], tags: [] },
    { id: 'c', shopId: 's1', name: 'C', refPrice: 30, slots: ['lunch'], tags: [] },
  ];
  const shops = [{ id: 's1', name: 'S', hygiene: 'unknown' }];
  const ranked = rankCandidates({ dishes, shops, events: [], slot: 'lunch', now: NOW, random: () => 0.5 });
  assert.equal(ranked.length, 3);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, '应按分数降序');
  }
  for (const row of ranked) {
    assert.equal(typeof row.reason, 'string');
    assert.ok(row.reason.length > 0, '每条候选都要有理由');
  }
});

test('rankCandidates 无候选时返回空数组', () => {
  const ranked = rankCandidates({ dishes: [], shops: [], events: [], slot: 'lunch', now: NOW });
  assert.deepEqual(ranked, []);
});

test('recommend 返回的就是 rankCandidates 的第一条', () => {
  const dishes = [
    { id: 'a', shopId: 's1', name: 'A', refPrice: 10, slots: ['lunch'], tags: [] },
    { id: 'b', shopId: 's1', name: 'B', refPrice: 30, slots: ['lunch'], tags: [] },
  ];
  const shops = [{ id: 's1', name: 'S', hygiene: 'unknown' }];
  const args = { dishes, shops, events: [], slot: 'lunch', now: NOW, random: () => 0.5 };
  const ranked = rankCandidates(args);
  const one = recommend(args);
  assert.equal(one.dish.id, ranked[0].dish.id);
  assert.equal(one.reason, ranked[0].reason);
});
```

并把该文件顶部的 import 改成包含 `rankCandidates`。

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test`
Expected: FAIL —— `rankCandidates is not a function`。

- [ ] **Step 3: 把 `recommend` 拆成 `rankCandidates` + 薄封装**

把 `src/recommender.js` 中整个 `recommend` 函数（含其文档注释）替换为：

```js
/**
 * 给定候选池与全部历史事件，把这一顿的全部候选按分数从高到低排好。
 * 轮播直接消费这个列表 —— 排序只在页面加载时算一次，浏览期间不重算，
 * 否则划动过程中顺序会变。
 *
 * now 与 random 都由调用方注入 —— 这是本模块保持纯函数、可完整测试的前提。
 */
export function rankCandidates({
  dishes,
  shops,
  events = [],
  slot,
  now,
  excludedDishIds = [],
  random = Math.random,
}) {
  const candidates = filterCandidates({ dishes, shops, slot, excludedDishIds });
  if (candidates.length === 0) return [];

  const observations = reduceObservations(events);
  const dishesById = new Map(dishes.map((d) => [d.id, d]));
  const eaten = buildEatenIndex(observations, dishesById);
  const muted = buildMutedIndex(events);
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
    const mute = muteOf({ lastMutedKey: muted.get(dish.id), nowKey });
    const base = CONFIG.W_TASTE * taste + CONFIG.W_VALUE * value;
    const jitter =
      CONFIG.JITTER_MIN + random() * (CONFIG.JITTER_MAX - CONFIG.JITTER_MIN);
    return {
      dish,
      obs,
      taste,
      value,
      score: base * fatigue.total * mute * jitter,
      fDish: fatigue.fDish,
    };
  });

  const maxTaste = Math.max(...rows.map((r) => r.taste));
  const maxValue = Math.max(...rows.map((r) => r.value));

  return rows
    .sort((a, b) => b.score - a.score)
    .map((r) => {
      let lastRatedValue = null;
      for (const obs of r.obs) {
        if (obs.source === 'rated') lastRatedValue = obs.ratedValue; // obs 已按 ts 升序
      }
      return {
        dish: r.dish,
        score: r.score,
        reason: reasonFor({
          hasObservations: r.obs.length > 0,
          lastRatedValue,
          isTopTaste: r.taste === maxTaste,
          isTopValue: r.value === maxValue,
          fDish: r.fDish,
        }),
      };
    });
}

/** 只要分最高那一道。保留此入口是为了让既有调用方与测试不必改。 */
export function recommend(args) {
  const ranked = rankCandidates(args);
  if (ranked.length === 0) return null;
  return { dish: ranked[0].dish, reason: ranked[0].reason };
}
```

- [ ] **Step 4: 运行测试，确认全部通过**

Run: `node --test`
Expected: PASS —— 既有的 `recommend` 测试应当一条都不用改。

- [ ] **Step 5: 提交**

```bash
git add src/recommender.js test/recommender.test.js
git commit -m "feat: 新增 rankCandidates，返回排好序的完整候选列表

轮播需要的是列表而不是单个结果。recommend 保留为取首项的薄封装，
既有调用方和测试一行都不用改。

排序只在这里算一次，UI 浏览期间不重算 —— 否则划动过程中顺序会变。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `recommended` 事件存推荐理由，`currentPick` 随之改造

**Files:**
- Modify: `src/observations.js:181-200`（`currentPick`）
- Modify: `src/config.js`（删 `MAX_SWAPS`）
- Modify: `src/ui-today.js`（跟上 `currentPick` 的新形状，暂不改交互）
- Test: `test/observations.test.js:320-370`

**Interfaces:**
- Consumes: 无
- Produces: `currentPick(events, slot, nowKey)` → `{ activeDishId: string | null, activeReason: string | null }`。不再返回 `swappedDishIds` 与 `swapCount`。`activeReason` 取自该顿最后一条 `recommended` 事件的 `value`；旧事件的 `value` 为 `null` 时原样返回 `null`，由 UI 兜底。

- [ ] **Step 1: 重写 `currentPick` 的测试**

把 `test/observations.test.js` 第 320 行起到 `currentPick 忽略其他饭点和其他日期的事件` 为止的全部 `currentPick` 测试替换为：

```js
test('currentPick 对空事件返回无选择', () => {
  const p = currentPick([], 'lunch', '2026-08-22');
  assert.deepEqual(p, { activeDishId: null, activeReason: null });
});

test('currentPick 返回这一顿最后一条推荐及其理由', () => {
  const p = currentPick([
    { ...evt('recommended', 'a', 12), value: '还没试过，试试看' },
    { ...evt('recommended', 'b', 12, 30), value: '你上次说好吃' },
  ], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, 'b');
  assert.equal(p.activeReason, '你上次说好吃');
});

test('currentPick 对没存理由的旧事件返回 null 理由', () => {
  const p = currentPick([evt('recommended', 'a', 12)], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, 'a');
  assert.equal(p.activeReason, null);
});

test('currentPick 忽略其他饭点和其他日期的事件', () => {
  const p = currentPick([
    evt('recommended', 'x', 12, 0, 'dinner'),
    { ...evt('recommended', 'y', 12), ts: new Date(2026, 7, 21, 12, 0).getTime() },
  ], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, null);
});

test('currentPick 忽略非 recommended 的事件', () => {
  const p = currentPick([
    { ...evt('recommended', 'a', 12), value: '换换口味' },
    evt('clicked', 'a', 12, 5),
    evt('muted', 'a', 12, 6),
  ], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, 'a');
  assert.equal(p.activeReason, '换换口味');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test test/observations.test.js`
Expected: FAIL —— 返回对象里多出 `swappedDishIds` / `swapCount`，且没有 `activeReason`。

- [ ] **Step 3: 重写 `currentPick`**

把 `src/observations.js` 中整个 `currentPick`（含文档注释）替换为：

```js
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
    if (localDateKey(e.ts) !== nowKey) continue;
    if (latest === null || e.ts > latest.ts) latest = e;
  }

  return {
    activeDishId: latest ? latest.dishId : null,
    // 旧事件的 value 是 null，UI 那边兜底。
    activeReason: latest && typeof latest.value === 'string' ? latest.value : null,
  };
}
```

- [ ] **Step 4: 让 `ui-today.js` 跟上新形状**

`src/ui-today.js` 的 `render()` 中：

把

```js
      if (dish) reason = '这顿已经定了';
```

改为

```js
      if (dish) reason = pick.activeReason ?? '换换口味';
```

把

```js
      const excludedDishIds = asking
        ? [...pick.swappedDishIds, asking.dishId]
        : pick.swappedDishIds;
```

改为

```js
      const excludedDishIds = asking ? [asking.dishId] : [];
```

把

```js
        (asking
          ? recommend({
              dishes, shops, events, slot, now,
              excludedDishIds: pick.swappedDishIds,
            })
          : null);
```

改为

```js
        (asking ? recommend({ dishes, shops, events, slot, now }) : null);
```

把

```js
        await appendEvent({ slot, dishId: dish.id, type: 'recommended' });
```

改为

```js
        await appendEvent({ slot, dishId: dish.id, type: 'recommended', value: reason });
```

把

```js
    state = { slot, dish, shop, swapCount: pick.swapCount };
```

改为

```js
    state = { slot, dish, shop };
```

并把模块顶部的 `let state = { slot: null, dish: null, shop: null, swapCount: 0 };` 改为 `let state = { slot: null, dish: null, shop: null };`

删掉

```js
    el('swap').hidden = pick.swapCount >= CONFIG.MAX_SWAPS;
```

- [ ] **Step 5: 删掉 `MAX_SWAPS`**

`src/config.js` 删除 `MAX_SWAPS: 2,` 一行。

- [ ] **Step 6: 确认没有残留引用**

Run: `grep -rn "MAX_SWAPS\|swapCount\|swappedDishIds" src/ test/`
Expected: 无输出。

若 `src/ui-today.js` 的 `CONFIG` import 已无其他用途，一并删掉该 import。用 `grep -n "CONFIG" src/ui-today.js` 确认。

- [ ] **Step 7: 运行测试并做一次人工冒烟**

Run: `node --test`
Expected: PASS。

再起 `python -m http.server 8000`，打开 `http://localhost:8000/index.html`，确认页面能正常渲染（此时「换一个」按钮仍是旧行为，属正常）。

- [ ] **Step 8: 提交**

```bash
git add src/config.js src/observations.js src/ui-today.js test/observations.test.js
git commit -m "feat: recommended 事件存下推荐理由，currentPick 返回它

重载后不再显示「这顿已经定了」——那句话把「刷新不重抽」说成了
「这一顿被锁死」，用户点完去下单切回来会以为没法再改。现在显示的是
当初那条理由，与第一次打开时完全一致。

currentPick 改取最后一条 recommended 并去掉换次数相关字段，
MAX_SWAPS 一并删除。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 轮播 UI —— 滑动、「下一个」、「别再推这个」

**Files:**
- Modify: `index.html:17-25`
- Modify: `css/style.css`
- Modify: `src/ui-today.js`

**Interfaces:**
- Consumes: `rankCandidates` (Task 4)、`currentPick` 的 `{ activeDishId, activeReason }` (Task 5)
- Produces: 无下游消费者（UI 层终点）

- [ ] **Step 1: 改卡片结构**

`index.html` 中把

```html
    <button id="swap" class="swap" type="button">换一个</button>
```

改为

```html
    <button id="swap" class="swap" type="button">下一个</button>
```

并在 `copy-shop` 按钮之后加入：

```html
    <button id="mute" class="ghost" type="button">别再推这个</button>
```

- [ ] **Step 2: 加轮播位置指示的样式**

`css/style.css` 末尾加入：

```css
/* 轮播位置指示。不做圆点是因为候选可能有几十道，圆点会排到屏幕外。 */
.carousel-pos {
  color: var(--muted);
  font-size: 0.8rem;
  text-align: center;
  margin: 0.5rem 0 0;
}
```

并在 `index.html` 的 `copy-shop` 与 `mute` 之间插入：

```html
    <p id="carousel-pos" class="carousel-pos"></p>
```

- [ ] **Step 3: 在 `ui-today.js` 里建立轮播状态**

把 import 中的 `recommend` 改为 `rankCandidates`：

```js
import { rankCandidates } from './recommender.js';
```

把模块级状态改为：

```js
// ranked 是这一顿的完整候选列表，页面加载时算定，浏览期间不重算 ——
// 否则划着划着顺序会变。index 是当前停在第几道。
let state = { slot: null, dish: null, shop: null, ranked: [], index: 0 };
```

- [ ] **Step 4: 重写 `render()` 的选菜段落**

把 `render()` 中从 `const pick = currentPick(...)` 到 `await appendEvent({...type: 'recommended'...})` 结束的整段替换为：

```js
    const pick = currentPick(events, slot, nowKey);

    // 正在补问的那道菜不排在初始位置：不能一边问「上顿的黄焖鸡怎么样」
    // 一边又端上同一道黄焖鸡。但它仍留在轮播里，用户划得到。
    const asking = pendingFeedback(reduceObservations(events), now, slot);
    const ranked = rankCandidates({ dishes, shops, events, slot, now });

    if (ranked.length === 0) {
      el('failure').hidden = true;
      el('card').hidden = true;
      el('empty').hidden = false;
      return;
    }

    let index = 0;
    if (pick.activeDishId) {
      // 这一顿已经定过，回到那道菜上 —— 刷新与下单往返都不该改变所见。
      const found = ranked.findIndex((r) => r.dish.id === pick.activeDishId);
      if (found >= 0) index = found;
    } else {
      if (asking && ranked.length > 1 && ranked[0].dish.id === asking.dishId) {
        index = 1;
      }
      await appendEvent({
        slot, dishId: ranked[index].dish.id,
        type: 'recommended', value: ranked[index].reason,
      });
    }

    // shops 存进 state：翻页时 showAt 还要用它查店名，而 step() 是从
    // 按钮和手势里调的，拿不到 render() 的局部变量。
    // recordedDishId 记的是这一顿已经写进事件流的那道菜 ——「去下单」
    // 靠它判断要不要补写，省掉一次多余的 loadAll()。
    state = {
      slot, dish: null, shop: null, ranked, index, shops,
      recordedDishId: pick.activeDishId ?? ranked[index].dish.id,
    };
    showAt(index);
```

`reason` / `dish` 两个局部变量随之删除。

- [ ] **Step 5: 实现 `showAt` 与 `step`**

在 `render()` 之前加入：

```js
/** 把轮播的第 i 项画到卡片上。不写任何事件 —— 浏览是免费的。 */
function showAt(index) {
  const row = state.ranked[index];
  const shop = state.shops.find((s) => s.id === row.dish.shopId);
  state = { ...state, index, dish: row.dish, shop };

  el('slot-label').textContent = SLOT_LABELS[state.slot];
  el('dish-name').textContent = row.dish.name;
  el('shop-name').textContent = shop.name;
  el('price').textContent = `约 ¥${row.dish.refPrice}`;
  el('reason').textContent = row.reason;
  el('carousel-pos').textContent = `${index + 1} / ${state.ranked.length}`;
  el('failure').hidden = true;
  el('empty').hidden = true;
  el('card').hidden = false;
}

/** 前后翻一道，首尾相接。取模两次是为了让负数也落回正区间。 */
function step(delta) {
  if (state.ranked.length === 0) return;
  const n = state.ranked.length;
  showAt((((state.index + delta) % n) + n) % n);
}
```

- [ ] **Step 6: 接线「下一个」按钮**

把 `el('swap')` 的整个事件处理器替换为：

```js
el('swap').addEventListener('click', () => {
  step(1);
});
```

- [ ] **Step 7: 接线滑动手势**

在 `el('swap')` 处理器之后加入：

```js
// 左右滑动翻菜。阈值 50px，且横向位移必须明显大于纵向 ——
// 否则用户想纵向滚页面时会被误判成翻菜。
const SWIPE_MIN_X = 50;
let touchStartX = null;
let touchStartY = null;

el('card').addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}, { passive: true });

el('card').addEventListener('touchend', (e) => {
  if (touchStartX === null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  touchStartX = null;
  touchStartY = null;
  if (Math.abs(dx) < SWIPE_MIN_X) return;
  if (Math.abs(dx) <= Math.abs(dy)) return;
  step(dx < 0 ? 1 : -1);   // 左滑看下一道，右滑退回上一道
}, { passive: true });
```

- [ ] **Step 8: 接线「别再推这个」**

加入：

```js
el('mute').addEventListener('click', async () => {
  const dish = state.dish;
  if (!dish) return;
  try {
    await appendEvent({ slot: state.slot, dishId: dish.id, type: 'muted' });
  } catch (err) {
    // 记录失败不该拦住用户往下翻 —— 日志是记账，不是门槛。
    console.error('记录「别再推这个」事件失败', err);
  }
  // 排序已在加载时算定，这道菜本轮仍留在轮播里；静音下次加载才生效。
  // 但至少先把它翻过去，别让用户盯着一道刚被自己静音的菜。
  step(1);
});
```

- [ ] **Step 9: 让「去下单」在换了菜时补写 `recommended`**

把 `el('order')` 处理器中 `await appendEvent({... type: 'clicked' ...})` 之前插入：

```js
  // 用户可能浏览到了别的菜上。这一顿的观察值应当落在他真正下单的那道，
  // 所以先补一条 recommended —— 归约那边只认最后一条。
  // 用 state.recordedDishId 判断，不必再读一次库。
  if (state.recordedDishId !== state.dish.id) {
    try {
      await appendEvent({
        slot: state.slot, dishId: state.dish.id,
        type: 'recommended', value: state.ranked[state.index].reason,
      });
      state = { ...state, recordedDishId: state.dish.id };
    } catch (err) {
      // 补写失败就不改 recordedDishId，下次点还会再试一遍。
      console.error('补写 recommended 事件失败', err);
    }
  }
```

- [ ] **Step 10: 人工冒烟**

Run: `python -m http.server 8000`

在桌面浏览器打开 `http://localhost:8000/index.html`，用开发者工具把视口调到 375px，逐项确认：

1. 卡片底部显示 `1 / N`
2. 点「下一个」，菜名与理由变化，计数递增
3. 一直点到最后一道再点一次，回到 `1 / N`（循环成立）
4. 点「别再推这个」，卡片前进一道
5. 刷新页面，回到刚才停留的那道菜（因为下单前不写事件，此处应回到初始那道；若刚点过「去下单」则回到下单那道）
6. 没有横向溢出

- [ ] **Step 11: 运行测试**

Run: `node --test`
Expected: PASS（本任务不改纯模块，测试数应与 Task 5 结束时一致）。

- [ ] **Step 12: 提交**

```bash
git add index.html css/style.css src/ui-today.js
git commit -m "feat: 推荐卡片改成本地轮播，新增「别再推这个」

左右滑动在这一顿的全部候选中循环，无上限；「换一个」改名「下一个」，
保留作为滑动失灵时的兜底与发现性入口。浏览不写任何事件。

「去下单」时若当前这道菜与已记录的不同，先补一条 recommended ——
归约只认最后一条，这一顿的观察值才会落在真正下单的那道上。

滑动阈值 50px 且要求横向位移大于纵向，避免与纵向滚动打架。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 文档 —— 原 spec 注记与真机验收清单

**Files:**
- Modify: `docs/superpowers/specs/2026-08-22-meal-recommender-design.md`（§3.6、§5.3、§6.2、§6.3、§6.5、§6.6、§6.7、§7.1）
- Modify: `README.md`（真机验收清单）

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 给原 spec 受影响的各节加注记**

在 `docs/superpowers/specs/2026-08-22-meal-recommender-design.md` 的 §3.6、§5.3、§6.2、§6.3、§6.5、§6.6、§6.7、§7.1、§9.1 每节标题的下一行，各插入一行：

```markdown
> **已于 2026-08-26 修订**，见 `2026-08-26-browse-and-implicit-signals-design.md`。以下原文保留以便追溯当初为何这样设计。
```

原文一律不删。

§9.1 另需在那条列表项下补一句，因为它点名的测试用例本身已经作废：

```markdown
> 其中「连续换两次后仍能给出第三个不同的推荐」随 2026-08-26 修订作废 ——
> 换的次数已无上限，取而代之的是 `rankCandidates` 返回完整排序候选的测试。
```

- [ ] **Step 2: 往 README 验收清单加四条**

在 `README.md` 的「本轮修复新增的验收项」小节末尾追加：

```markdown
- [ ] **16. 左右滑动能在候选间循环翻看** —— 划到最后一道再划一次回到第一道；
  底部计数与实际位置一致
- [ ] **17. 滑动不与页面纵向滚动打架** —— 斜着划、纵向划都不该误触翻菜
- [ ] **18. 「别再推这个」按下后卡片前进一道**，且第二天打开时该菜明显靠后
  （注意本轮排序已算定，静音下次加载才生效）
- [ ] **19. 点「去下单」跳去外卖 App 再切回来，卡片仍停在下单那道菜、
  理由不变**，「换一个/下一个」照常可用 —— 与没点过时完全一致
```

并把「验收结果」一节里的总数从十五条改为十九条。

- [ ] **Step 3: 提交**

```bash
git add README.md docs/superpowers/specs/2026-08-22-meal-recommender-design.md
git commit -m "docs: 原 spec 受影响章节加修订注记，验收清单加四条

原 spec 各节原文保留 —— 追溯当初为何那样设计，比让文档看起来
永远正确更有用。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 自查记录

**Spec 覆盖：** §3.1/§3.2 → Task 4 + Task 6；§3.3 → Task 3 + Task 6 Step 8；§3.4 → Task 1；§3.5 → Task 1（保留 `IMPLICIT_CLICKED` 不动）；§3.6 → Task 1；§3.7 → Task 2 + Task 5 + Task 6 Step 9；§3.8 → 不实现，无对应任务（有意）；§4.1/§4.2/§4.3 → Task 6；§5 → Task 5（`recommended.value`）+ Task 6（`muted` 写入）；§6.1 → Task 2；§6.2 → Task 1；§7.1 → Task 1；§7.2 → Task 3；§7.3 → Task 3 Step 7；§7.4 → Task 1 Step 7 + Task 3 Step 3 + Task 5 Step 5；§9 → 各任务的测试步骤 + Task 7 Step 2；§10 → Task 7 Step 1（含原 spec §9.1 —— 它点名的「连续换两次后仍能给出第三个不同的推荐」随本次修订作废，须一并注记）。

**未覆盖、且不属于本次范围的既有遗留：** 原 spec §9.1 要求「`store` 必须测导出 → 导入的往返一致性」，而 §3.4 禁止引入 `fake-indexeddb`，两条互相矛盾，至今未在文档里注明取舍。这不是本次改动引入的，也不该由本计划顺手处理 —— 单独记在遗留清单里。

**已知未覆盖：** spec §9 列的「滑动与纵向滚动不冲突」「静音后的实际观感」等真机项，按设计本就无法自动化，已写进 README 第 16–19 条。

**类型一致性：** `currentPick` 在 Task 5 定义为 `{ activeDishId, activeReason }`，Task 6 Step 4 与 Step 9 均按此消费。`rankCandidates` 在 Task 4 定义为返回 `{ dish, reason, score }[]`，Task 6 Step 4/5/9 按此消费。`muteOf` 在 Task 3 定义为接收 `{ lastMutedKey, nowKey }`，Task 4 的 `rankCandidates` 按此调用。观察值 `value` 的 `number | null` 契约在 Task 1 确立，Task 2、Task 3 的测试均按此断言。
