# 「这一顿」的身份与补问时机 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「一条事件属于哪天的哪一顿」显式记录在事件上，并让补问等外卖吃完再问、且优先问真正下过单的那一顿。

**Architecture:** `recommended` / `clicked` 事件增加可选字段 `dateKey`，由页面渲染时记下；纯模块 `observations.js` 归约时优先用它、没有才按写入时刻推算。补问挑选拆成 `feedbackCandidate`（挑哪一顿，不管推迟）与 `pendingFeedback`（到期才返回），推迟时长放 `config.js`。UI 只负责把 `dateKey` 传下去、启动时共用一个 `now`、守卫改调 `feedbackCandidate`。

**Tech Stack:** 原生 ES modules，Node 自带 `node --test`，IndexedDB。零依赖、零构建。

**Spec:** `docs/superpowers/specs/2026-09-13-meal-identity-and-feedback-timing-design.md`（执行前通读；本计划的每条规则都出自它）

## Global Constraints

- 零运行时依赖，零构建步骤；不装任何 npm 包；`package.json` 只允许 `name` / `private` / `type`
- 纯模块 `src/config.js` `src/dates.js` `src/observations.js` `src/recommender.js` `src/snapshot.js` 不得触碰时钟、随机数、DOM、存储；时间一律作为参数注入
- 可调常数只放 `src/config.js`；单位换算（如分钟→毫秒）留在各自模块
- 面向用户的文案一律简体中文
- 事件日志只追加、不修改；老事件与导入的旧快照没有 `dateKey`，行为必须与现在完全一致
- 不迁移数据，不升 `SNAPSHOT_VERSION`
- 现有 131 条测试**一条不改**，全部通过
- 在分支 `fix/meal-key` 上工作；**不要 `git push`，不要合并进 `main`** —— 由用户决定
- 提交信息结尾加：`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- 计划里给出的行号只作参考；**一律按引用的原文定位**（前面的步骤插入内容后，后面的行号会移位）

## 文件结构

| 文件 | 改动 | 职责 |
|---|---|---|
| `src/observations.js` | 修改 | Pass 1 取 `e.dateKey`；Pass 2 新增 `dateKey` 精确挂载层；观察值加 `clickedTs`；`currentPick` 取 `e.dateKey`；新增 `feedbackCandidate`，改写 `pendingFeedback` |
| `src/config.js` | 修改 | 新增 `FEEDBACK_DELAY_MINUTES: 120` |
| `src/store.js` | 修改 | `appendEvent` 接受 `dateKey` |
| `src/ui-today.js` | 修改 | `render(now)` / `renderFeedback(now)`；`state.dateKey`；写事件带 `dateKey`；守卫改调 `feedbackCandidate` |
| `test/observations.test.js` | 修改 | 追加 12 条测试（文件末尾） |
| 文档 | 修改 | 两份旧 spec 加注记、`CLAUDE.md` 指路、`README.md` 验收第 21/22 条、`TODO.md` |

---

### Task 1: 归约与 `currentPick` 认事件自带的 `dateKey`（spec §3.1–3.2、§3.4）

**Files:**
- Modify: `src/observations.js`（Pass 1 约第 19–22 行；Pass 2 约第 75–92 行；`currentPick` 约第 224 行）
- Test: `test/observations.test.js`（追加到文件末尾）

**Interfaces:**
- Consumes: 现有 `reduceObservations(events)`、`currentPick(events, slot, nowKey)`、测试文件里已有的 `ev(type, dishId, ts, slot = 'lunch', value = null)` 辅助函数
- Produces: 事件上可选字段 `dateKey: 'YYYY-MM-DD'`；`reduceObservations` 与 `currentPick` 对它的识别。Task 3 的 UI 写入依赖这个字段名

- [ ] **Step 1: 写三条失败测试（分组、端到端、currentPick）**

追加到 `test/observations.test.js` 末尾：

```js
// ---- 2026-09-13：事件自带 dateKey（spec 2026-09-13 §3）----

const late = (d, h, m) => new Date(2026, 8, d, h, m).getTime(); // 本地 2026-09-d h:m

test('带 dateKey 的 recommended 按 dateKey 分组，而不是写入时刻', () => {
  // 23:55 打开、00:05 才补写：写入时刻已是 9/12，但这顿属于 9/11
  const obs = reduceObservations([
    { ...ev('recommended', 'B', late(12, 0, 5), 'dinner'), dateKey: '2026-09-11' },
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].dateKey, '2026-09-11');
});

test('跨零点下单：只留下前一天那顿，且落在下单的那道菜上', () => {
  const events = [
    { ...ev('recommended', 'A', late(11, 23, 55), 'dinner', '还没试过，试试看'), dateKey: '2026-09-11' },
    { ...ev('recommended', 'B', late(12, 0, 5), 'dinner', '同类里最便宜'), dateKey: '2026-09-11' },
    { ...ev('clicked', 'B', late(12, 0, 5) + 1000, 'dinner'), dateKey: '2026-09-11' },
  ];
  assert.deepEqual(
    reduceObservations(events).map((o) => [o.dateKey, o.slot, o.dishId, o.source]),
    [['2026-09-11', 'dinner', 'B', 'clicked']],
  );
});

test('currentPick 认事件自带的 dateKey：跨零点下单不会预先定下第二天那顿', () => {
  const events = [
    { ...ev('recommended', 'A', late(11, 23, 55), 'dinner', '还没试过，试试看'), dateKey: '2026-09-11' },
    { ...ev('recommended', 'B', late(12, 0, 5), 'dinner', '同类里最便宜'), dateKey: '2026-09-11' },
  ];
  assert.equal(currentPick(events, 'dinner', '2026-09-12').activeDishId, null);
  assert.equal(currentPick(events, 'dinner', '2026-09-11').activeDishId, 'B');
});
```

- [ ] **Step 2: 运行，确认三条都失败**

Run: `node --test test/observations.test.js`
Expected: 3 条 FAIL —— 第一条 `'2026-09-12' !== '2026-09-11'`；第二条得到两条观察值（A 于 09-11 为 `none`，B 于 09-12 为 `clicked`）；第三条 09-12 返回 `'B'`。其余 131 条 PASS。

- [ ] **Step 3: 实现 Pass 1 与 `currentPick`**

`src/observations.js` Pass 1，把

```js
    if (e.type === 'recommended') {
      const dateKey = localDateKey(e.ts);
```

改为

```js
    if (e.type === 'recommended') {
      // 事件自带 dateKey 时以它为准：它记的是「这一顿」属于哪天，
      // 而写入时刻可能已经跨过零点（23:55 打开、00:05 才点下单）。
      // 老事件和导入的旧快照没有这个字段，退回按写入时刻推算。
      const dateKey = e.dateKey ?? localDateKey(e.ts);
```

`currentPick` 里，把

```js
    if (localDateKey(e.ts) !== nowKey) continue;
```

改为

```js
    // 同 reduceObservations：优先认事件自带的 dateKey。
    if ((e.dateKey ?? localDateKey(e.ts)) !== nowKey) continue;
```

- [ ] **Step 4: 运行，确认通过**

Run: `node --test`
Expected: 134 条全部 PASS。

- [ ] **Step 5: 写 Pass 2 精确挂载的失败测试**

追加到文件末尾：

```js
test('带 dateKey 的 clicked 落到 dateKey 指定的那一组，即使启发式会挑另一组', () => {
  const obs = reduceObservations([
    // 9/11 晚餐那顿，00:05 补写
    { ...ev('recommended', 'B', late(12, 0, 5), 'dinner'), dateKey: '2026-09-11' },
    // 另一组：没有 dateKey 的老事件，按写入时刻归到 9/12，且更接近点击时刻
    ev('recommended', 'B', late(12, 0, 10), 'dinner'),
    // 点击属于 9/11 那顿；「ts 最大且 <= 点击时刻」的启发式会挑 00:10 那组
    { ...ev('clicked', 'B', late(12, 0, 15), 'dinner'), dateKey: '2026-09-11' },
  ]);
  assert.deepEqual(
    obs.map((o) => [o.dateKey, o.source]),
    [['2026-09-11', 'clicked'], ['2026-09-12', 'none']],
  );
});
```

- [ ] **Step 6: 运行，确认失败**

Run: `node --test test/observations.test.js`
Expected: 这一条 FAIL，得到 `[['2026-09-11', 'none'], ['2026-09-12', 'clicked']]`。

- [ ] **Step 7: 实现 Pass 2 的 `dateKey` 层**

`src/observations.js` Pass 2，在 `targetTs` 那段之后、启发式那段之前插入：

```js
    if (e.targetTs != null) {
      targetGroup = candidates.find((g) => g.ts === e.targetTs) ?? null;
    }

    // clicked 带着页面渲染时记下的 dateKey，直接落到那一顿 ——
    // 不靠写入先后去猜：跨零点时，启发式可能挂到另一组上。
    if (!targetGroup && e.dateKey != null) {
      targetGroup = groups.get(`${e.dateKey}|${e.slot}|${e.dishId}`) ?? null;
    }
```

同时把启发式那段上方的注释

```js
    // 没有 targetTs（旧事件、导入的快照），或它指向的组已不存在时，
```

改为

```js
    // 既没有 targetTs 也没有 dateKey（旧事件、导入的快照），或指向的组已不存在时，
```

- [ ] **Step 8: 运行全部测试**

Run: `node --test`
Expected: 135 条全部 PASS。

- [ ] **Step 9: Commit**

```bash
git add src/observations.js test/observations.test.js
git commit -m "fix: 归约与 currentPick 认事件自带的 dateKey，跨零点下单不再记错日期

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 补问推迟到下单后 N 分钟，并优先问下过单的那一顿（spec §3.3、§4）

**Files:**
- Modify: `src/config.js`（`CONFIG` 对象内）
- Modify: `src/observations.js`（归约输出加 `clickedTs`；替换 `pendingFeedback`，新增 `feedbackCandidate`）
- Test: `test/observations.test.js`（第 3 行 import；追加到文件末尾）

**Interfaces:**
- Consumes: Task 1 的 `late(d, h, m)` 测试辅助函数；观察值字段 `dishId` `dateKey` `slot` `ts` `source`
- Produces:
  - `CONFIG.FEEDBACK_DELAY_MINUTES`（number，默认 `120`）
  - 观察值新字段 `clickedTs: number | null`
  - `feedbackCandidate(observations, nowTs, slot) → observation | null`（Task 3 的守卫调用）
  - `pendingFeedback(observations, nowTs, slot) → observation | null`（签名不变）

- [ ] **Step 1: 改 import，写 `clickedTs` 与补问规则的失败测试**

`test/observations.test.js` 第 3 行，把

```js
import { reduceObservations, buildEatenIndex, buildMutedIndex, pendingFeedback, currentPick } from '../src/observations.js';
```

改为

```js
import { reduceObservations, buildEatenIndex, buildMutedIndex, pendingFeedback, feedbackCandidate, currentPick } from '../src/observations.js';
import { CONFIG } from '../src/config.js';
```

追加到文件末尾：

```js
// ---- 2026-09-13：补问时机（spec 2026-09-13 §4）----

test('观察值带 clickedTs：组内最后一次点下单的时刻，没点过为 null', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', late(11, 12, 0)),
    ev('clicked', 'd1', late(11, 12, 3)),
    ev('clicked', 'd1', late(11, 12, 7)),
    ev('recommended', 'd2', late(11, 19, 0), 'dinner'),
  ]);
  assert.equal(obs[0].clickedTs, late(11, 12, 7));
  assert.equal(obs[1].clickedTs, null);
});

const DELAY_MS = CONFIG.FEEDBACK_DELAY_MINUTES * 60 * 1000;

// 手工构造观察值；dateKey 与 ts 同在本地 2026-09-d
const meal = (dishId, d, h, m, slot, source, clickedTs = null) => ({
  dishId,
  dateKey: `2026-09-${String(d).padStart(2, '0')}`,
  slot,
  ts: late(d, h, m),
  value: source === 'none' ? null : 0.5,
  source,
  ratedValue: source === 'rated' ? 'ok' : null,
  eaten: source === 'rated',
  clickedTs,
});

test('下单才 10 分钟、已换饭点：不补问，但 feedbackCandidate 仍能挑出它', () => {
  const observations = [meal('burger', 11, 10, 25, 'breakfast', 'clicked', late(11, 10, 26))];
  const now = late(11, 10, 36);
  assert.equal(pendingFeedback(observations, now, 'lunch'), null);
  assert.equal(feedbackCandidate(observations, now, 'lunch').dishId, 'burger');
});

test('离下单恰好满推迟时长时补问，差 1 毫秒则不问', () => {
  const clickedAt = late(11, 10, 26);
  const observations = [meal('burger', 11, 10, 25, 'breakfast', 'clicked', clickedAt)];
  assert.equal(pendingFeedback(observations, clickedAt + DELAY_MS, 'lunch').dishId, 'burger');
  assert.equal(pendingFeedback(observations, clickedAt + DELAY_MS - 1, 'lunch'), null);
});

test('边界前下单的那顿，不会被之后一条没点过的推荐挡住', () => {
  const observations = [
    meal('burger', 11, 10, 25, 'breakfast', 'clicked', late(11, 10, 26)),
    meal('noodle', 11, 10, 35, 'lunch', 'none'), // 10:35 打开时为午餐写下的，没点
  ];
  assert.equal(pendingFeedback(observations, late(11, 12, 30), 'lunch').dishId, 'burger');
  assert.equal(pendingFeedback(observations, late(11, 18, 0), 'dinner').dishId, 'burger');
});

test('推迟期间不拿更新的、没点过的记录顶上', () => {
  // 早餐那顿的卡片一直开着，17:50 才点下单；中间另有一条没点过的午餐记录。
  // 若推迟期间改问午餐，用户随手一答，早餐就因早于「最近已评分」而永远问不到。
  const observations = [
    meal('burger', 11, 10, 25, 'breakfast', 'clicked', late(11, 17, 50)),
    meal('rice', 11, 12, 0, 'lunch', 'none'),
  ];
  const now = late(11, 18, 0);
  assert.equal(pendingFeedback(observations, now, 'dinner'), null);
  assert.equal(feedbackCandidate(observations, now, 'dinner').dishId, 'burger');
});

test('早于最近一顿已评分的下单记录不算候选，退回旧规则', () => {
  // 在旧代码上本就通过；防的是漏掉「晚于最近已评分」限制的错误实现 ——
  // 那样会把两天前的 burger 翻出来追问（spec §6.1 第 10 条）。
  const observations = [
    meal('burger', 9, 12, 0, 'lunch', 'clicked', late(9, 12, 1)),
    meal('soup', 10, 19, 0, 'dinner', 'rated'),
    meal('rice', 11, 12, 0, 'lunch', 'none'),
  ];
  assert.equal(pendingFeedback(observations, late(11, 19, 0), 'dinner').dishId, 'rice');
});

test('当前这顿下过单也不算候选；更早一顿下过单的照样问', () => {
  const observations = [
    meal('burger', 11, 8, 0, 'breakfast', 'clicked', late(11, 8, 1)),
    meal('noodle', 11, 12, 0, 'lunch', 'clicked', late(11, 12, 5)),
  ];
  assert.equal(pendingFeedback(observations, late(11, 14, 30), 'lunch').dishId, 'burger');
});

test('连着下两顿：先问早餐，评完再问午餐', () => {
  const breakfast = meal('burger', 11, 10, 25, 'breakfast', 'clicked', late(11, 10, 26));
  const lunch = meal('noodle', 11, 11, 0, 'lunch', 'clicked', late(11, 11, 1));
  assert.equal(pendingFeedback([breakfast, lunch], late(11, 13, 0), 'lunch').dishId, 'burger');

  const rated = { ...breakfast, source: 'rated', ratedValue: 'ok', eaten: true };
  assert.equal(pendingFeedback([rated, lunch], late(11, 15, 30), 'dinner').dishId, 'noodle');
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test test/observations.test.js`
Expected: 整个文件 FAIL，报 `SyntaxError: The requested module '../src/observations.js' does not provide an export named 'feedbackCandidate'`（import 失败会让该文件全部测试无法运行，这是预期的）。

- [ ] **Step 3: 加常数**

`src/config.js`，在 `MUTE_TAU_DAYS: 14,` 下一行加：

```js
  FEEDBACK_DELAY_MINUTES: 120,
```

- [ ] **Step 4: 归约输出加 `clickedTs`**

`src/observations.js` 顶部 import 之后加一行：

```js
const MINUTE_MS = 60 * 1000;
```

「减缩每个组」循环里，在

```js
    const clicked = group.events.find((e) => e.type === 'clicked');
```

之后加：

```js
    // 推迟补问要从下单那一刻起算；观察值的 ts 是推荐时刻，不是下单时刻。
    const clickedTs = group.events
      .filter((e) => e.type === 'clicked')
      .reduce((max, e) => (max === null || e.ts > max ? e.ts : max), null);
```

`out.push({ ... })` 里，在 `eaten: ...` 之后加一行：

```js
      clickedTs,
```

- [ ] **Step 5: 替换 `pendingFeedback`，新增 `feedbackCandidate`**

把现有的整个 `pendingFeedback`（从 `/**` 注释「下次打开时该补问哪一顿」到函数结束的 `}`）替换为：

```js
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
 */
export function feedbackCandidate(observations, nowTs, slot) {
  if (observations.length === 0) return null;

  const nowKey = localDateKey(nowTs);
  const isCurrent = (o) => o.dateKey === nowKey && o.slot === slot;

  let lastRatedTs = -Infinity;
  for (const o of observations) {
    if (o.source === 'rated' && o.ts > lastRatedTs) lastRatedTs = o.ts;
  }

  let candidate = null;
  for (const o of observations) {
    if (o.source !== 'clicked' || isCurrent(o) || o.ts <= lastRatedTs) continue;
    if (candidate === null || o.ts > candidate.ts) candidate = o;
  }
  if (candidate) return candidate;

  const latest = observations.reduce((a, b) => (b.ts > a.ts ? b : a));
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
export function pendingFeedback(observations, nowTs, slot) {
  const c = feedbackCandidate(observations, nowTs, slot);
  if (c === null) return null;
  if (c.source === 'clicked') {
    // 手工构造的观察值（现有测试里就有）可能没有 clickedTs，退回推荐时刻。
    const clickedAt = c.clickedTs ?? c.ts;
    if (nowTs - clickedAt < CONFIG.FEEDBACK_DELAY_MINUTES * MINUTE_MS) return null;
  }
  return c;
}
```

- [ ] **Step 6: 运行全部测试**

Run: `node --test`
Expected: 143 条全部 PASS（131 + Task 1 的 4 条 + 本任务 8 条）。若现有的 `pendingFeedback` 测试有任何一条失败，**停下来报告**，不要改那条测试 —— Global Constraints 要求它们一条不改。

- [ ] **Step 7: Commit**

```bash
git add src/config.js src/observations.js test/observations.test.js
git commit -m "fix: 补问推迟到下单后 FEEDBACK_DELAY_MINUTES，并优先问下过单的那一顿

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 页面写入 `dateKey`、启动共用 `now`、守卫改调 `feedbackCandidate`（spec §3.1、§4.4、§5）

`store.js` 与 `ui-*.js` 没有自动化测试（Node 无 IndexedDB，引入 `fake-indexeddb` 破坏零依赖）。本任务用浏览器实测收尾。

**Files:**
- Modify: `src/store.js`（`appendEvent`，约第 96–98 行）
- Modify: `src/ui-today.js`（import 第 3 行；`state` 第 27 行；`renderFeedback` 第 37–40 行；`render` 第 172–226 行；`recordOrder` 第 240–258 行；文件末尾第 347–348 行）

**Interfaces:**
- Consumes: Task 1 的事件字段 `dateKey`；Task 2 的 `feedbackCandidate(observations, nowTs, slot)`
- Produces: `appendEvent({ slot, dishId, type, value = null, targetTs = null, dateKey = null })`；`state.dateKey`

- [ ] **Step 1: `store.js` 接受 `dateKey`**

把

```js
export async function appendEvent({ slot, dishId, type, value = null, targetTs = null }) {
  const event = { id: newId(), ts: Date.now(), slot, dishId, type, value };
  if (targetTs != null) event.targetTs = targetTs;
```

改为

```js
export async function appendEvent({ slot, dishId, type, value = null, targetTs = null, dateKey = null }) {
  const event = { id: newId(), ts: Date.now(), slot, dishId, type, value };
  if (targetTs != null) event.targetTs = targetTs;
  // 这条事件属于哪天的那一顿。由页面渲染时记下，不能从 ts 推 —— 写入时刻可能已跨过零点。
  if (dateKey != null) event.dateKey = dateKey;
```

- [ ] **Step 2: `ui-today.js` import 与 `state`**

第 3 行

```js
import { currentPick, pendingFeedback, reduceObservations } from './observations.js';
```

改为

```js
import { currentPick, feedbackCandidate, pendingFeedback, reduceObservations } from './observations.js';
```

第 27 行

```js
let state = { slot: null, dish: null, shop: null, ranked: [], index: 0, shops: [], recordedDishId: null };
```

改为

```js
let state = { slot: null, dateKey: null, dish: null, shop: null, ranked: [], index: 0, shops: [], recordedDishId: null };
```

- [ ] **Step 3: `renderFeedback` 接收 `now`**

把

```js
async function renderFeedback() {
  try {
    const now = Date.now();
    const slot = resolveSlot(now);
```

改为

```js
async function renderFeedback(now = Date.now()) {
  try {
    const slot = resolveSlot(now);
```

- [ ] **Step 4: `render` 接收 `now`、守卫改调、写入带 `dateKey`**

把

```js
async function render() {
  try {
    const now = Date.now();
    const slot = resolveSlot(now);
```

改为

```js
async function render(now = Date.now()) {
  try {
    const slot = resolveSlot(now);
```

把

```js
    const asking = pendingFeedback(reduceObservations(events), now, slot);
```

改为

```js
    // 用 feedbackCandidate 而不是 pendingFeedback：推迟期间浮层不弹，
    // 但刚下单还没评分的那道菜同样不该排在开场位（spec 2026-09-13 §4.4）。
    const asking = feedbackCandidate(reduceObservations(events), now, slot);
```

把

```js
      await appendEvent({
        slot, dishId: ranked[index].dish.id,
        type: 'recommended', value: ranked[index].reason,
      });
```

改为

```js
      await appendEvent({
        slot, dateKey: nowKey, dishId: ranked[index].dish.id,
        type: 'recommended', value: ranked[index].reason,
      });
```

把

```js
    state = {
      slot, dish: null, shop: null, ranked, index, shops,
      recordedDishId: ranked[index].dish.id,
    };
```

改为

```js
    // dateKey 与 slot 一起定格在渲染这一刻：之后在这张卡片上下单，
    // 哪怕已经过了零点，事件也属于这一顿。
    state = {
      slot, dateKey: nowKey, dish: null, shop: null, ranked, index, shops,
      recordedDishId: ranked[index].dish.id,
    };
```

- [ ] **Step 5: `recordOrder` 带 `dateKey`**

把

```js
async function recordOrder({ slot, dish, ranked, index, recordedDishId }) {
```

改为

```js
async function recordOrder({ slot, dateKey, dish, ranked, index, recordedDishId }) {
```

把

```js
      await appendEvent({
        slot, dishId: dish.id, type: 'recommended', value: ranked[index].reason,
      });
```

改为

```js
      await appendEvent({
        slot, dateKey, dishId: dish.id, type: 'recommended', value: ranked[index].reason,
      });
```

把

```js
    await appendEvent({ slot, dishId: dish.id, type: 'clicked' });
```

改为

```js
    await appendEvent({ slot, dateKey, dishId: dish.id, type: 'clicked' });
```

- [ ] **Step 6: 启动共用一个 `now`**

文件末尾

```js
await renderFeedback();
await render();
```

改为

```js
// 启动时只读一次时钟：两者各读一次的话，恰好跨过饭点边界时
// 会一个按早餐算、一个按午餐算。评分后重渲染与「重试」照旧各取当下时刻。
const startedAt = Date.now();
await renderFeedback(startedAt);
await render(startedAt);
```

- [ ] **Step 7: 确认没有把 `render` / `renderFeedback` 直接当事件监听器传**

直接传进 `addEventListener` 的话，第一个参数会是 `Event` 对象，被当成 `now`。

Run: `grep -nE "addEventListener\([^)]*,\s*(render|renderFeedback)\s*\)" src/ui-today.js`
Expected: 无输出。

Run: `node --test && for f in src/*.js; do node --check "$f" || echo "FAIL $f"; done`
Expected: 143 条 PASS，无 `FAIL`。

- [ ] **Step 8: 浏览器实测**

用 `.claude/launch.json` 里的 `meal-fresh`（端口 8042，避开之前的缓存）启动预览，打开 `http://localhost:8042/pool.html`，视口设 375×812。浏览器缓存曾让改动看起来没生效，读结果前先确认模块是新的：页面源码里 `src/ui-today.js` 应含 `feedbackCandidate`。

**8a. 播种**：在 `pool.html` 页面执行（用页面自己的表单，保证数据形状真实）：

```js
async function addShop(name, link) {
  const f = document.getElementById('shop-form');
  f.querySelector('[name=name]').value = name;
  f.querySelector('[name=link]').value = link;
  f.requestSubmit();
  await new Promise((r) => setTimeout(r, 500));
}
async function addDish(shopName, dishName, price) {
  const block = [...document.querySelectorAll('.shop-block')].find((b) => b.textContent.includes(shopName));
  const f = block.querySelector('form');
  f.querySelector('[name=name]').value = dishName;
  f.querySelector('[name=refPrice]').value = String(price);
  f.requestSubmit();
  await new Promise((r) => setTimeout(r, 500));
}
await addShop('验证甲店', 'https://example.com/a');
await addDish('验证甲店', '甲菜', 20);
await addShop('验证乙店', 'https://example.com/b');
await addDish('验证乙店', '乙菜', 30);
document.querySelectorAll('.dish-row').length;
```

Expected: `2`。

**8b. 首次推荐带 `dateKey`**：导航到 `http://localhost:8042/index.html`，等 1 秒后执行：

```js
const readEvents = () => new Promise((res, rej) => {
  const r = indexedDB.open('meal', 1);
  r.onsuccess = () => {
    const tx = r.result.transaction('events', 'readonly');
    const q = tx.objectStore('events').getAll();
    tx.oncomplete = () => res(q.result);
    tx.onerror = () => rej(tx.error);
  };
  r.onerror = () => rej(r.error);
});
(await readEvents()).filter((e) => e.type === 'recommended').map((e) => ({ slot: e.slot, dateKey: e.dateKey }));
```

Expected: 恰好一条，`dateKey` 等于今天的本地日期 `YYYY-MM-DD`。

**8c. 点下单写入的事件带 `dateKey`**：

```js
document.addEventListener('click', (e) => { if (e.target.id === 'order') e.preventDefault(); }, true);
document.getElementById('swap').click();          // 划到另一道，触发补写 recommended
await new Promise((r) => setTimeout(r, 200));
document.getElementById('order').click();
await new Promise((r) => setTimeout(r, 500));
(await readEvents()).sort((a, b) => a.ts - b.ts).map((e) => [e.type, e.dateKey ?? '(无)']);
```

Expected: 三条 —— `recommended`、`recommended`（补写）、`clicked`，`dateKey` 都是今天。

**8d. 推迟期间不补问，且刚下单的菜不在开场位**：

构造「10 分钟前在另一个饭点下过单，那道菜本该排第一」的局面：把另一道菜静音压到末位，再清掉今天当前饭点的推荐，让页面重新推荐。

```js
const writeEvents = (fn) => new Promise((res, rej) => {
  const r = indexedDB.open('meal', 1);
  r.onsuccess = () => {
    const tx = r.result.transaction(['events', 'dishes'], 'readwrite');
    fn(tx.objectStore('events'), tx.objectStore('dishes'));
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  };
  r.onerror = () => rej(r.error);
});
const now = Date.now();
const today = new Date(now);
const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const mins = today.getHours() * 60 + today.getMinutes();
const cur = mins < 630 ? 'breakfast' : mins < 900 ? 'lunch' : 'dinner';
const other = cur === 'dinner' ? 'lunch' : 'dinner';   // 与当前不同的饭点
let dishes;
await writeEvents((ev, ds) => { ds.getAll().onsuccess = (e) => { dishes = e.target.result; }; });
const jia = dishes.find((d) => d.name === '甲菜');
const yi = dishes.find((d) => d.name === '乙菜');
await writeEvents((ev, ds) => {
  // 两道菜都要能在当前饭点被推（加菜表单默认三个饭点全勾，这里保险起见再写一遍）
  for (const d of [jia, yi]) ds.put({ ...d, slots: ['breakfast', 'lunch', 'dinner'] });
  ev.clear();
  // 甲菜：10 分钟前在「另一个饭点」下过单、没评分 —— 推迟中
  ev.add({ id: crypto.randomUUID(), ts: now - 11 * 60000, slot: other, dateKey: key, dishId: jia.id, type: 'recommended', value: '验证' });
  ev.add({ id: crypto.randomUUID(), ts: now - 10 * 60000, slot: other, dateKey: key, dishId: jia.id, type: 'clicked', value: null });
  // 乙菜静音，保证甲菜本该排第一
  ev.add({ id: crypto.randomUUID(), ts: now - 60000, slot: cur, dishId: yi.id, type: 'muted', value: null });
});
location.reload();
```

等 1 秒后执行：

```js
({
  浮层隐藏: document.getElementById('feedback').hidden,
  开场这道: document.getElementById('dish-name').textContent,
  位置: document.getElementById('carousel-pos').textContent,
});
```

Expected: `浮层隐藏: true`；`开场这道: '乙菜'`，`位置: '2 / 2'` —— 甲菜本该排第一，被守卫顺延（注意 `other` 与 `cur` 不同，否则甲菜那组会被当成当前这顿，局面不成立）。

**8e. 推迟到期后补问出现**：把上面 `ts` 的两个 `10`/`11` 分钟改成 `130`/`131` 分钟重跑 8d。
Expected: `浮层隐藏: false`，浮层问的是「上顿的甲菜怎么样？」。

实测完把视口恢复为 desktop。

- [ ] **Step 9: Commit**

```bash
git add src/store.js src/ui-today.js
git commit -m "fix: 页面写事件时带上这一顿的 dateKey，启动共用一个 now，守卫改看补问候选

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 文档（spec §6.3、§8）

**Files:**
- Modify: `docs/superpowers/specs/2026-08-26-browse-and-implicit-signals-design.md`（第 141 行后）
- Modify: `docs/superpowers/specs/2026-08-22-meal-recommender-design.md`（第 315 行后）
- Modify: `CLAUDE.md`（第 46 行）
- Modify: `README.md`（第 164 行、第 364 行后、第 377 行）
- Modify: `TODO.md`（gitignore，改完不提交）

**Interfaces:**
- Consumes: Task 1–3 已落地的行为
- Produces: 无代码接口

- [ ] **Step 1: 08-26 spec §6 加注记**

在 `## 6. 归约规则变更（改写原 spec §6.2）` 这一行之后插入（与标题之间空一行）：

```markdown
> **已于 2026-09-13 修订**，见 `2026-09-13-meal-identity-and-feedback-timing-design.md` §3：
> 分组日期优先取事件自带的 `dateKey`，`clicked` 带 `dateKey` 时精确挂到那一顿。以下原文保留。
```

- [ ] **Step 2: 原 spec §7.3 加注记**

在 `### 7.3 反馈浮层` 这一行之后插入（与标题之间空一行）：

```markdown
> **补问时机已于 2026-09-13 修订**，见 `2026-09-13-meal-identity-and-feedback-timing-design.md` §4：
> 下过单的那顿满 `FEEDBACK_DELAY_MINUTES` 才补问，且优先问最近下过单、还没评分的那一顿。以下原文保留。
```

- [ ] **Step 3: `CLAUDE.md` 指路**

第 46 行里，把

```markdown
**改归约逻辑前先读 `2026-08-26-browse-and-implicit-signals-design.md` 的 §6.2**（改写了 `2026-08-22` 那份的同名节）—— 这里踩过一次坑。
```

改为

```markdown
**改归约逻辑前先读 `2026-08-26-browse-and-implicit-signals-design.md` 的 §6.2**（改写了 `2026-08-22` 那份的同名节）**和 `2026-09-13-meal-identity-and-feedback-timing-design.md`**（`recommended` / `clicked` 自带 `dateKey`，补问推迟与挑选规则）—— 这里踩过两次坑。
```

- [ ] **Step 4: `README.md` 新增验收第 21、22 条**

第 364 行（第 20 条最后一行 `` `left: 50% + translateX(-50%)`），但从来没拿一个真的长名字试过。 ``）之后插入（前后各空一行，顺带修掉这里与下一段粘连的排版）：

```markdown

### 2026-09-13「这一顿」的身份与补问时机新增

- [ ] **21. 饭点边界前下单，2 小时内重新打开** —— 卡片切到新饭点、**不弹补问**、
  刚下单的那道菜不在第一位；满 2 小时后再打开，补问的是那一顿。
  日常使用即可遇到（10:30、15:00 前后下单）。验证靠导出备份：那顿的 `clicked`
  时刻与补问浮层出现的时间差应不小于 `FEEDBACK_DELAY_MINUTES`。
- [ ] **22. 跨零点下单**（可选，要熬夜）—— 23:5x 打开 App、过 0 点后点「去下单」。
  次日同饭点打开时**不会**被预先定下；导出备份中这两条事件的 `dateKey` 是前一天。

```

第 164 行

```markdown
**2026-09-13 验收完成**：20 条通过 19 条，第 3 条（美团跳转）结案推迟到后端版本。
```

改为

```markdown
**2026-09-13 v1 验收完成**：20 条通过 19 条，第 3 条（美团跳转）结案推迟到后端版本。
其后新增第 21、22 条（「这一顿」的身份与补问时机），尚未验收。
```

第 377 行

```markdown
验收完成：**已通过 19 / 20**，唯一未通过的第 3 条已结案推迟到后端版本。
```

改为

```markdown
**已通过 19 / 22**：v1 的 20 条中第 3 条已结案推迟到后端版本；第 21、22 条为 2026-09-13 新增，尚未验收（第 22 条可选）。
```

- [ ] **Step 5: `TODO.md`**

把「【一个根因，两个症状】事件属于哪一顿是推导出来的，不是记录下来的」整条替换为：

```markdown
- [ ] **「这一顿」的身份与补问时机** —— 2026-09-13 设计与实现在分支 `fix/meal-key`

  spec：`docs/superpowers/specs/2026-09-13-meal-identity-and-feedback-timing-design.md`
  plan：`docs/superpowers/plans/2026-09-13-meal-identity-and-feedback-timing.md`

  原先记作「一个根因两个症状」，重放后确认是**两个根因**：R1 这一顿属于哪天是从写入
  时刻推出来的（跨零点下单记错日期）；R2 哪一顿算当前这顿只看时钟（边界前下单，外卖
  没到就被补问 —— 此前写的「永远不被补问」是错的，见 spec §1.2 的更正）。

  剩：真机验收第 21 条（日常使用即可遇到），第 22 条可选；合并进 `main` 等你决定。
```

- [ ] **Step 6: 运行测试并提交（`TODO.md` 被 gitignore，不会进提交）**

Run: `node --test`
Expected: 143 条 PASS。

```bash
git add docs/superpowers/specs/2026-08-26-browse-and-implicit-signals-design.md docs/superpowers/specs/2026-08-22-meal-recommender-design.md CLAUDE.md README.md
git commit -m "docs: 旧 spec 加 2026-09-13 修订注记，CLAUDE.md 指路，验收清单新增第 21、22 条

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 完成后

- `fix/meal-key` 上应有：spec、plan、Task 1–4 共 4 个实现提交，测试 143 条全绿
- **不要合并、不要推送**。向用户报告：改了什么、浏览器实测结果（8b–8e 逐条）、真机验收第 21 条怎么验
