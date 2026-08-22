# 饭点外卖推荐 PWA 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个零后端的手机网页（PWA），在每天三个饭点由 iOS 快捷指令自动打开，只推荐一道菜，点一下跳到外卖 App 自行下单。

**Architecture:** 纯静态站点，无构建步骤，无 npm 运行时依赖。数据全部存于手机本地 IndexedDB。推荐逻辑（`recommender.js`、`observations.js`）是零依赖纯函数，用 Node 自带的 `node:test` 完整测试；IndexedDB 读写与 DOM 交互层保持极薄，由真机手工验收清单覆盖。托管于 GitHub Pages。

**Tech Stack:** 原生 HTML / CSS / JavaScript（ES Modules）、IndexedDB、`node:test`（仅测试用，Node 18+）、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-08-22-meal-recommender-design.md`

## Global Constraints

以下为 spec 中的全项目约束，每个任务的要求都隐含包含本节。

- **零 npm 运行时依赖，零构建步骤。** `package.json` 只允许包含 `{"name","private","type":"module"}`，不得有 `dependencies` 或 `devDependencies`。
- **不注册 Service Worker。** 仅提供 `manifest.json`。（spec §3.5）
- **不抓取任何外卖平台数据，不构造 URL scheme。** 跳转链接一律由用户从外卖 App 分享后粘贴。（spec §3.2、§8.1）
- **`src/config.js`、`src/dates.js`、`src/observations.js`、`src/recommender.js`、`src/snapshot.js` 必须是纯函数模块** —— 不得 import DOM、`indexedDB`、`localStorage`，不得直接调用 `Date.now()` 或 `Math.random()`（时间与随机源一律由参数注入）。这五个模块必须能被 Node 直接 import。
- **所有日期与「天数差」按设备本地时区取自然日。**（spec §6.2）
- **全部可调常数只允许出现在 `src/config.js`**，其他文件不得出现魔法数字。（spec §6.7）
- **所有面向用户的文案为简体中文。**
- **CONFIG 精确取值**（spec §6.7，逐字复制）：

```js
W_TASTE: 0.7,  W_VALUE: 0.3,
TASTE_HALFLIFE_DAYS: 60,  COLD_START_TASTE: 0.7,
IMPLICIT_CLICKED: 0.65,  IMPLICIT_SWAPPED: 0.2,  IMPLICIT_NO_ACTION: 0.45,
RATING_VALUES: { good: 1.0, ok: 0.5, bad: 0.0, skipped: 0.4 },
FATIGUE_TAU_DISH: 7,  FATIGUE_TAU_SHOP: 3,  FATIGUE_TAU_TAG: 2,
FATIGUE_MAX_SHOP_PENALTY: 0.5,  FATIGUE_MAX_TAG_PENALTY: 0.3,
FATIGUE_FLOOR: 0.02,
JITTER_MIN: 0.85,  JITTER_MAX: 1.15,
MAX_SWAPS: 2,
```

- **饭点推断阈值**（spec §7.1）：本地时间 10:30 前为 `breakfast`，15:00 前为 `lunch`，之后为 `dinner`。
- **对 spec §7.3 的一处澄清（本计划定死）**：补问反馈时，`source === 'swapped'` 的 observation 必须跳过。用户按了「换一个」说明他没吃这道菜，问「怎么样」是错的。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `package.json` | 仅声明 `"type": "module"`，使 Node 能以 ESM 加载 `src/` |
| `src/config.js` | 全部可调常数与枚举 |
| `src/dates.js` | 本地时区日期键、自然日差、饭点推断 |
| `src/observations.js` | 事件流 → 观察值归约、已吃索引、待补问反馈、当日选择状态 |
| `src/recommender.js` | 硬过滤、好吃度、实惠度、腻味系数、理由、`recommend` 组装 |
| `src/snapshot.js` | 导出/导入 JSON 的纯函数与校验 |
| `src/store.js` | IndexedDB 封装（唯一碰浏览器存储的模块） |
| `src/deeplink.js` | 打开店铺链接、复制店名 |
| `src/ui-today.js` | 「今天这顿」页面与反馈浮层的 DOM 逻辑 |
| `src/ui-pool.js` | 候选池页面的 DOM 逻辑 |
| `index.html` | 「今天这顿」页面 + 反馈浮层结构 |
| `pool.html` | 候选池页面结构 |
| `css/style.css` | 全部样式 |
| `manifest.json` | PWA manifest |
| `README.md` | 快捷指令配置步骤、本地开发、部署 |
| `test/*.test.js` | `node --test` 测试 |

拆分依据：纯逻辑（可自动化测试）与浏览器胶水（只能手工验收）之间划一条硬边界。`observations.js` 与 `recommender.js` 分开，因为前者回答「历史上发生了什么」，后者回答「现在该推什么」—— 两者会各自独立演化。

---

## Task 1: 项目骨架、常数与日期工具

**Files:**
- Create: `package.json`
- Create: `src/config.js`
- Create: `src/dates.js`
- Create: `test/dates.test.js`
- Create: `.gitignore`

**Interfaces:**
- Consumes: 无
- Produces:
  - `CONFIG`（对象，字段见 Global Constraints）
  - `SLOTS: readonly ['breakfast','lunch','dinner']`
  - `SLOT_LABELS: Record<Slot, string>`
  - `localDateKey(ts: number): string` → `'YYYY-MM-DD'`
  - `daysBetweenKeys(fromKey: string|undefined|null, toKey: string): number` → 整数天；`fromKey` 为空时返回 `Infinity`
  - `slotFromTime(ts: number): 'breakfast'|'lunch'|'dinner'`

- [ ] **Step 1: 建立目录与 package.json**

```bash
cd /c/Users/xiaoyu/Desktop/meal
mkdir -p src test css
```

`package.json`：

```json
{
  "name": "meal",
  "private": true,
  "type": "module"
}
```

`.gitignore`：

```
node_modules/
.DS_Store
```

- [ ] **Step 2: 写 `src/config.js`**

```js
export const CONFIG = {
  W_TASTE: 0.7,
  W_VALUE: 0.3,
  TASTE_HALFLIFE_DAYS: 60,
  COLD_START_TASTE: 0.7,
  IMPLICIT_CLICKED: 0.65,
  IMPLICIT_SWAPPED: 0.2,
  IMPLICIT_NO_ACTION: 0.45,
  RATING_VALUES: { good: 1.0, ok: 0.5, bad: 0.0, skipped: 0.4 },
  FATIGUE_TAU_DISH: 7,
  FATIGUE_TAU_SHOP: 3,
  FATIGUE_TAU_TAG: 2,
  FATIGUE_MAX_SHOP_PENALTY: 0.5,
  FATIGUE_MAX_TAG_PENALTY: 0.3,
  FATIGUE_FLOOR: 0.02,
  JITTER_MIN: 0.85,
  JITTER_MAX: 1.15,
  MAX_SWAPS: 2,
};

export const SLOTS = ['breakfast', 'lunch', 'dinner'];

export const SLOT_LABELS = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
};

/** 饭点推断阈值，单位为「当天第几分钟」。 */
export const SLOT_BOUNDARIES = {
  breakfastEnd: 10 * 60 + 30,
  lunchEnd: 15 * 60,
};

/** 吃过了才算「吃过」—— 用于腻味系数。'skipped' 不算。 */
export const EATEN_RATINGS = ['good', 'ok', 'bad'];
```

- [ ] **Step 3: 写失败的测试 `test/dates.test.js`**

用 `new Date(y, m, d, h, min)` 构造本地时间，使断言与运行机器的时区无关。

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey, daysBetweenKeys, slotFromTime } from '../src/dates.js';
import { CONFIG } from '../src/config.js';

test('localDateKey 按本地时区取自然日', () => {
  const ts = new Date(2026, 7, 22, 23, 30).getTime(); // 本地 2026-08-22 23:30
  assert.equal(localDateKey(ts), '2026-08-22');
});

test('localDateKey 补零到两位', () => {
  const ts = new Date(2026, 0, 5, 9, 0).getTime(); // 本地 2026-01-05
  assert.equal(localDateKey(ts), '2026-01-05');
});

test('daysBetweenKeys 返回整数自然日差', () => {
  assert.equal(daysBetweenKeys('2026-08-20', '2026-08-22'), 2);
  assert.equal(daysBetweenKeys('2026-08-22', '2026-08-22'), 0);
});

test('daysBetweenKeys 跨月份正确', () => {
  assert.equal(daysBetweenKeys('2026-07-31', '2026-08-01'), 1);
});

test('daysBetweenKeys 对空起点返回 Infinity', () => {
  assert.equal(daysBetweenKeys(undefined, '2026-08-22'), Infinity);
  assert.equal(daysBetweenKeys(null, '2026-08-22'), Infinity);
});

test('slotFromTime 在 10:30 与 15:00 处切换', () => {
  assert.equal(slotFromTime(new Date(2026, 7, 22, 10, 29).getTime()), 'breakfast');
  assert.equal(slotFromTime(new Date(2026, 7, 22, 10, 30).getTime()), 'lunch');
  assert.equal(slotFromTime(new Date(2026, 7, 22, 14, 59).getTime()), 'lunch');
  assert.equal(slotFromTime(new Date(2026, 7, 22, 15, 0).getTime()), 'dinner');
  assert.equal(slotFromTime(new Date(2026, 7, 22, 21, 0).getTime()), 'dinner');
});

test('CONFIG 的两个权重之和为 1', () => {
  assert.equal(CONFIG.W_TASTE + CONFIG.W_VALUE, 1);
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `node --test test/dates.test.js`
Expected: FAIL —— `Cannot find module .../src/dates.js`

- [ ] **Step 5: 写 `src/dates.js`**

```js
import { SLOT_BOUNDARIES } from './config.js';

/** 时间戳 → 本地时区的 'YYYY-MM-DD'。 */
export function localDateKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 两个日期键之间的自然日差。fromKey 为空时返回 Infinity（表示"从未发生"）。
 * 用 Math.round 而非 Math.floor，以吸收夏令时导致的 ±1 小时偏差。
 */
export function daysBetweenKeys(fromKey, toKey) {
  if (!fromKey) return Infinity;
  const from = new Date(`${fromKey}T00:00:00`).getTime();
  const to = new Date(`${toKey}T00:00:00`).getTime();
  return Math.round((to - from) / 86400000);
}

/** 按本地时间推断当前是哪一顿。 */
export function slotFromTime(ts) {
  const d = new Date(ts);
  const minutes = d.getHours() * 60 + d.getMinutes();
  if (minutes < SLOT_BOUNDARIES.breakfastEnd) return 'breakfast';
  if (minutes < SLOT_BOUNDARIES.lunchEnd) return 'lunch';
  return 'dinner';
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test test/dates.test.js`
Expected: PASS，7 个测试全绿

- [ ] **Step 7: 提交**

```bash
git add package.json .gitignore src/config.js src/dates.js test/dates.test.js
git commit -m "feat: 项目骨架、CONFIG 常数与本地时区日期工具"
```

---

## Task 2: 事件流归约为观察值

把原始事件流压成「每顿每道菜一条观察值」，这是全部推荐逻辑的输入。

**Files:**
- Create: `src/observations.js`
- Create: `test/observations.test.js`

**Interfaces:**
- Consumes: `localDateKey`（Task 1）、`CONFIG`（Task 1）
- Produces:
  - `reduceObservations(events: Event[]): Observation[]` —— 按 `ts` 升序返回
  - `Observation = { dishId, dateKey, slot, ts, value: number, source: 'rated'|'swapped'|'clicked'|'none', ratedValue: string|null, eaten: boolean }`

`ts` 取该组内 `recommended` 事件的时间戳。`eaten` 仅当 `ratedValue ∈ EATEN_RATINGS` 时为 `true`。

- [ ] **Step 1: 写失败的测试 `test/observations.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceObservations } from '../src/observations.js';

const DAY = 86400000;
const at = (dayOffset, hour) =>
  new Date(2026, 7, 22 + dayOffset, hour, 0).getTime();

const ev = (type, dishId, ts, slot = 'lunch', value = null) => ({
  id: `${type}-${dishId}-${ts}`, ts, slot, dishId, type, value,
});

test('只有 recommended，无任何后续动作 → 0.45', () => {
  const obs = reduceObservations([ev('recommended', 'd1', at(0, 12))]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 0.45);
  assert.equal(obs[0].source, 'none');
  assert.equal(obs[0].eaten, false);
});

test('clicked 未被 rated 覆盖 → 0.65', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('clicked', 'd1', at(0, 12) + 60000),
  ]);
  assert.equal(obs[0].value, 0.65);
  assert.equal(obs[0].source, 'clicked');
});

test('swapped → 0.2', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('swapped', 'd1', at(0, 12) + 5000),
  ]);
  assert.equal(obs[0].value, 0.2);
  assert.equal(obs[0].source, 'swapped');
});

test('rated 优先级高于 clicked', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('clicked', 'd1', at(0, 12) + 60000),
    ev('rated', 'd1', at(1, 12), 'lunch', 'good'),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 1.0);
  assert.equal(obs[0].source, 'rated');
  assert.equal(obs[0].ratedValue, 'good');
  assert.equal(obs[0].eaten, true);
});

test('skipped 记为 0.4 且不算吃过', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('clicked', 'd1', at(0, 12) + 60000),
    ev('rated', 'd1', at(1, 12), 'lunch', 'skipped'),
  ]);
  assert.equal(obs[0].value, 0.4);
  assert.equal(obs[0].eaten, false);
});

test('rated bad 算吃过（吃了但难吃）', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('rated', 'd1', at(1, 12), 'lunch', 'bad'),
  ]);
  assert.equal(obs[0].value, 0.0);
  assert.equal(obs[0].eaten, true);
});

test('没有 recommended 的事件组被忽略', () => {
  const obs = reduceObservations([ev('clicked', 'd1', at(0, 12))]);
  assert.equal(obs.length, 0);
});

test('同一顿换两次产生三条独立观察值', () => {
  const obs = reduceObservations([
    ev('recommended', 'a', at(0, 12)),
    ev('swapped', 'a', at(0, 12) + 1000),
    ev('recommended', 'b', at(0, 12) + 2000),
    ev('swapped', 'b', at(0, 12) + 3000),
    ev('recommended', 'c', at(0, 12) + 4000),
    ev('clicked', 'c', at(0, 12) + 5000),
  ]);
  assert.equal(obs.length, 3);
  assert.deepEqual(obs.map((o) => o.dishId), ['a', 'b', 'c']);
  assert.deepEqual(obs.map((o) => o.value), [0.2, 0.2, 0.65]);
});

test('同一天不同饭点的同一道菜是两条观察值', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12), 'lunch'),
    ev('recommended', 'd1', at(0, 19), 'dinner'),
  ]);
  assert.equal(obs.length, 2);
});

test('页面重载导致的重复 recommended 被折叠为一条', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('recommended', 'd1', at(0, 12) + 30000),
    ev('clicked', 'd1', at(0, 12) + 60000),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 0.65);
});

test('返回结果按 ts 升序', () => {
  const obs = reduceObservations([
    ev('recommended', 'b', at(2, 12)),
    ev('recommended', 'a', at(0, 12)),
    ev('recommended', 'c', at(1, 12)),
  ]);
  assert.deepEqual(obs.map((o) => o.dishId), ['a', 'c', 'b']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/observations.test.js`
Expected: FAIL —— `Cannot find module .../src/observations.js`

- [ ] **Step 3: 写 `src/observations.js`**

```js
import { CONFIG, EATEN_RATINGS } from './config.js';
import { localDateKey } from './dates.js';

/**
 * 把原始事件流压成观察值：一条观察值 = 一顿饭里的一道菜。
 * 分组键为「本地日期 + 饭点 + 菜品」，因此同一顿内的重复 recommended
 * （例如用户重载页面）会自然折叠为一条。
 */
export function reduceObservations(events) {
  const groups = new Map();
  for (const e of events) {
    const key = `${localDateKey(e.ts)}|${e.slot}|${e.dishId}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(e);
  }

  const out = [];
  for (const [key, list] of groups) {
    const recommended = list
      .filter((e) => e.type === 'recommended')
      .sort((a, b) => a.ts - b.ts)[0];
    if (!recommended) continue;

    const rated = list.find((e) => e.type === 'rated');
    const swapped = list.find((e) => e.type === 'swapped');
    const clicked = list.find((e) => e.type === 'clicked');

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

    const [dateKey, slot, dishId] = key.split('|');
    out.push({
      dishId,
      dateKey,
      slot,
      ts: recommended.ts,
      value,
      source,
      ratedValue: rated ? rated.value : null,
      eaten: rated ? EATEN_RATINGS.includes(rated.value) : false,
    });
  }

  return out.sort((a, b) => a.ts - b.ts);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/observations.test.js`
Expected: PASS，11 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/observations.js test/observations.test.js
git commit -m "feat: 事件流归约为观察值"
```

---

## Task 3: 已吃索引

腻味系数需要知道「这道菜 / 这家店 / 这个 tag 上一次真的被吃是哪天」。

**Files:**
- Modify: `src/observations.js`（追加导出）
- Modify: `test/observations.test.js`（追加测试）

**Interfaces:**
- Consumes: `Observation`（Task 2）
- Produces:
  - `buildEatenIndex(observations: Observation[], dishesById: Map<string, Dish>): { byDish: Map<string,string>, byShop: Map<string,string>, byTag: Map<string,string> }`
  - 三个 Map 的值都是**最近一次**吃过的 `dateKey`。只统计 `eaten === true` 的观察值。

- [ ] **Step 1: 追加失败的测试到 `test/observations.test.js`**

```js
import { buildEatenIndex } from '../src/observations.js';

const dishesById = new Map([
  ['d1', { id: 'd1', shopId: 's1', tags: ['川菜', '辣'] }],
  ['d2', { id: 'd2', shopId: 's1', tags: ['川菜'] }],
  ['d3', { id: 'd3', shopId: 's2', tags: ['面食'] }],
]);

const obs = (dishId, dateKey, eaten) => ({
  dishId, dateKey, slot: 'lunch', ts: new Date(`${dateKey}T12:00:00`).getTime(),
  value: eaten ? 1 : 0.2, source: eaten ? 'rated' : 'swapped',
  ratedValue: eaten ? 'good' : null, eaten,
});

test('buildEatenIndex 只统计真的吃过的观察值', () => {
  const idx = buildEatenIndex(
    [obs('d1', '2026-08-20', true), obs('d3', '2026-08-21', false)],
    dishesById,
  );
  assert.equal(idx.byDish.get('d1'), '2026-08-20');
  assert.equal(idx.byDish.has('d3'), false);
  assert.equal(idx.byShop.has('s2'), false);
});

test('buildEatenIndex 对每个键保留最近的日期', () => {
  const idx = buildEatenIndex(
    [obs('d1', '2026-08-18', true), obs('d1', '2026-08-21', true)],
    dishesById,
  );
  assert.equal(idx.byDish.get('d1'), '2026-08-21');
});

test('buildEatenIndex 按店铺聚合不同菜品', () => {
  const idx = buildEatenIndex(
    [obs('d1', '2026-08-18', true), obs('d2', '2026-08-21', true)],
    dishesById,
  );
  assert.equal(idx.byShop.get('s1'), '2026-08-21');
});

test('buildEatenIndex 按 tag 聚合，一道菜的多个 tag 都记入', () => {
  const idx = buildEatenIndex([obs('d1', '2026-08-20', true)], dishesById);
  assert.equal(idx.byTag.get('川菜'), '2026-08-20');
  assert.equal(idx.byTag.get('辣'), '2026-08-20');
  assert.equal(idx.byTag.has('面食'), false);
});

test('buildEatenIndex 忽略候选池里已不存在的菜品', () => {
  const idx = buildEatenIndex([obs('deleted', '2026-08-20', true)], dishesById);
  assert.equal(idx.byDish.size, 0);
  assert.equal(idx.byShop.size, 0);
});

test('buildEatenIndex 对空输入返回三个空 Map', () => {
  const idx = buildEatenIndex([], dishesById);
  assert.equal(idx.byDish.size, 0);
  assert.equal(idx.byShop.size, 0);
  assert.equal(idx.byTag.size, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/observations.test.js`
Expected: FAIL —— `buildEatenIndex is not a function`（或 import 报错）

- [ ] **Step 3: 追加实现到 `src/observations.js`**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/observations.test.js`
Expected: PASS，17 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/observations.js test/observations.test.js
git commit -m "feat: 已吃索引（按菜品/店铺/tag）"
```

---

## Task 4: 待补问反馈与当日选择状态

两个查询函数：下次打开时该补问哪一顿，以及今天这一顿当前的选择与已换次数。

**Files:**
- Modify: `src/observations.js`（追加导出）
- Modify: `test/observations.test.js`（追加测试）

**Interfaces:**
- Consumes: `Observation`（Task 2）、`localDateKey`（Task 1）
- Produces:
  - `pendingFeedback(observations, nowTs, slot): Observation | null`
  - `currentPick(events, slot, nowKey): { activeDishId: string|null, swappedDishIds: string[], swapCount: number }`

`pendingFeedback` 规则（spec §7.3 + Global Constraints 的澄清）：取 `ts` 最大的观察值；若它属于「当前本地日期 + 当前 slot」则返回 `null`（这顿还没吃完）；若 `source === 'swapped'` 返回 `null`（用户没吃它）；若 `source === 'rated'` 返回 `null`（已评过）；否则返回它。**每次最多返回一条。**

- [ ] **Step 1: 追加失败的测试到 `test/observations.test.js`**

```js
import { pendingFeedback, currentPick } from '../src/observations.js';

const NOW = new Date(2026, 7, 22, 12, 0).getTime(); // 本地 2026-08-22 12:00
const obsAt = (dishId, dayOffset, hour, slot, source, ratedValue = null) => ({
  dishId,
  dateKey: `2026-08-${String(22 + dayOffset).padStart(2, '0')}`,
  slot,
  ts: new Date(2026, 7, 22 + dayOffset, hour, 0).getTime(),
  value: 0.5, source, ratedValue, eaten: source === 'rated',
});

test('pendingFeedback 对空历史返回 null', () => {
  assert.equal(pendingFeedback([], NOW, 'lunch'), null);
});

test('pendingFeedback 补问昨晚未评分的那顿', () => {
  const r = pendingFeedback(
    [obsAt('d1', -1, 19, 'dinner', 'clicked')], NOW, 'lunch');
  assert.equal(r.dishId, 'd1');
});

test('pendingFeedback 跳过当前这一顿', () => {
  const r = pendingFeedback(
    [obsAt('d1', 0, 12, 'lunch', 'clicked')], NOW, 'lunch');
  assert.equal(r, null);
});

test('pendingFeedback 跳过已评分的', () => {
  const r = pendingFeedback(
    [obsAt('d1', -1, 19, 'dinner', 'rated', 'good')], NOW, 'lunch');
  assert.equal(r, null);
});

test('pendingFeedback 跳过被换掉的（用户没吃它）', () => {
  const r = pendingFeedback(
    [obsAt('d1', -1, 19, 'dinner', 'swapped')], NOW, 'lunch');
  assert.equal(r, null);
});

test('pendingFeedback 补问推了但毫无动作的那顿', () => {
  const r = pendingFeedback(
    [obsAt('d1', -1, 19, 'dinner', 'none')], NOW, 'lunch');
  assert.equal(r.dishId, 'd1');
});

test('pendingFeedback 只看最近一条，不翻旧账', () => {
  const r = pendingFeedback([
    obsAt('old', -3, 12, 'lunch', 'clicked'),
    obsAt('recent', -1, 19, 'dinner', 'rated', 'ok'),
  ], NOW, 'lunch');
  assert.equal(r, null);
});

test('pendingFeedback 在同一顿换过再点的情况下问最后点的那个', () => {
  const r = pendingFeedback([
    obsAt('a', -1, 19, 'dinner', 'swapped'),
    { ...obsAt('b', -1, 19, 'dinner', 'clicked'), ts: new Date(2026, 7, 21, 19, 5).getTime() },
  ], NOW, 'lunch');
  assert.equal(r.dishId, 'b');
});

const evt = (type, dishId, hour, minute = 0, slot = 'lunch') => ({
  id: `${type}-${dishId}-${hour}${minute}`,
  ts: new Date(2026, 7, 22, hour, minute).getTime(),
  slot, dishId, type, value: null,
});

test('currentPick 对空事件返回无选择', () => {
  const p = currentPick([], 'lunch', '2026-08-22');
  assert.deepEqual(p, { activeDishId: null, swappedDishIds: [], swapCount: 0 });
});

test('currentPick 返回当前未被换掉的推荐', () => {
  const p = currentPick([evt('recommended', 'a', 12)], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, 'a');
  assert.equal(p.swapCount, 0);
});

test('currentPick 在换过之后返回新的推荐并计数', () => {
  const p = currentPick([
    evt('recommended', 'a', 12, 0),
    evt('swapped', 'a', 12, 1),
    evt('recommended', 'b', 12, 2),
  ], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, 'b');
  assert.deepEqual(p.swappedDishIds, ['a']);
  assert.equal(p.swapCount, 1);
});

test('currentPick 在刚换掉还没推新的时返回 null', () => {
  const p = currentPick([
    evt('recommended', 'a', 12, 0),
    evt('swapped', 'a', 12, 1),
  ], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, null);
  assert.equal(p.swapCount, 1);
});

test('currentPick 忽略其他饭点和其他日期的事件', () => {
  const p = currentPick([
    evt('recommended', 'a', 19, 0, 'dinner'),
    { ...evt('recommended', 'b', 12), ts: new Date(2026, 7, 21, 12, 0).getTime() },
  ], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/observations.test.js`
Expected: FAIL —— `pendingFeedback is not a function`

- [ ] **Step 3: 追加实现到 `src/observations.js`**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/observations.test.js`
Expected: PASS，30 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/observations.js test/observations.test.js
git commit -m "feat: 待补问反馈与当日选择状态"
```

---

## Task 5: 硬过滤

**Files:**
- Create: `src/recommender.js`
- Create: `test/recommender.test.js`

**Interfaces:**
- Consumes: 无（纯数组过滤）
- Produces: `filterCandidates({ dishes, shops, slot, excludedDishIds }): Dish[]`

过滤规则见 spec §6.1：拉黑店铺、停用菜品、饭点不匹配、本顿已换掉。

- [ ] **Step 1: 写失败的测试 `test/recommender.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCandidates } from '../src/recommender.js';

const shops = [
  { id: 's1', name: '张记', platform: 'meituan', link: 'https://x/1', hygiene: 'unknown' },
  { id: 's2', name: '李记', platform: 'eleme', link: 'https://x/2', hygiene: 'blocked' },
  { id: 's3', name: '王记', platform: 'meituan', link: 'https://x/3', hygiene: 'trusted' },
];

const dish = (id, shopId, over = {}) => ({
  id, shopId, name: `菜${id}`, refPrice: 20, tags: ['家常'],
  slots: ['lunch', 'dinner'], active: true, ...over,
});

test('放行符合条件的菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's1')], shops, slot: 'lunch', excludedDishIds: [],
  });
  assert.deepEqual(out.map((d) => d.id), ['d1']);
});

test('剔除被拉黑店铺的菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's1'), dish('d2', 's2')],
    shops, slot: 'lunch', excludedDishIds: [],
  });
  assert.deepEqual(out.map((d) => d.id), ['d1']);
});

test('剔除已停用的菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's1', { active: false })],
    shops, slot: 'lunch', excludedDishIds: [],
  });
  assert.deepEqual(out, []);
});

test('剔除饭点不匹配的菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's1')], shops, slot: 'breakfast', excludedDishIds: [],
  });
  assert.deepEqual(out, []);
});

test('剔除本顿已被换掉的菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's1'), dish('d2', 's3')],
    shops, slot: 'lunch', excludedDishIds: ['d1'],
  });
  assert.deepEqual(out.map((d) => d.id), ['d2']);
});

test('剔除店铺已不存在的孤儿菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 'ghost')], shops, slot: 'lunch', excludedDishIds: [],
  });
  assert.deepEqual(out, []);
});

test('excludedDishIds 省略时默认为空', () => {
  const out = filterCandidates({ dishes: [dish('d1', 's1')], shops, slot: 'lunch' });
  assert.equal(out.length, 1);
});

test('全部被拉黑时返回空数组', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's2')], shops, slot: 'lunch', excludedDishIds: [],
  });
  assert.deepEqual(out, []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/recommender.test.js`
Expected: FAIL —— `Cannot find module .../src/recommender.js`

- [ ] **Step 3: 写 `src/recommender.js`**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/recommender.test.js`
Expected: PASS，8 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/recommender.js test/recommender.test.js
git commit -m "feat: 候选菜品硬过滤"
```

---

## Task 6: 好吃度（时间加权 + 乐观初始化）

**Files:**
- Modify: `src/recommender.js`（追加导出）
- Modify: `test/recommender.test.js`（追加测试）

**Interfaces:**
- Consumes: `CONFIG`（Task 1）、`Observation`（Task 2）
- Produces: `tasteOf(observations: Observation[], nowTs: number): number` ∈ [0,1]

公式见 spec §6.3：`w_i = 0.5^(daysAgo_i / 60)`，`taste = Σ(w_i·v_i)/Σ(w_i)`；空数组返回 `COLD_START_TASTE`。

- [ ] **Step 1: 追加失败的测试到 `test/recommender.test.js`**

```js
import { tasteOf } from '../src/recommender.js';
import { CONFIG } from '../src/config.js';

const DAY = 86400000;
const NOW = new Date(2026, 7, 22, 12, 0).getTime();
const o = (value, daysAgo) => ({
  dishId: 'd1', dateKey: 'x', slot: 'lunch', ts: NOW - daysAgo * DAY,
  value, source: 'rated', ratedValue: null, eaten: true,
});

test('零观察值时用乐观初始化 0.7', () => {
  assert.equal(tasteOf([], NOW), CONFIG.COLD_START_TASTE);
  assert.equal(tasteOf([], NOW), 0.7);
});

test('单条 good 得 1.0', () => {
  assert.equal(tasteOf([o(1.0, 0)], NOW), 1.0);
});

test('单条 bad 得 0.0', () => {
  assert.equal(tasteOf([o(0.0, 0)], NOW), 0.0);
});

test('同日两条取平均', () => {
  assert.equal(tasteOf([o(1.0, 0), o(0.0, 0)], NOW), 0.5);
});

test('半衰期 60 天：60 天前的权重恰为今天的一半', () => {
  // 今天 bad(0) 权重 1；60 天前 good(1) 权重 0.5 → (0 + 0.5) / 1.5 = 1/3
  const t = tasteOf([o(0.0, 0), o(1.0, 60)], NOW);
  assert.ok(Math.abs(t - 1 / 3) < 1e-9, `期望 ≈0.3333，实际 ${t}`);
});

test('近期评价压过久远评价', () => {
  const recent = tasteOf([o(1.0, 1), o(0.0, 200)], NOW);
  const stale = tasteOf([o(0.0, 1), o(1.0, 200)], NOW);
  assert.ok(recent > 0.8, `期望 >0.8，实际 ${recent}`);
  assert.ok(stale < 0.2, `期望 <0.2，实际 ${stale}`);
});

test('结果恒在 [0,1] 区间内', () => {
  const t = tasteOf([o(0.65, 3), o(0.2, 10), o(0.45, 30)], NOW);
  assert.ok(t >= 0 && t <= 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/recommender.test.js`
Expected: FAIL —— `tasteOf is not a function`

- [ ] **Step 3: 追加实现到 `src/recommender.js`**

在文件顶部加 import：

```js
import { CONFIG } from './config.js';
import { daysBetweenKeys } from './dates.js';
```

追加：

```js
const DAY_MS = 86400000;

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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/recommender.test.js`
Expected: PASS，15 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/recommender.js test/recommender.test.js
git commit -m "feat: 好吃度（时间加权平均 + 乐观初始化）"
```

---

## Task 7: 实惠度（价格百分位）

**Files:**
- Modify: `src/recommender.js`（追加导出）
- Modify: `test/recommender.test.js`（追加测试）

**Interfaces:**
- Consumes: `Event`（spec §5.3）
- Produces:
  - `effectivePriceOf(dish: Dish, events: Event[]): number` —— 最近一次 `paid` 的值，无则 `dish.refPrice`
  - `valueOf(price: number, allPrices: number[]): number` ∈ [0,1] —— `1 - 百分位`；候选集 ≤1 个时返回 0.5

- [ ] **Step 1: 追加失败的测试到 `test/recommender.test.js`**

```js
import { effectivePriceOf, valueOf } from '../src/recommender.js';

const paidEvt = (dishId, ts, amount) => ({
  id: `p${ts}`, ts, slot: 'lunch', dishId, type: 'paid', value: amount,
});

test('effectivePriceOf 无 paid 事件时用参考价', () => {
  assert.equal(effectivePriceOf(dish('d1', 's1', { refPrice: 25 }), []), 25);
});

test('effectivePriceOf 优先用实付价', () => {
  const d = dish('d1', 's1', { refPrice: 25 });
  assert.equal(effectivePriceOf(d, [paidEvt('d1', 1000, 31.5)]), 31.5);
});

test('effectivePriceOf 取最近一次实付价', () => {
  const d = dish('d1', 's1', { refPrice: 25 });
  const events = [paidEvt('d1', 1000, 31.5), paidEvt('d1', 5000, 28)];
  assert.equal(effectivePriceOf(d, events), 28);
});

test('effectivePriceOf 忽略别的菜的实付价', () => {
  const d = dish('d1', 's1', { refPrice: 25 });
  assert.equal(effectivePriceOf(d, [paidEvt('d2', 5000, 99)]), 25);
});

test('valueOf 在候选集只有一个时返回 0.5', () => {
  assert.equal(valueOf(20, [20]), 0.5);
});

test('valueOf 给最便宜的满分、最贵的零分', () => {
  const prices = [10, 20, 30];
  assert.equal(valueOf(10, prices), 1);
  assert.equal(valueOf(20, prices), 0.5);
  assert.equal(valueOf(30, prices), 0);
});

test('valueOf 对并列价格给相同分数', () => {
  const prices = [10, 10, 20];
  assert.equal(valueOf(10, prices), valueOf(10, prices));
  assert.equal(valueOf(10, prices), 1);
  assert.equal(valueOf(20, prices), 0);
});

test('valueOf 自适应消费水平，只看相对位置', () => {
  // 绝对价格翻十倍，相对排序不变，分数也不变
  assert.equal(valueOf(20, [10, 20, 30]), valueOf(200, [100, 200, 300]));
});

test('valueOf 结果恒在 [0,1] 区间内', () => {
  const prices = [8, 15, 22, 40, 40, 6];
  for (const p of prices) {
    const v = valueOf(p, prices);
    assert.ok(v >= 0 && v <= 1, `${p} → ${v}`);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/recommender.test.js`
Expected: FAIL —— `effectivePriceOf is not a function`

- [ ] **Step 3: 追加实现到 `src/recommender.js`**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/recommender.test.js`
Expected: PASS，24 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/recommender.js test/recommender.test.js
git commit -m "feat: 实惠度（候选集内价格百分位）"
```

---

## Task 8: 腻味系数

**Files:**
- Modify: `src/recommender.js`（追加导出）
- Modify: `test/recommender.test.js`（追加测试）

**Interfaces:**
- Consumes: `CONFIG`、`daysBetweenKeys`（Task 1）
- Produces: `fatigueOf({ dishLastEatenKey, shopLastEatenKey, tagLastEatenKeys, nowKey }): { total, fDish, fShop, fTag }`

三个日期参数可为 `undefined`（从未吃过），对应因子取 1。`tagLastEatenKeys` 是数组，取**天数最小者**（最近吃过的那个 tag 说了算）。公式见 spec §6.5。`total` 有下限 `FATIGUE_FLOOR = 0.02`。

分解出 `fDish` 单独返回，是因为 Task 9 的理由生成需要它 —— spec §6.8 的「好久没吃了」判据是 `f_dish ≥ 0.85`，不是 `total`。

- [ ] **Step 1: 追加失败的测试到 `test/recommender.test.js`**

```js
import { fatigueOf } from '../src/recommender.js';

const TODAY = '2026-08-22';
const daysBefore = (n) => {
  const d = new Date(2026, 7, 22);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('从未吃过时三个因子都是 1', () => {
  const f = fatigueOf({ nowKey: TODAY });
  assert.equal(f.fDish, 1);
  assert.equal(f.fShop, 1);
  assert.equal(f.fTag, 1);
  assert.equal(f.total, 1);
});

test('今天刚吃过这道菜时被压到下限', () => {
  const f = fatigueOf({ dishLastEatenKey: TODAY, nowKey: TODAY });
  assert.equal(f.fDish, 0);
  assert.equal(f.total, CONFIG.FATIGUE_FLOOR);
});

test('菜品衰减符合 1 - exp(-d/7)', () => {
  const f = fatigueOf({ dishLastEatenKey: daysBefore(7), nowKey: TODAY });
  assert.ok(Math.abs(f.fDish - (1 - Math.exp(-1))) < 1e-9);
  assert.ok(Math.abs(f.fDish - 0.6321205588) < 1e-6, `实际 ${f.fDish}`);
});

test('菜品衰减的手感符合 spec 给出的四个刻度', () => {
  const at = (n) => fatigueOf({ dishLastEatenKey: daysBefore(n), nowKey: TODAY }).fDish;
  assert.ok(Math.abs(at(3) - 0.35) < 0.01, `3 天 → ${at(3)}`);
  assert.ok(Math.abs(at(7) - 0.63) < 0.01, `7 天 → ${at(7)}`);
  assert.ok(Math.abs(at(14) - 0.86) < 0.01, `14 天 → ${at(14)}`);
  assert.ok(Math.abs(at(30) - 0.99) < 0.01, `30 天 → ${at(30)}`);
});

test('店铺衰减的惩罚上限为 50%', () => {
  const sameDay = fatigueOf({ shopLastEatenKey: TODAY, nowKey: TODAY });
  assert.equal(sameDay.fShop, 0.5);
  const f = fatigueOf({ shopLastEatenKey: daysBefore(3), nowKey: TODAY });
  assert.ok(Math.abs(f.fShop - (1 - 0.5 * Math.exp(-1))) < 1e-9);
});

test('tag 衰减的惩罚上限为 30%', () => {
  const sameDay = fatigueOf({ tagLastEatenKeys: [TODAY], nowKey: TODAY });
  assert.ok(Math.abs(sameDay.fTag - 0.7) < 1e-9);
  const f = fatigueOf({ tagLastEatenKeys: [daysBefore(2)], nowKey: TODAY });
  assert.ok(Math.abs(f.fTag - (1 - 0.3 * Math.exp(-1))) < 1e-9);
});

test('多个 tag 时最近吃过的那个说了算', () => {
  const f = fatigueOf({
    tagLastEatenKeys: [daysBefore(30), daysBefore(1)], nowKey: TODAY,
  });
  const onlyRecent = fatigueOf({ tagLastEatenKeys: [daysBefore(1)], nowKey: TODAY });
  assert.equal(f.fTag, onlyRecent.fTag);
});

test('空 tag 数组等同于从未吃过', () => {
  assert.equal(fatigueOf({ tagLastEatenKeys: [], nowKey: TODAY }).fTag, 1);
});

test('total 是三个因子之积', () => {
  const f = fatigueOf({
    dishLastEatenKey: daysBefore(10),
    shopLastEatenKey: daysBefore(4),
    tagLastEatenKeys: [daysBefore(2)],
    nowKey: TODAY,
  });
  assert.ok(Math.abs(f.total - f.fDish * f.fShop * f.fTag) < 1e-9);
});

test('total 恒在 (0,1] 区间内', () => {
  const f = fatigueOf({
    dishLastEatenKey: TODAY, shopLastEatenKey: TODAY,
    tagLastEatenKeys: [TODAY], nowKey: TODAY,
  });
  assert.ok(f.total > 0 && f.total <= 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/recommender.test.js`
Expected: FAIL —— `fatigueOf is not a function`

- [ ] **Step 3: 追加实现到 `src/recommender.js`**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/recommender.test.js`
Expected: PASS，34 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/recommender.js test/recommender.test.js
git commit -m "feat: 腻味系数（菜品/店铺/tag 三重衰减）"
```

---

## Task 9: 推荐理由

**Files:**
- Modify: `src/recommender.js`（追加导出）
- Modify: `test/recommender.test.js`（追加测试）

**Interfaces:**
- Consumes: 无
- Produces: `reasonFor({ hasObservations, lastRatedValue, isTopTaste, isTopValue, fDish }): string`

按 spec §6.8 的表格顺序取第一个命中的分支。六条文案逐字固定。

- [ ] **Step 1: 追加失败的测试到 `test/recommender.test.js`**

```js
import { reasonFor } from '../src/recommender.js';

const base = {
  hasObservations: true, lastRatedValue: null,
  isTopTaste: false, isTopValue: false, fDish: 0.5,
};

test('冷启动的菜说"还没试过"', () => {
  assert.equal(
    reasonFor({ ...base, hasObservations: false, isTopTaste: true }),
    '还没试过，试试看',
  );
});

test('上次评了 good 就说"你上次说好吃"', () => {
  assert.equal(
    reasonFor({ ...base, lastRatedValue: 'good', isTopValue: true }),
    '你上次说好吃',
  );
});

test('好吃度最高说"评价一直不错"', () => {
  assert.equal(reasonFor({ ...base, isTopTaste: true }), '评价一直不错');
});

test('实惠度最高说"同类里最便宜"', () => {
  assert.equal(reasonFor({ ...base, isTopValue: true }), '同类里最便宜');
});

test('久未食用说"好久没吃了"', () => {
  assert.equal(reasonFor({ ...base, fDish: 0.85 }), '好久没吃了');
});

test('都不满足时兜底', () => {
  assert.equal(reasonFor(base), '换换口味');
});

test('优先级：冷启动压过其余全部', () => {
  assert.equal(
    reasonFor({
      hasObservations: false, lastRatedValue: 'good',
      isTopTaste: true, isTopValue: true, fDish: 1,
    }),
    '还没试过，试试看',
  );
});

test('优先级：好吃度最高压过实惠度最高', () => {
  assert.equal(
    reasonFor({ ...base, isTopTaste: true, isTopValue: true }),
    '评价一直不错',
  );
});

test('上次评了 ok 或 bad 不触发"你上次说好吃"', () => {
  assert.equal(reasonFor({ ...base, lastRatedValue: 'ok' }), '换换口味');
  assert.equal(reasonFor({ ...base, lastRatedValue: 'bad' }), '换换口味');
});

test('fDish 恰好 0.85 触发，0.84 不触发', () => {
  assert.equal(reasonFor({ ...base, fDish: 0.85 }), '好久没吃了');
  assert.equal(reasonFor({ ...base, fDish: 0.84 }), '换换口味');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/recommender.test.js`
Expected: FAIL —— `reasonFor is not a function`

- [ ] **Step 3: 追加实现到 `src/recommender.js`**

```js
/** 「好久没吃了」的触发阈值，对应约 14 天没吃这道菜。 */
const LONG_TIME_FDISH = 0.85;

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
  if (fDish >= LONG_TIME_FDISH) return '好久没吃了';
  return '换换口味';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/recommender.test.js`
Expected: PASS，44 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/recommender.js test/recommender.test.js
git commit -m "feat: 一句话推荐理由"
```

---

## Task 10: 组装 recommend

把前面六块拼成对外唯一入口。

**Files:**
- Modify: `src/recommender.js`（追加导出）
- Modify: `test/recommender.test.js`（追加测试）

**Interfaces:**
- Consumes: `filterCandidates`、`tasteOf`、`effectivePriceOf`、`valueOf`、`fatigueOf`、`reasonFor`（Task 5–9）、`reduceObservations`、`buildEatenIndex`（Task 2–3）、`localDateKey`（Task 1）
- Produces:
  `recommend({ dishes, shops, events, slot, now, excludedDishIds, random }): { dish: Dish, reason: string } | null`
  - `events` 默认 `[]`，`excludedDishIds` 默认 `[]`，`random` 默认 `Math.random`
  - `now` 为必填时间戳（Global Constraints 禁止模块内部调用 `Date.now()`）
  - 候选为空时返回 `null`

- [ ] **Step 1: 追加失败的测试到 `test/recommender.test.js`**

```js
import { recommend } from '../src/recommender.js';

/** 固定随机源，让 jitter 在测试下变成常数，score 完全可预测。 */
const fixedRandom = () => 0.5;

const recShops = [
  { id: 's1', name: '张记', platform: 'meituan', link: 'https://x/1', hygiene: 'unknown' },
  { id: 's2', name: '李记', platform: 'eleme', link: 'https://x/2', hygiene: 'unknown' },
];

test('候选池为空时返回 null', () => {
  assert.equal(
    recommend({ dishes: [], shops: recShops, slot: 'lunch', now: NOW, random: fixedRandom }),
    null,
  );
});

test('全部店铺被拉黑时返回 null', () => {
  assert.equal(
    recommend({
      dishes: [dish('d1', 's1')],
      shops: [{ ...recShops[0], hygiene: 'blocked' }],
      slot: 'lunch', now: NOW, random: fixedRandom,
    }),
    null,
  );
});

test('零事件冷启动时正常返回且不崩', () => {
  const r = recommend({
    dishes: [dish('d1', 's1'), dish('d2', 's2')],
    shops: recShops, slot: 'lunch', now: NOW, random: fixedRandom,
  });
  assert.ok(r);
  assert.ok(['d1', 'd2'].includes(r.dish.id));
  assert.equal(r.reason, '还没试过，试试看');
});

test('候选池只有一道菜时价格百分位不崩', () => {
  const r = recommend({
    dishes: [dish('d1', 's1')], shops: recShops,
    slot: 'lunch', now: NOW, random: fixedRandom,
  });
  assert.equal(r.dish.id, 'd1');
});

test('昨天刚吃过的菜排在没吃过的后面', () => {
  const yesterday = new Date(2026, 7, 21, 19, 0).getTime();
  const events = [
    { id: 'e1', ts: yesterday, slot: 'dinner', dishId: 'd1', type: 'recommended', value: null },
    { id: 'e2', ts: yesterday + 1000, slot: 'dinner', dishId: 'd1', type: 'rated', value: 'good' },
  ];
  const r = recommend({
    dishes: [
      dish('d1', 's1', { tags: ['川菜'] }),
      dish('d2', 's2', { tags: ['面食'] }),
    ],
    shops: recShops, events, slot: 'lunch', now: NOW, random: fixedRandom,
  });
  // d1 好吃度 1.0 但腻味系数 ≈1-exp(-1/7)=0.133；d2 冷启动 0.7 且无腻味
  assert.equal(r.dish.id, 'd2');
});

test('连换两次后仍能给出第三个不同的推荐', () => {
  const dishes = [dish('a', 's1'), dish('b', 's1'), dish('c', 's2')];
  const r = recommend({
    dishes, shops: recShops, slot: 'lunch', now: NOW,
    excludedDishIds: ['a', 'b'], random: fixedRandom,
  });
  assert.equal(r.dish.id, 'c');
});

test('注入固定随机源时结果确定可复现', () => {
  const dishes = [
    dish('a', 's1', { refPrice: 15 }),
    dish('b', 's2', { refPrice: 40 }),
  ];
  const args = { dishes, shops: recShops, slot: 'lunch', now: NOW, random: fixedRandom };
  const first = recommend(args);
  const second = recommend(args);
  assert.equal(first.dish.id, second.dish.id);
  // 两者好吃度同为 0.7，b 更贵 → a 的实惠度更高 → 必选 a
  assert.equal(first.dish.id, 'a');
});

test('被评为 bad 的菜排在冷启动的菜后面', () => {
  const events = [
    { id: 'e1', ts: NOW - 3 * DAY, slot: 'lunch', dishId: 'd1', type: 'recommended', value: null },
    { id: 'e2', ts: NOW - 3 * DAY + 1000, slot: 'lunch', dishId: 'd1', type: 'rated', value: 'bad' },
  ];
  const r = recommend({
    dishes: [
      dish('d1', 's1', { tags: ['川菜'] }),
      dish('d2', 's2', { tags: ['面食'] }),
    ],
    shops: recShops, events, slot: 'lunch', now: NOW, random: fixedRandom,
  });
  assert.equal(r.dish.id, 'd2');
});

test('返回的 reason 恒为非空字符串', () => {
  const r = recommend({
    dishes: [dish('d1', 's1')], shops: recShops,
    slot: 'lunch', now: NOW, random: fixedRandom,
  });
  assert.equal(typeof r.reason, 'string');
  assert.ok(r.reason.length > 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/recommender.test.js`
Expected: FAIL —— `recommend is not a function`

- [ ] **Step 3: 追加实现到 `src/recommender.js`**

在文件顶部补充 import：

```js
import { reduceObservations, buildEatenIndex } from './observations.js';
import { localDateKey } from './dates.js';
```

追加：

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test`
Expected: PASS，全部三个测试文件共 83 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/recommender.js test/recommender.test.js
git commit -m "feat: 组装 recommend 主入口"
```

---

## Task 11: 导出/导入快照

用户唯一的备份手段，必须可靠。

**Files:**
- Create: `src/snapshot.js`
- Create: `test/snapshot.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `SNAPSHOT_VERSION: 1`
  - `toSnapshot({ shops, dishes, events }, exportedAt: number): Snapshot`
  - `fromSnapshot(obj: unknown): { shops, dishes, events }` —— 校验失败时 `throw new Error(中文说明)`
  - `snapshotFilename(exportedAt: number): string` —— 形如 `meal-2026-08-22.json`

- [ ] **Step 1: 写失败的测试 `test/snapshot.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAPSHOT_VERSION, toSnapshot, fromSnapshot, snapshotFilename,
} from '../src/snapshot.js';

const data = {
  shops: [{ id: 's1', name: '张记', platform: 'meituan', link: 'https://x/1', hygiene: 'unknown', note: '' }],
  dishes: [{ id: 'd1', shopId: 's1', name: '黄焖鸡', refPrice: 22, tags: ['家常'], slots: ['lunch'], active: true }],
  events: [{ id: 'e1', ts: 1755830400000, slot: 'lunch', dishId: 'd1', type: 'rated', value: 'good' }],
};

test('toSnapshot 带上版本号与导出时间', () => {
  const snap = toSnapshot(data, 1755830400000);
  assert.equal(snap.version, SNAPSHOT_VERSION);
  assert.equal(snap.exportedAt, 1755830400000);
});

test('导出 → JSON → 导入 的往返完全一致', () => {
  const snap = toSnapshot(data, 1755830400000);
  const restored = fromSnapshot(JSON.parse(JSON.stringify(snap)));
  assert.deepStrictEqual(restored, data);
});

test('空数据的往返也一致', () => {
  const empty = { shops: [], dishes: [], events: [] };
  const restored = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(empty, 1))));
  assert.deepStrictEqual(restored, empty);
});

test('fromSnapshot 拒绝非对象', () => {
  assert.throws(() => fromSnapshot(null), /不是有效/);
  assert.throws(() => fromSnapshot('abc'), /不是有效/);
  assert.throws(() => fromSnapshot(42), /不是有效/);
});

test('fromSnapshot 拒绝版本不匹配', () => {
  assert.throws(() => fromSnapshot({ version: 999, shops: [], dishes: [], events: [] }), /版本/);
});

test('fromSnapshot 拒绝缺失字段', () => {
  assert.throws(() => fromSnapshot({ version: 1, shops: [], dishes: [] }), /events/);
  assert.throws(() => fromSnapshot({ version: 1, dishes: [], events: [] }), /shops/);
});

test('fromSnapshot 拒绝字段不是数组', () => {
  assert.throws(
    () => fromSnapshot({ version: 1, shops: {}, dishes: [], events: [] }), /shops/);
});

test('fromSnapshot 只取三个已知字段，丢弃多余内容', () => {
  const restored = fromSnapshot({ ...toSnapshot(data, 1), 恶意字段: 'x' });
  assert.deepStrictEqual(Object.keys(restored).sort(), ['dishes', 'events', 'shops']);
});

test('snapshotFilename 用本地日期命名', () => {
  const ts = new Date(2026, 7, 22, 23, 30).getTime();
  assert.equal(snapshotFilename(ts), 'meal-2026-08-22.json');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/snapshot.test.js`
Expected: FAIL —— `Cannot find module .../src/snapshot.js`

- [ ] **Step 3: 写 `src/snapshot.js`**

```js
import { localDateKey } from './dates.js';

export const SNAPSHOT_VERSION = 1;

/** 打包成可写入文件的快照对象。 */
export function toSnapshot({ shops, dishes, events }, exportedAt) {
  return { version: SNAPSHOT_VERSION, exportedAt, shops, dishes, events };
}

/**
 * 校验并解包快照。这是用户唯一的备份还原路径，
 * 因此宁可报错也不做任何容错猜测。
 */
export function fromSnapshot(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('导入失败：不是有效的备份文件');
  }
  if (obj.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `导入失败：备份版本不匹配（需要 ${SNAPSHOT_VERSION}，文件里是 ${obj.version}）`,
    );
  }
  for (const key of ['shops', 'dishes', 'events']) {
    if (!Array.isArray(obj[key])) {
      throw new Error(`导入失败：字段 ${key} 缺失或不是数组`);
    }
  }
  return { shops: obj.shops, dishes: obj.dishes, events: obj.events };
}

/** 备份文件名，用本地日期，便于在「文件」App 里辨认。 */
export function snapshotFilename(exportedAt) {
  return `meal-${localDateKey(exportedAt)}.json`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test`
Expected: PASS，全部四个测试文件共 92 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/snapshot.js test/snapshot.test.js
git commit -m "feat: 备份快照的导出与导入校验"
```

---

## Task 12: IndexedDB 存储层

唯一碰浏览器存储的模块，保持极薄。自动化测试不覆盖（Node 无 `indexedDB`，而 Global Constraints 禁止引入 npm 依赖），改由 Task 16 的真机验收覆盖。

**Files:**
- Create: `src/store.js`

**Interfaces:**
- Consumes: `toSnapshot`、`fromSnapshot`（Task 11）
- Produces（全部 async，除 `newId`）：
  - `newId(): string`
  - `loadAll(): Promise<{ shops, dishes, events }>`
  - `putShop(shop): Promise<void>` / `putDish(dish): Promise<void>`
  - `deleteShop(id): Promise<void>` —— 同时删除该店下所有菜品
  - `deleteDish(id): Promise<void>`
  - `appendEvent({ slot, dishId, type, value }): Promise<Event>` —— 内部补 `id` 与 `ts`
  - `exportSnapshot(): Promise<Snapshot>`
  - `importSnapshot(obj): Promise<void>` —— 整库替换
  - `setHygiene(shopId, hygiene): Promise<void>`

- [ ] **Step 1: 写 `src/store.js`**

```js
import { toSnapshot, fromSnapshot } from './snapshot.js';

const DB_NAME = 'meal';
const DB_VERSION = 1;
const STORES = ['shops', 'dishes', 'events'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve(req ? req.result : undefined);
      }),
  );
}

export function newId() {
  return crypto.randomUUID();
}

export async function loadAll() {
  const [shops, dishes, events] = await Promise.all(
    STORES.map((name) => run(name, 'readonly', (s) => s.getAll())),
  );
  return { shops, dishes, events };
}

export function putShop(shop) {
  return run('shops', 'readwrite', (s) => s.put(shop));
}

export function putDish(dish) {
  return run('dishes', 'readwrite', (s) => s.put(dish));
}

export function deleteDish(id) {
  return run('dishes', 'readwrite', (s) => s.delete(id));
}

/** 删店连带删掉它名下所有菜品，避免留下无法跳转的孤儿菜。 */
export async function deleteShop(id) {
  const { dishes } = await loadAll();
  for (const d of dishes.filter((d) => d.shopId === id)) {
    await deleteDish(d.id);
  }
  return run('shops', 'readwrite', (s) => s.delete(id));
}

export async function setHygiene(shopId, hygiene) {
  const { shops } = await loadAll();
  const shop = shops.find((s) => s.id === shopId);
  if (!shop) return;
  await putShop({ ...shop, hygiene });
}

export async function appendEvent({ slot, dishId, type, value = null }) {
  const event = { id: newId(), ts: Date.now(), slot, dishId, type, value };
  await run('events', 'readwrite', (s) => s.add(event));
  return event;
}

export async function exportSnapshot() {
  return toSnapshot(await loadAll(), Date.now());
}

/** 整库替换。先校验再清空，校验失败时旧数据分毫不动。 */
export async function importSnapshot(obj) {
  const data = fromSnapshot(obj);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    for (const name of STORES) {
      const store = tx.objectStore(name);
      store.clear();
      for (const row of data[name]) store.put(row);
    }
  });
}
```

- [ ] **Step 2: 确认纯逻辑测试未被破坏**

Run: `node --test`
Expected: PASS，92 个测试仍全绿（`store.js` 不被任何测试 import）

- [ ] **Step 3: 确认 store.js 没有偷偷引入常数**

Run: `grep -nE '[^a-zA-Z_][0-9]{2,}' src/store.js`
Expected: 只匹配到 `DB_VERSION = 1` 之外的无匹配项；若出现魔法数字，移入 `config.js`

- [ ] **Step 4: 提交**

```bash
git add src/store.js
git commit -m "feat: IndexedDB 存储层与整库导入导出"
```

---

## Task 13: 「今天这顿」页面与跳转

**Files:**
- Create: `index.html`
- Create: `css/style.css`
- Create: `src/deeplink.js`
- Create: `src/ui-today.js`

**Interfaces:**
- Consumes: `recommend`（Task 10）、`currentPick`（Task 4）、`loadAll`/`appendEvent`（Task 12）、`slotFromTime`/`localDateKey`（Task 1）、`SLOT_LABELS`/`CONFIG`（Task 1）
- Produces:
  - `openShopLink(link: string): void`
  - `copyText(text: string): Promise<boolean>`

页面行为见 spec §7.1。关键点：`slot` 优先取 URL 参数，缺失时由 `slotFromTime` 推断；已定下的这顿在重载时**不重新掷骰子**（用 `currentPick` 的 `activeDishId`）。

- [ ] **Step 1: 写 `index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>今天这顿</title>
<link rel="manifest" href="manifest.json">
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<main class="wrap">
  <section id="card" class="card" hidden>
    <button id="swap" class="swap" type="button">换一个</button>
    <p id="slot-label" class="slot-label"></p>
    <h1 id="dish-name" class="dish-name"></h1>
    <p id="shop-name" class="shop-name"></p>
    <p id="price" class="price"></p>
    <p id="reason" class="reason"></p>
    <button id="order" class="primary" type="button">去下单</button>
    <button id="copy-shop" class="ghost" type="button">复制店名</button>
  </section>

  <section id="empty" class="card" hidden>
    <p class="empty-text">候选池里这一顿没有可推的。</p>
    <a class="primary" href="pool.html">去添加菜品</a>
  </section>

  <a class="pool-link" href="pool.html">候选池</a>
</main>

<div id="feedback" class="overlay" hidden></div>

<script type="module" src="src/ui-today.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 `css/style.css`**

```css
:root {
  --bg: #faf8f5;
  --fg: #1c1a17;
  --muted: #6f6a63;
  --accent: #d4622a;
  --card: #ffffff;
  --line: #e8e3dc;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17150f;
    --fg: #f0ece5;
    --muted: #9a938a;
    --accent: #ff8a4c;
    --card: #221f19;
    --line: #35302a;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.6 -apple-system, "PingFang SC", "Noto Sans SC", sans-serif;
  padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
}

.wrap {
  max-width: 34rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
}

.card {
  position: relative;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 1.25rem;
  padding: 2rem 1.5rem 1.5rem;
}

.slot-label { margin: 0; color: var(--muted); font-size: 0.9rem; }
.dish-name { margin: 0.25rem 0 0.5rem; font-size: 2rem; line-height: 1.25; }
.shop-name { margin: 0; color: var(--muted); }
.price { margin: 0.25rem 0 0; color: var(--muted); }
.reason { margin: 1rem 0 1.5rem; color: var(--accent); }
.empty-text { margin: 0 0 1.25rem; color: var(--muted); }

.swap {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: none;
  border: none;
  color: var(--muted);
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}

.primary {
  display: block;
  width: 100%;
  padding: 1rem;
  border: none;
  border-radius: 0.75rem;
  background: var(--accent);
  color: #fff;
  font-size: 1.1rem;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}

.ghost {
  display: block;
  width: 100%;
  margin-top: 0.75rem;
  padding: 0.65rem;
  border: 1px solid var(--line);
  border-radius: 0.75rem;
  background: none;
  color: var(--muted);
  font-size: 0.9rem;
  cursor: pointer;
}

.pool-link {
  display: block;
  margin-top: 2rem;
  text-align: center;
  color: var(--muted);
  font-size: 0.85rem;
}

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.sheet {
  width: 100%;
  max-width: 34rem;
  background: var(--card);
  border-radius: 1.25rem 1.25rem 0 0;
  padding: 1.5rem 1.25rem calc(1.5rem + env(safe-area-inset-bottom));
}

.fb-question { margin: 0 0 1.25rem; font-size: 1.1rem; }

.fb-buttons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}

.fb-buttons button {
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 0.75rem;
  background: none;
  color: var(--fg);
  font-size: 1.05rem;
  cursor: pointer;
}

.fb-extra {
  display: flex;
  justify-content: space-between;
  margin-top: 1.25rem;
}

.link {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 0.85rem;
  text-decoration: underline;
  cursor: pointer;
}

.fb-price-box { display: flex; gap: 0.5rem; margin-top: 1rem; }
.fb-price-box input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: var(--bg);
  color: var(--fg);
  font-size: 1rem;
}
.fb-price-box button {
  padding: 0.75rem 1.25rem;
  border: none;
  border-radius: 0.5rem;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}
```

- [ ] **Step 3: 写 `src/deeplink.js`**

```js
/**
 * 打开店铺链接。用整页跳转而非 window.open —— iOS Safari 会拦截
 * 非用户手势触发的新窗口，而整页跳转能可靠唤起外卖 App。
 */
export function openShopLink(link) {
  window.location.href = link;
}

/** 兜底路径：链接没能唤起 App 时，让用户复制店名自己去搜。 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 写 `src/ui-today.js`**

```js
import { SLOT_LABELS, SLOTS, CONFIG } from './config.js';
import { slotFromTime, localDateKey } from './dates.js';
import { currentPick } from './observations.js';
import { recommend } from './recommender.js';
import { loadAll, appendEvent } from './store.js';
import { openShopLink, copyText } from './deeplink.js';

const el = (id) => document.getElementById(id);

/** slot 优先取 URL 参数（快捷指令会带上），缺失或非法时按当前时间推断。 */
function resolveSlot(now) {
  const fromUrl = new URLSearchParams(location.search).get('slot');
  return SLOTS.includes(fromUrl) ? fromUrl : slotFromTime(now);
}

let state = { slot: null, dish: null, shop: null, swapCount: 0 };

async function render() {
  const now = Date.now();
  const slot = resolveSlot(now);
  const { shops, dishes, events } = await loadAll();
  const nowKey = localDateKey(now);

  const pick = currentPick(events, slot, nowKey);
  let dish = null;
  let reason = '';

  // 这一顿已经定下的，重载时不重新掷骰子。
  if (pick.activeDishId) {
    dish = dishes.find((d) => d.id === pick.activeDishId) ?? null;
    if (dish) reason = '这顿已经定了';
  }

  if (!dish) {
    const result = recommend({
      dishes, shops, events, slot, now,
      excludedDishIds: pick.swappedDishIds,
    });
    if (result) {
      dish = result.dish;
      reason = result.reason;
      await appendEvent({ slot, dishId: dish.id, type: 'recommended' });
    }
  }

  if (!dish) {
    el('card').hidden = true;
    el('empty').hidden = false;
    return;
  }

  const shop = shops.find((s) => s.id === dish.shopId);
  state = { slot, dish, shop, swapCount: pick.swapCount };

  el('slot-label').textContent = SLOT_LABELS[slot];
  el('dish-name').textContent = dish.name;
  el('shop-name').textContent = shop.name;
  el('price').textContent = `约 ¥${dish.refPrice}`;
  el('reason').textContent = reason;
  el('swap').hidden = pick.swapCount >= CONFIG.MAX_SWAPS;
  el('empty').hidden = true;
  el('card').hidden = false;
}

el('order').addEventListener('click', async () => {
  await appendEvent({
    slot: state.slot, dishId: state.dish.id, type: 'clicked',
  });
  openShopLink(state.shop.link);
});

el('swap').addEventListener('click', async () => {
  await appendEvent({
    slot: state.slot, dishId: state.dish.id, type: 'swapped',
  });
  await render();
});

el('copy-shop').addEventListener('click', async () => {
  const ok = await copyText(state.shop.name);
  el('copy-shop').textContent = ok ? '已复制店名' : '复制失败，请长按选择';
  setTimeout(() => { el('copy-shop').textContent = '复制店名'; }, 2000);
});

await render();
```

- [ ] **Step 5: 启动本地服务器并人工确认页面可用**

ES Modules 无法从 `file://` 加载，必须走 HTTP。

Run: `python -m http.server 8000`
然后浏览器打开 `http://localhost:8000/index.html`

Expected: 由于候选池为空，页面显示「候选池里这一顿没有可推的。」与「去添加菜品」按钮，控制台无报错。

- [ ] **Step 6: 用浏览器控制台塞两条假数据，确认推荐卡片渲染**

在 `http://localhost:8000/index.html` 的控制台执行：

```js
const { putShop, putDish, newId } = await import('./src/store.js');
const sid = newId();
await putShop({ id: sid, name: '张记黄焖鸡', platform: 'meituan', link: 'https://example.com/shop', hygiene: 'unknown', note: '' });
await putDish({ id: newId(), shopId: sid, name: '黄焖鸡米饭', refPrice: 22, tags: ['家常'], slots: ['breakfast','lunch','dinner'], active: true });
location.reload();
```

Expected: 卡片显示「黄焖鸡米饭 / 张记黄焖鸡 / 约 ¥22 / 还没试过，试试看」，右上角有「换一个」。

- [ ] **Step 7: 确认「换一个」在两次后消失、重载不改主意**

在页面上连按「换一个」两次 → 按钮消失（候选只有一道菜时会转为显示空状态，这是预期的）。
再加两道菜后重载页面两次 → 菜名不变。

Expected: 与描述一致。

- [ ] **Step 8: 确认纯逻辑测试未被破坏**

Run: `node --test`
Expected: PASS，92 个测试全绿

- [ ] **Step 9: 提交**

```bash
git add index.html css/style.css src/deeplink.js src/ui-today.js
git commit -m "feat: 今天这顿页面与外卖 App 跳转"
```

---

## Task 14: 反馈浮层

**Files:**
- Modify: `src/ui-today.js`（追加浮层逻辑）
- Modify: `index.html`（无需改动，浮层由 JS 注入到已有的 `#feedback` 容器）

**Interfaces:**
- Consumes: `pendingFeedback`、`reduceObservations`（Task 2、4）、`appendEvent`、`setHygiene`（Task 12）
- Produces: 无新的对外导出

行为见 spec §7.3：在 `render()` 之前检查是否有待补问的上一顿；四个按钮任一点击即写 `rated` 并关闭；「吃坏了」写 `sick` 并把店铺置为 `blocked`；「填实付价」写 `paid`。

- [ ] **Step 1: 追加浮层逻辑到 `src/ui-today.js`**

在 import 区补充：

```js
import { pendingFeedback, reduceObservations } from './observations.js';
import { setHygiene } from './store.js';
```

在 `await render();` **之前**插入：

```js
const RATING_LABELS = { good: '好吃', ok: '还行', bad: '不了', skipped: '没吃成' };

/** 渲染补问上一顿的浮层。已评过、被换掉、或就是当前这顿的，都不问。 */
async function renderFeedback() {
  const now = Date.now();
  const slot = resolveSlot(now);
  const { shops, dishes, events } = await loadAll();

  const target = pendingFeedback(reduceObservations(events), now, slot);
  if (!target) return;

  const dish = dishes.find((d) => d.id === target.dishId);
  if (!dish) return; // 菜已从候选池删除，无从问起
  const shop = shops.find((s) => s.id === dish.shopId);

  const overlay = el('feedback');
  overlay.innerHTML = `
    <div class="sheet">
      <p class="fb-question">上顿的${dish.name}怎么样？</p>
      <div class="fb-buttons">
        ${Object.entries(RATING_LABELS)
          .map(([k, label]) => `<button type="button" data-rate="${k}">${label}</button>`)
          .join('')}
      </div>
      <div class="fb-extra">
        <button type="button" class="link" data-action="sick">吃坏了</button>
        <button type="button" class="link" data-action="price">填实付价</button>
      </div>
      <div class="fb-price-box" hidden>
        <input type="number" inputmode="decimal" placeholder="实付价（元）">
        <button type="button" data-action="save-price">保存</button>
      </div>
    </div>
  `;
  overlay.hidden = false;

  const close = () => { overlay.hidden = true; overlay.innerHTML = ''; };

  overlay.addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;

    if (button.dataset.rate) {
      await appendEvent({
        slot: target.slot, dishId: target.dishId,
        type: 'rated', value: button.dataset.rate,
      });
      close();
      await render();
      return;
    }

    if (button.dataset.action === 'sick') {
      await appendEvent({ slot: target.slot, dishId: target.dishId, type: 'sick' });
      await appendEvent({
        slot: target.slot, dishId: target.dishId, type: 'rated', value: 'bad',
      });
      if (shop) await setHygiene(shop.id, 'blocked');
      close();
      await render();
      return;
    }

    if (button.dataset.action === 'price') {
      overlay.querySelector('.fb-price-box').hidden = false;
      overlay.querySelector('.fb-price-box input').focus();
      return;
    }

    if (button.dataset.action === 'save-price') {
      const amount = Number(overlay.querySelector('.fb-price-box input').value);
      if (Number.isFinite(amount) && amount > 0) {
        await appendEvent({
          slot: target.slot, dishId: target.dishId, type: 'paid', value: amount,
        });
      }
      overlay.querySelector('.fb-price-box').hidden = true;
    }
  });
}
```

把文件末尾改为：

```js
await renderFeedback();
await render();
```

- [ ] **Step 2: 人工验证浮层出现在该出现的时候**

启动 `python -m http.server 8000`，在控制台伪造一条「昨天推荐过但没评分」的事件：

```js
const { appendEvent, loadAll } = await import('./src/store.js');
const { dishes } = await loadAll();
const d = dishes[0];
const yesterday = Date.now() - 86400000;
const db = await indexedDB.open('meal');
// 直接写入带过去时间戳的事件
const tx = db.result.transaction('events', 'readwrite');
tx.objectStore('events').add({ id: crypto.randomUUID(), ts: yesterday, slot: 'dinner', dishId: d.id, type: 'recommended', value: null });
tx.objectStore('events').add({ id: crypto.randomUUID(), ts: yesterday + 60000, slot: 'dinner', dishId: d.id, type: 'clicked', value: null });
tx.oncomplete = () => location.reload();
```

Expected: 页面加载后弹出底部浮层「上顿的〈菜名〉怎么样？」，四个按钮 + 两个小字链接。

- [ ] **Step 3: 逐个验证四条反馈路径**

1. 点「好吃」→ 浮层关闭，重载后不再弹出
2. 重新伪造事件后点「吃坏了」→ 浮层关闭，该店消失于推荐，候选池页面显示其为拉黑（Task 15 完成后再复查）
3. 重新伪造后点「填实付价」→ 输入框展开，填 28 保存 → 输入框收起
4. 重新伪造，但把 `clicked` 换成 `swapped` → **不应弹出浮层**

Expected: 四条全部符合。第 4 条是 Global Constraints 里那条 spec 澄清的验证点。

- [ ] **Step 4: 确认纯逻辑测试未被破坏**

Run: `node --test`
Expected: PASS，92 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/ui-today.js
git commit -m "feat: 下一顿补问的反馈浮层"
```

---

## Task 15: 候选池页面

**Files:**
- Create: `pool.html`
- Create: `src/ui-pool.js`
- Modify: `css/style.css`（追加候选池样式）

**Interfaces:**
- Consumes: `loadAll`/`putShop`/`putDish`/`deleteShop`/`deleteDish`/`newId`/`exportSnapshot`/`importSnapshot`（Task 12）、`reduceObservations`（Task 2）、`tasteOf`（Task 6）、`snapshotFilename`（Task 11）、`SLOTS`/`SLOT_LABELS`（Task 1）
- Produces: 无新的对外导出

行为见 spec §7.2。每道菜旁显示 `taste` 值与吃过次数 —— 这是让用户能直接定位「哪条数据歪了」的设计。

- [ ] **Step 1: 写 `pool.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>候选池</title>
<link rel="manifest" href="manifest.json">
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<main class="wrap">
  <a class="pool-link" href="index.html">← 今天这顿</a>

  <h1 class="page-title">候选池</h1>

  <div class="io-row">
    <button id="export" class="ghost" type="button">导出备份</button>
    <label class="ghost import-label">
      导入备份
      <input id="import" type="file" accept="application/json" hidden>
    </label>
  </div>
  <p id="io-msg" class="io-msg"></p>

  <form id="shop-form" class="form">
    <h2 class="form-title">加一家店</h2>
    <input name="name" placeholder="店名" required>
    <select name="platform">
      <option value="meituan">美团</option>
      <option value="eleme">饿了么</option>
    </select>
    <input name="link" type="url" placeholder="从外卖 App 分享出来的链接" required>
    <select name="hygiene">
      <option value="unknown">卫生：未知</option>
      <option value="trusted">卫生：放心</option>
      <option value="blocked">卫生：拉黑</option>
    </select>
    <button class="primary" type="submit">保存店铺</button>
  </form>

  <div id="shops"></div>
</main>

<script type="module" src="src/ui-pool.js"></script>
</body>
</html>
```

- [ ] **Step 2: 追加候选池样式到 `css/style.css`**

```css
.page-title { font-size: 1.5rem; margin: 1rem 0 1.25rem; }
.form-title { font-size: 1rem; margin: 0 0 0.75rem; color: var(--muted); }

.form {
  display: grid;
  gap: 0.75rem;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 1rem;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}

.form input,
.form select {
  padding: 0.75rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: var(--bg);
  color: var(--fg);
  font-size: 1rem;
}

.io-row { display: flex; gap: 0.75rem; margin-bottom: 0.5rem; }
.io-row > * { flex: 1; margin-top: 0; }
.import-label { text-align: center; }
.io-msg { min-height: 1.5rem; color: var(--muted); font-size: 0.85rem; margin: 0 0 1rem; }

.shop-block {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 1rem;
  padding: 1.25rem;
  margin-bottom: 1rem;
}

.shop-head { display: flex; justify-content: space-between; align-items: baseline; }
.shop-title { font-size: 1.1rem; font-weight: 600; margin: 0; }
.shop-meta { color: var(--muted); font-size: 0.8rem; }
.shop-blocked { color: var(--accent); }

.dish-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.6rem 0;
  border-top: 1px solid var(--line);
}

.dish-stat { color: var(--muted); font-size: 0.78rem; white-space: nowrap; }
```

- [ ] **Step 3: 写 `src/ui-pool.js`**

```js
import { SLOTS, SLOT_LABELS } from './config.js';
import { reduceObservations } from './observations.js';
import { tasteOf } from './recommender.js';
import { snapshotFilename } from './snapshot.js';
import {
  loadAll, putShop, putDish, deleteShop, deleteDish,
  newId, exportSnapshot, importSnapshot,
} from './store.js';

const el = (id) => document.getElementById(id);
const PLATFORM_LABELS = { meituan: '美团', eleme: '饿了么' };
const HYGIENE_LABELS = { unknown: '未知', trusted: '放心', blocked: '已拉黑' };

async function render() {
  const now = Date.now();
  const { shops, dishes, events } = await loadAll();
  const observations = reduceObservations(events);

  const obsByDish = new Map();
  for (const obs of observations) {
    let list = obsByDish.get(obs.dishId);
    if (!list) obsByDish.set(obs.dishId, (list = []));
    list.push(obs);
  }

  el('shops').innerHTML = shops
    .map((shop) => {
      const rows = dishes
        .filter((d) => d.shopId === shop.id)
        .map((d) => {
          const obs = obsByDish.get(d.id) ?? [];
          const taste = tasteOf(obs, now).toFixed(2);
          const eatenCount = obs.filter((o) => o.eaten).length;
          const slotText = d.slots.map((s) => SLOT_LABELS[s]).join('/');
          return `
            <div class="dish-row">
              <span>${d.name}　<span class="shop-meta">¥${d.refPrice}・${slotText}</span></span>
              <span class="dish-stat">
                好吃度 ${taste}・吃过 ${eatenCount} 次
                <button class="link" data-del-dish="${d.id}" type="button">删</button>
              </span>
            </div>`;
        })
        .join('');

      return `
        <section class="shop-block">
          <div class="shop-head">
            <p class="shop-title">${shop.name}</p>
            <span class="shop-meta ${shop.hygiene === 'blocked' ? 'shop-blocked' : ''}">
              ${PLATFORM_LABELS[shop.platform]}・卫生${HYGIENE_LABELS[shop.hygiene]}
            </span>
          </div>
          <p class="shop-meta">
            <a href="${shop.link}">跳转链接</a>
            <button class="link" data-fix-link="${shop.id}" type="button">链接失效了？</button>
            <button class="link" data-del-shop="${shop.id}" type="button">删店</button>
          </p>
          ${rows}
          <form class="form" data-dish-form="${shop.id}">
            <input name="name" placeholder="菜名" required>
            <input name="refPrice" type="number" step="0.5" placeholder="参考价" required>
            <input name="tags" placeholder="标签，逗号分隔（如：川菜,辣）">
            <label class="shop-meta">适用饭点</label>
            ${SLOTS.map(
              (s) => `<label class="shop-meta">
                <input type="checkbox" name="slots" value="${s}" checked> ${SLOT_LABELS[s]}
              </label>`,
            ).join('')}
            <button class="ghost" type="submit">加这道菜</button>
          </form>
        </section>`;
    })
    .join('');
}

el('shop-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  await putShop({
    id: newId(),
    name: f.get('name').trim(),
    platform: f.get('platform'),
    link: f.get('link').trim(),
    hygiene: f.get('hygiene'),
    note: '',
  });
  e.target.reset();
  await render();
});

el('shops').addEventListener('submit', async (e) => {
  const shopId = e.target.dataset.dishForm;
  if (!shopId) return;
  e.preventDefault();
  const f = new FormData(e.target);
  const slots = f.getAll('slots');
  if (slots.length === 0) {
    el('io-msg').textContent = '至少要勾一个饭点。';
    return;
  }
  await putDish({
    id: newId(),
    shopId,
    name: f.get('name').trim(),
    refPrice: Number(f.get('refPrice')),
    tags: f.get('tags').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
    slots,
    active: true,
  });
  e.target.reset();
  await render();
});

el('shops').addEventListener('click', async (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  if (button.dataset.delDish) {
    if (confirm('删掉这道菜？历史记录会保留。')) {
      await deleteDish(button.dataset.delDish);
      await render();
    }
    return;
  }

  if (button.dataset.delShop) {
    if (confirm('删掉这家店？它名下所有菜品也会一并删除。')) {
      await deleteShop(button.dataset.delShop);
      await render();
    }
    return;
  }

  if (button.dataset.fixLink) {
    const { shops } = await loadAll();
    const shop = shops.find((s) => s.id === button.dataset.fixLink);
    const next = prompt('粘贴新的分享链接：', shop.link);
    if (next && next.trim()) {
      await putShop({ ...shop, link: next.trim() });
      await render();
    }
  }
});

el('export').addEventListener('click', async () => {
  const snapshot = await exportSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = snapshotFilename(snapshot.exportedAt);
  a.click();
  URL.revokeObjectURL(url);
  el('io-msg').textContent = `已导出 ${a.download}`;
});

el('import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await importSnapshot(JSON.parse(await file.text()));
    el('io-msg').textContent = '导入成功。';
    await render();
  } catch (err) {
    el('io-msg').textContent = err.message;
  }
  e.target.value = '';
});

await render();
```

- [ ] **Step 4: 人工验证增删与统计显示**

Run: `python -m http.server 8000`，打开 `http://localhost:8000/pool.html`

1. 加一家店 → 出现店铺卡片
2. 在该店卡片里加两道菜 → 出现两行，各显示「好吃度 0.70・吃过 0 次」
3. 回到 `index.html` 点几次「换一个」和「去下单」，再回候选池 → 好吃度数值发生变化
4. 点某道菜的「删」→ 确认后消失
5. 点「链接失效了？」→ 弹出 prompt，改完后链接更新

Expected: 五条全部符合。

- [ ] **Step 5: 人工验证导出导入往返**

1. 点「导出备份」→ 下载 `meal-YYYY-MM-DD.json`
2. 删掉一家店
3. 点「导入备份」选刚下载的文件 → 提示「导入成功」，被删的店回来了
4. 随便造一个损坏的 JSON（把 `"version": 1` 改成 `"version": 9`）导入 → 显示「导入失败：备份版本不匹配……」，且现有数据未被清空

Expected: 四条全部符合。第 4 条验证 spec §9.1 所要求的备份可靠性。

- [ ] **Step 6: 确认纯逻辑测试未被破坏**

Run: `node --test`
Expected: PASS，92 个测试全绿

- [ ] **Step 7: 提交**

```bash
git add pool.html src/ui-pool.js css/style.css
git commit -m "feat: 候选池页面与备份导入导出"
```

---

## Task 16: manifest、README 与真机验收

**Files:**
- Create: `manifest.json`
- Create: `icon.svg`
- Create: `README.md`

**Interfaces:**
- Consumes: 全部
- Produces: 可部署站点

- [ ] **Step 1: 写 `manifest.json`**

不注册 Service Worker（Global Constraints）。iOS 靠 manifest + meta 标签即可安装到主屏。

```json
{
  "name": "今天这顿",
  "short_name": "这顿",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "background_color": "#faf8f5",
  "theme_color": "#d4622a",
  "icons": [
    { "src": "icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }
  ]
}
```

- [ ] **Step 2: 写 `icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="42" fill="#d4622a"/>
  <circle cx="96" cy="104" r="44" fill="none" stroke="#fff" stroke-width="10"/>
  <path d="M60 52h72" stroke="#fff" stroke-width="10" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 3: 在 `index.html` 与 `pool.html` 的 `<head>` 中加入 apple-touch-icon**

两个文件都在 `<link rel="manifest" ...>` 之后加一行：

```html
<link rel="apple-touch-icon" href="icon.svg">
```

- [ ] **Step 4: 写 `README.md`**

````markdown
# 今天这顿

每天三个饭点自动打开，只推荐一道菜，点一下跳到外卖 App 下单。

设计文档：`docs/superpowers/specs/2026-08-22-meal-recommender-design.md`

## 它不做什么

- 不代替你下单或支付 —— 只给推荐和跳转链接，最后一步你自己完成
- 不抓取任何外卖平台数据 —— 候选池由你手动录入
- 没有服务器 —— 数据只存在你这台手机的浏览器里

## 首次使用

### 1. 部署

推到 GitHub 仓库 `meal`，在仓库 Settings → Pages 里把来源设为 `main` 分支根目录。
几分钟后访问 `https://xiaoyu-studio.github.io/meal/`。

### 2. 添加到主屏幕（必做）

用 **Safari** 打开上面的地址 → 分享按钮 → 「添加到主屏幕」。

这一步不是为了好看：Safari 会在 7 天无访问后清理网站的脚本可写存储，
**但已安装到主屏的网页豁免这条规则**。不装到主屏，你的候选池和用餐历史会被清掉。

### 3. 录入候选池

点页面底部「候选池」。每家店需要：

1. 在美团或饿了么 App 里找到这家店
2. 点「分享」→ 复制链接
3. 回到候选池，填店名、选平台、粘贴链接
4. 在该店卡片下方逐道添加菜品

先录 5 家就能开始用，20–30 家会明显更好用。

### 4. 配置三条快捷指令

打开 iOS「快捷指令」App → 底部「自动化」→ 「新建自动化」→ 「特定时间」。

建三条，每条的动作都选「打开 URL」，并把「运行前询问」关掉：

| 时间 | URL |
|---|---|
| 08:00 | `https://xiaoyu-studio.github.io/meal/?slot=breakfast` |
| 11:30 | `https://xiaoyu-studio.github.io/meal/?slot=lunch` |
| 17:30 | `https://xiaoyu-studio.github.io/meal/?slot=dinner` |

时间按自己作息调整。

## 日常使用

到饭点手机会自动打开推荐页。点「去下单」跳到外卖 App 完成支付。
不想吃就点右上角「换一个」，一顿最多换两次。

下一顿打开时会补问上一顿怎么样 —— 一次点击就好。

## 备份

候选池页面顶部有「导出备份」，会下载一个 JSON 文件，存进「文件」App 即可。
**建议每月导出一次。** 数据只在这一台手机上，没有别的副本。

## 本地开发

ES Modules 无法从 `file://` 加载，必须走 HTTP：

```bash
python -m http.server 8000
```

然后打开 `http://localhost:8000/index.html`。

## 测试

纯逻辑模块（`config` / `dates` / `observations` / `recommender` / `snapshot`）
零依赖，用 Node 自带的测试运行器：

```bash
node --test
```

`store.js` 与 `ui-*.js` 碰浏览器 API，不在自动化测试范围内，由真机验收覆盖。

## 调推荐手感

所有可调常数都在 `src/config.js` 里，改完刷新页面即生效。
最可能需要调的是 `FATIGUE_TAU_DISH`（多久不腻，默认 7 天）和
`W_TASTE` / `W_VALUE`（好吃与便宜的权重，默认 0.7 / 0.3）。
````

- [ ] **Step 5: 跑全量测试**

Run: `node --test`
Expected: PASS，92 个测试全绿

- [ ] **Step 6: 提交并部署**

```bash
git add manifest.json icon.svg README.md index.html pool.html
git commit -m "feat: PWA manifest、图标与使用文档"
git branch -M main
git remote add origin git@github.com:xiaoyu-studio/meal.git
git push -u origin main
```

然后在 GitHub 仓库 Settings → Pages 把来源设为 `main` 分支根目录。

- [ ] **Step 7: iPhone 真机验收清单（spec §9.2）**

自动化无法覆盖，逐条在 iPhone 上确认：

1. **添加到主屏后能以独立窗口打开** —— Safari 打开 `https://xiaoyu-studio.github.io/meal/` → 分享 → 添加到主屏幕 → 从主屏图标启动，确认没有 Safari 地址栏
2. **三条快捷指令到点真的弹出对应饭点的页面** —— 把某条自动化的时间临时改到两分钟后，锁屏等待
3. **点「去下单」真的唤起外卖 App 并落在正确店铺页**
4. **杀掉 Safari 并重启手机后，候选池与历史数据仍在** —— 这条直接验证 ITP 豁免是否如预期生效，是整个零后端方案成立的前提
5. **导出 JSON 能存入「文件」App，删掉一家店后再导入，数据完整还原**

Expected: 五条全部通过。

**第 4 条若失败**，说明 ITP 豁免未如预期生效，spec §3.4 的零后端假设不成立 —— 停止后续工作并回到 spec，评估升级为「轻后端 + Bark 推送」（spec §11）。

- [ ] **Step 8: 记录验收结果并提交**

在 `README.md` 末尾追加一节，写下验收日期与五条的实际结果（尤其第 4 条重启后数据是否留存，以及分享短链在真机上是否成功唤起 App）。

```bash
git add README.md
git commit -m "docs: 记录 iPhone 真机验收结果"
```

---

## Self-Review

**1. Spec 覆盖检查**

| Spec 章节 | 对应任务 |
|---|---|
| §3.1 不代替下单 | Task 13（只跳转不下单）、Task 16 README |
| §3.2 不抓数据 | Task 15（手动录入候选池） |
| §3.3 PWA 形态 | Task 13、16 |
| §3.4 零后端 | Task 12（IndexedDB）、Task 16（快捷指令） |
| §3.5 不用 SW | Global Constraints、Task 16 |
| §3.6 一顿一个 + 限 2 次 | Task 4（`currentPick`）、Task 13 |
| §4 架构与模块 | 文件结构表、Task 1–15 |
| §5.1 `shops` | Task 12、15 |
| §5.2 `dishes` | Task 12、15 |
| §5.3 `events` | Task 12（`appendEvent`）、Task 2（归约） |
| §6.1 硬过滤 | Task 5 |
| §6.2 观察值归约 | Task 2 |
| §6.3 好吃度 | Task 6 |
| §6.4 实惠度 | Task 7 |
| §6.5 腻味系数 | Task 8 |
| §6.6 最终评分 | Task 10 |
| §6.7 CONFIG | Task 1 |
| §6.8 推荐理由 | Task 9 |
| §7.1 今天这顿 | Task 13 |
| §7.2 候选池 | Task 15 |
| §7.3 反馈浮层 | Task 4（`pendingFeedback`）、Task 14 |
| §8.1 跳转链接与兜底 | Task 13（`deeplink.js`）、Task 15（链接失效重录） |
| §8.2 快捷指令 | Task 16 README |
| §8.3 部署 | Task 16 |
| §9.1 自动化测试 | Task 1–11 各自的测试 |
| §9.2 真机验收 | Task 16 Step 7 |
| §10 风险应对 | Task 15（重录链接）、Task 13（复制店名）、Task 16 Step 7（重启验证） |

无遗漏。

**2. 占位符扫描**

无 TBD / TODO；每个代码步骤都给出完整可运行代码；无「同 Task N」式引用；无「加上适当的错误处理」式空话。

**3. 类型一致性核对**

- `Observation` 的 `source` 字段在 Task 2 定义，Task 4 的 `pendingFeedback`、Task 10 的 `recommend` 使用，命名一致
- `fatigueOf` 在 Task 8 返回 `{ total, fDish, fShop, fTag }`，Task 10 用 `fatigue.total` 与 `fatigue.fDish`，一致
- `buildEatenIndex` 在 Task 3 返回 `{ byDish, byShop, byTag }`，Task 10 使用同名，一致
- `currentPick` 在 Task 4 返回 `{ activeDishId, swappedDishIds, swapCount }`，Task 13 使用同名，一致
- `appendEvent({ slot, dishId, type, value })` 在 Task 12 定义，Task 13、14 调用签名一致
- `CONFIG.MAX_SWAPS` 在 Task 1 定义，Task 13 使用
- 事件 `type` 六个取值（`recommended`/`swapped`/`clicked`/`rated`/`paid`/`sick`）在 Task 2、12、13、14 中一致
