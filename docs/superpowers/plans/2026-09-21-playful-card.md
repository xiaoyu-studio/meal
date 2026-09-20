# 首页卡片重做 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「今天这顿」的卡片从白底表单改成便签纸风格，配色跟饭点走、深浅色跟系统走，并让左右滑动时卡片跟随手指。

**Architecture:** 纯 CSS + 内联 SVG + emoji 做视觉，没有新依赖。拖动层（`.paper`，JS 写 transform）与飘动层（`.note`，CSS 动画写 transform）分开，互不覆盖。手势改用 Pointer Events，靠 `touch-action: pan-y` 把纵向滚动留给浏览器，因此监听器保持 passive。新增一个纯模块 `src/emoji.js` 按菜名猜 emoji。

**Tech Stack:** 原生 ES modules、`node --test`、无构建、无依赖。

**Spec:** `docs/superpowers/specs/2026-09-21-playful-card-design.md`

## Global Constraints

- 零运行时依赖、零构建步骤。`package.json` 只允许 `name` / `private` / `type`。
- 纯函数模块不得触碰时钟、随机数、DOM、存储：`config.js` `dates.js` `observations.js` `recommender.js` `snapshot.js`，**本计划新增的 `emoji.js` 同样受此约束**。
- 不注册 Service Worker。
- 面向用户的文案一律简体中文。
- 可调常数只放 `src/config.js`。
- 插进 `innerHTML` 的用户数据必须过 `esc()`；本计划一律用 `textContent` / `createElement`，不新增 `innerHTML` 拼接。
- 不 `git push`，不动 `main`。工作分支 `feat/playful-card`（已存在，spec 已在其上提交为 `8827856`）。
- **卡片上的元素 id 一个不改**：`slot-label` `dish-name` `shop-name` `price` `reason` `carousel-pos` `order` `copy-shop` `mute` `prev` `swap` `card` `empty` `failure` `feedback`。
- `#order` 必须仍是带 `href` 的 `<a>`（iOS Universal Links 唤不起脚本跳转）。
- `pool.html` / `src/ui-pool.js` 一行不改。共用类 `.card` `.ghost` `.primary` 的**基础规则不许改**，首页的差异一律用 `.board` 作用域限定。
- `src/observations.js` `src/recommender.js` `src/store.js` `src/dates.js` `src/snapshot.js` 不动。

---

## 文件结构

| 文件 | 责任 | 本计划 |
|---|---|---|
| `src/config.js` | 可调常数与文案表 | 加 `DISH_EMOJI` `DEFAULT_DISH_EMOJI` `POLAROID_CAPS` `SWIPE_RATIO` `CAROUSEL_DOTS_MAX` |
| `src/emoji.js` | 菜名 → emoji，纯函数 | 新建 |
| `test/emoji.test.js` | 上者的测试 | 新建 |
| `index.html` | 卡片结构 | 重排 `#card` 内部 |
| `css/style.css` | 样式 | 新增「首页便签卡片」一段；改写 `.swap-row` `.swap` `.carousel-pos`；`prefers-reduced-motion` 段扩充 |
| `src/ui-today.js` | 渲染与交互 | `showAt()` 多写四样；手势换 Pointer Events；翻页加动画 |
| `CLAUDE.md` | 项目约定 | 纯模块清单加 `emoji.js` |
| `docs/acceptance-checklist.md` | 真机验收 | 加第 27–31 条，第 15 条标记待重验 |

任务顺序是有依赖的：Task 1 独立；Task 2 改结构（改完页面仍可用，emoji 是占位）；Task 3 把数据接上；Task 4 加动效；Task 5 换手势；Task 6 收文档。

---

### Task 1: 菜名猜 emoji

**Files:**
- Modify: `src/config.js`（文件末尾追加）
- Create: `src/emoji.js`
- Create: `test/emoji.test.js`

**Interfaces:**
- Consumes: 无
- Produces: `dishEmoji(name: string) → string`（供 Task 3 用）；常数 `DISH_EMOJI`、`DEFAULT_DISH_EMOJI`

- [ ] **Step 1: 写失败的测试**

新建 `test/emoji.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dishEmoji } from '../src/emoji.js';
import { DEFAULT_DISH_EMOJI } from '../src/config.js';

test('dishEmoji 按关键字命中', () => {
  assert.equal(dishEmoji('招牌汉堡四件套'), '🍔');
  assert.equal(dishEmoji('豚骨拉面'), '🍜');
  assert.equal(dishEmoji('番茄鸡蛋盖浇饭'), '🍚');
});

test('dishEmoji 表的顺序就是优先级', () => {
  // 「面」排在「鸡」前面，鸡汤面应当出面而不是鸡
  assert.equal(dishEmoji('鸡汤面'), '🍜');
  // 「粉」也归到面食
  assert.equal(dishEmoji('螺蛳粉'), '🍜');
});

test('dishEmoji 一个都不中就退回通用图标', () => {
  assert.equal(dishEmoji('佛跳墙'), DEFAULT_DISH_EMOJI);
  assert.equal(dishEmoji(''), DEFAULT_DISH_EMOJI);
});

test('dishEmoji 对非字符串不抛异常', () => {
  assert.equal(dishEmoji(null), DEFAULT_DISH_EMOJI);
  assert.equal(dishEmoji(undefined), DEFAULT_DISH_EMOJI);
});

test('dishEmoji 对超长菜名照常工作', () => {
  assert.equal(dishEmoji('超级无敌豪华双层芝士培根汉堡加大薯条套餐'.repeat(3)), '🍔');
});
```

- [ ] **Step 2: 跑一遍，确认失败**

```bash
node --test test/emoji.test.js
```

预期：`Cannot find module` —— `src/emoji.js` 还不存在。

- [ ] **Step 3: 往 `src/config.js` 末尾追加常数**

```js
/**
 * 拍立得里那个 emoji 的关键字表。**顺序就是优先级** —— 命中第一个就返回，
 * 所以「面」必须排在「鸡」前面，否则「鸡汤面」会出 🍗。改表时别打乱顺序。
 */
export const DISH_EMOJI = [
  [['汉堡', '堡'], '🍔'],
  [['面', '米线', '粉', '粿条'], '🍜'],
  [['饭', '盖浇', '煲仔', '饭团'], '🍚'],
  [['寿司', '刺身', '生鱼'], '🍣'],
  [['披萨', '比萨'], '🍕'],
  [['火锅', '麻辣烫', '香锅', '冒菜'], '🍲'],
  [['烧烤', '烤串', '串'], '🍢'],
  [['包', '饺', '馄饨', '烧麦'], '🥟'],
  [['粥', '汤'], '🥣'],
  [['沙拉', '轻食'], '🥗'],
  [['鸡'], '🍗'],
  [['虾', '蟹'], '🦐'],
  [['奶茶', '咖啡', '果汁'], '🥤'],
];

/** 一个关键字都不中时用它 —— 猜错比不猜更扎眼。 */
export const DEFAULT_DISH_EMOJI = '🍽️';

/** 拍立得下面那行字。语气是问句，跟「划一划换一个」配一对。 */
export const POLAROID_CAPS = {
  breakfast: '早上吃这个？',
  lunch: '中午吃这个？',
  dinner: '今晚吃这个？',
};

/** 跟手滑动翻页的阈值，按卡片宽度的比例算 —— 换个宽屏手感才一样。 */
export const SWIPE_RATIO = 0.32;

/** 轮播位置画成小横杠的上限；超过就退回「7 / 23」文字。见 style.css 的注释。 */
export const CAROUSEL_DOTS_MAX = 8;
```

- [ ] **Step 4: 写 `src/emoji.js`**

```js
import { DISH_EMOJI, DEFAULT_DISH_EMOJI } from './config.js';

/**
 * 按菜名猜一个 emoji。表的顺序就是优先级（见 config.js 里 DISH_EMOJI 的注释）：
 * 命中第一个就返回，全不中退回通用图标。
 *
 * 纯函数：不碰时钟、随机数、DOM、存储。
 */
export function dishEmoji(name) {
  if (typeof name !== 'string' || name === '') return DEFAULT_DISH_EMOJI;
  for (const [keywords, emoji] of DISH_EMOJI) {
    if (keywords.some((k) => name.includes(k))) return emoji;
  }
  return DEFAULT_DISH_EMOJI;
}
```

- [ ] **Step 5: 跑测试，确认全绿**

```bash
node --test
```

预期：原有测试 167 条全过，加上新的 5 条，共 172 条。

- [ ] **Step 6: 提交**

```bash
git add src/config.js src/emoji.js test/emoji.test.js
git commit -m "feat: 按菜名猜 emoji 的纯模块与关键字表"
```

---

### Task 2: 卡片骨架 —— HTML 结构与便签样式

**Files:**
- Modify: `index.html:17-33`（`#card` 那一段）
- Modify: `css/style.css`（改写 `.slot-label` 起到 `.swap` 止的若干规则，末尾新增一段；`.carousel-pos` 改写）

**Interfaces:**
- Consumes: 无
- Produces: DOM 里新出现的 id —— `paper`（拖动层，Task 5 用）、`dish-emoji`、`polaroid-cap`（Task 3 填内容）；类名 `.board` `.note` `.peek` `.tape` `.polaroid` `.stickers` `.swipe-hint`

**做完这一步页面必须仍然能用**：所有旧 id 都在，`ui-today.js` 一行没改也应正常渲染，只是 emoji 固定是 🍽️、拍立得那行字是空的、位置指示还是「2 / 4」文字。

- [ ] **Step 1: 把 `index.html` 的 `#card` 换成新结构**

`#card` 的 class 从 `card` 改成 `board`（`.card` 留给 `#empty` / `#failure`，候选池的 `#failure` 也在用，不能动它的规则）：

```html
  <section id="card" class="board" hidden>
    <div class="peek far"></div>
    <div class="peek"></div>
    <div class="paper" id="paper">
      <div class="note">
        <div class="tape"></div>
        <div class="polaroid">
          <div class="pic" id="dish-emoji">🍽️</div>
          <div class="cap" id="polaroid-cap"></div>
        </div>
        <div class="stickers" aria-hidden="true">
          <span class="sk1">✨</span>
          <span class="sk2">🔥</span>
          <span class="sk3">⭐️</span>
        </div>
        <p id="slot-label" class="slot-label"></p>
        <h1 id="dish-name" class="dish-name"></h1>
        <div class="meta-row">
          <p id="shop-name" class="shop-name"></p>
          <p id="price" class="price"></p>
        </div>
        <p id="reason" class="reason"></p>
        <!-- 必须是真实的 <a>，不能是 <button> + location.href：iOS 的 Universal
             Links 唤不起脚本发起的跳转。href 由 showAt() 逐张卡片写入。 -->
        <a id="order" class="primary">去下单</a>
        <div class="ghost-row">
          <button id="copy-shop" class="ghost" type="button">复制店名</button>
          <button id="mute" class="ghost" type="button">别再推这个</button>
        </div>
        <div class="swap-row">
          <button id="prev" class="swap" type="button"><i>←</i> 上一个</button>
          <span class="swipe-hint">划一划换一个</span>
          <button id="swap" class="swap" type="button">下一个 <i>→</i></button>
        </div>
        <p id="carousel-pos" class="carousel-pos"></p>
      </div>
    </div>
  </section>
```

`#empty` 和 `#failure` 两段一个字不动。

- [ ] **Step 2: 删掉 `css/style.css` 里这些已被取代的规则**

删除 45–69 行那一片（`.slot-label` `.dish-name` `.shop-name` `.price` `.reason` 五行，以及 `.swap-row` 与 `.swap` 连同它们上面那段注释），删除 324–332 行的 `.carousel-pos` 连同注释。`.empty-text` 留着，`#empty` 还在用。

- [ ] **Step 3: 在 `css/style.css` 末尾追加首页卡片的全部样式**

```css
/* ============================================================
   首页便签卡片
   颜色写在这里而不进 config.js：config 装的是参与计算的可调常数，
   颜色是样式。放进去只会多出一条「JS 注入 CSS 变量」的链路。
   三个饭点各一套底板与标签色，深浅各一套，靠 <body data-slot> 切换。
   ============================================================ */
:root {
  --paper: #fffdf7;
  --grid: rgba(150, 130, 180, 0.13);
  --ink: #2b2119;
  --ink-soft: #7a6a58;
  --ink-faint: #9a8b78;
  --paper-line: #e8dcc4;
  --paper-ghost: #fffdf7;
  --peek: #efe7d8;
  --tape: rgba(255, 214, 120, 0.78);
  --frame: #ffffff;
  --board-a: #3b2a52;
  --board-b: #2a1f3d;
  --chip-bg: #e6dcff;
  --chip-fg: #4a2d7a;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #26201b;          /* 深棕木色，不是纯黑 —— 便签纸的质感靠这个 */
    --grid: rgba(180, 160, 210, 0.10);
    --ink: #f2e9df;
    --ink-soft: #a8988a;
    --ink-faint: #8a7b6d;
    --paper-line: #453a30;
    --paper-ghost: #2f2822;
    --peek: #1d1811;
    --tape: rgba(206, 170, 96, 0.55);   /* 压暗，否则夜里胶带在发光 */
    --frame: #e4dbcd;
  }
}

[data-slot="breakfast"] { --board-a: #f6c85f; --board-b: #e8a33d; --chip-bg: #ffe6a8; --chip-fg: #8a5a12; }
[data-slot="lunch"]     { --board-a: #f08a4b; --board-b: #c9552e; --chip-bg: #ffdcc2; --chip-fg: #8a3a12; }
[data-slot="dinner"]    { --board-a: #3b2a52; --board-b: #2a1f3d; --chip-bg: #e6dcff; --chip-fg: #4a2d7a; }

@media (prefers-color-scheme: dark) {
  [data-slot="breakfast"] { --board-a: #3a2a12; --board-b: #1a1408; --chip-bg: #3a2d18; --chip-fg: #ffd9a0; }
  [data-slot="lunch"]     { --board-a: #3a2014; --board-b: #1a0e08; --chip-bg: #3d2418; --chip-fg: #ffc3a0; }
  [data-slot="dinner"]    { --board-a: #241a33; --board-b: #14101d; --chip-bg: #3a2d55; --chip-fg: #d9c8ff; }
}

.board {
  position: relative;
  border-radius: 1.3rem;
  padding: 1.9rem 1rem 1.5rem;
  background: linear-gradient(160deg, var(--board-a), var(--board-b));
}
.board[hidden] { display: none; }

/* 后面还有几张的暗示。纯装饰，不跟着拖动走。 */
.peek {
  position: absolute;
  left: 1.9rem; right: 1.9rem; top: 1.1rem;
  height: 40px;
  border-radius: 0.9rem;
  background: var(--peek);
  opacity: 0.55;
}
.peek.far { left: 2.65rem; right: 2.65rem; top: 0.6rem; opacity: 0.3; }

/* 拖动层。transform 由 JS 写（Task 5），所以这一层不能有 CSS 动画 ——
   两个 transform 写一个元素上会互相顶掉。飘动在里面那层 .note 上。
   touch-action: pan-y 把纵向滚动留给浏览器，横向留给 JS，
   于是手势监听器可以保持 passive，不需要 preventDefault。 */
.paper { position: relative; touch-action: pan-y; }

.note {
  position: relative;
  border-radius: 1rem;
  padding: 1.7rem 1.2rem 1.3rem;
  background: var(--paper);
  color: var(--ink);
  background-image:
    repeating-linear-gradient(0deg, var(--grid) 0 1px, transparent 1px 26px),
    repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px 26px);
  box-shadow: 0 12px 28px rgb(20 10 30 / 0.35);
  transform: rotate(-1.6deg);
}

.tape {
  position: absolute;
  top: -13px; left: 50%;
  width: 104px; height: 28px;
  background: var(--tape);
  transform: translateX(-50%) rotate(-2.5deg);
  border-left: 2px dashed rgb(255 255 255 / 0.55);
  border-right: 2px dashed rgb(255 255 255 / 0.55);
}

.polaroid {
  position: absolute;
  right: -14px; top: -26px;
  width: 86px;
  padding: 7px 7px 19px;
  background: var(--frame);
  border-radius: 3px;
  box-shadow: 0 8px 18px rgb(20 10 30 / 0.45);
  transform: rotate(9deg);
  transform-origin: 50% 0;   /* 钉子在上边中点，Task 4 的摇摆绕它转 */
  z-index: 2;
}
.polaroid .pic {
  height: 76px;
  border-radius: 2px;
  display: grid;
  place-items: center;
  font-size: 2.7rem;
  background: linear-gradient(150deg, #ffe0b8, #ffc9d4);
}
.polaroid .cap {
  margin-top: 5px;
  text-align: center;
  font-size: 0.6rem;
  color: #9a8977;
  font-family: "Yuanti SC", "PingFang SC", sans-serif;
}
@media (prefers-color-scheme: dark) {
  .polaroid .pic { background: linear-gradient(150deg, #e3c4a2, #ddadb8); }
}

.stickers { position: absolute; inset: -10px; pointer-events: none; }
.stickers span { position: absolute; display: block; transform: rotate(var(--r)); }
.sk1 { left: -4px; top: 92px; font-size: 1.3rem; --r: -16deg; }
.sk2 { right: -8px; bottom: 106px; font-size: 1.05rem; --r: 14deg; }
.sk3 { left: 34px; top: -6px; font-size: 0.95rem; --r: 18deg; }

.slot-label {
  display: inline-block;
  margin: 0;
  padding: 0.22rem 0.65rem;
  border-radius: 0.55rem;
  background: var(--chip-bg);
  color: var(--chip-fg);
  font-size: 0.8rem;
  transform: rotate(-1.2deg);
}

/* Yuanti SC 是 iOS/macOS 自带的圆体，Windows/Android 上会退回苹方 ——
   这处差别只有真机看得出来（验收第 27 条）。不打包字体：一个中文子集
   至少几百 KB，违反零依赖也拖慢首屏。
   max-width 是给拍立得让地方，不能去掉，否则长菜名会压到相框底下。 */
.dish-name {
  margin: 0.75rem 0 0.5rem;
  max-width: 76%;
  font-size: 2.05rem;
  line-height: 1.24;
  font-family: "Yuanti SC", "PingFang SC", -apple-system, sans-serif;
}

.meta-row { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
.shop-name { margin: 0; color: var(--ink-soft); font-size: 0.95rem; }
/* 价格没有框也没有圈，只能靠字号撑起分量。 */
.price { margin: 0; font-size: 1.3rem; font-weight: 700; }

.reason {
  display: inline-block;
  margin: 0.95rem 0 0;
  padding: 0.38rem 0.75rem;
  border-radius: 0.6rem;
  background: var(--chip-bg);
  color: var(--chip-fg);
  font-size: 0.9rem;
  transform: rotate(0.9deg);
}

/* .primary / .ghost 的基础规则给候选池共用，这里只在 .board 里改外观。 */
.board .primary {
  margin-top: 1.1rem;
  border-radius: 999px;
  background: linear-gradient(100deg, #ff8a3d, #ff5f9e);
  box-shadow: 0 6px 0 #c23f78;
  transition: transform 0.08s ease, box-shadow 0.08s ease;
}
.board .primary[aria-disabled="true"] {
  background: var(--paper-line);
  color: var(--ink-faint);
  box-shadow: none;
}

.ghost-row { display: flex; gap: 0.6rem; }
.board .ghost {
  flex: 1;
  width: auto;
  border-radius: 999px;
  border: 2px solid var(--paper-line);
  background: var(--paper-ghost);
  color: var(--ink-faint);
}

/* 「上一个 / 下一个」不再是右上角的描边按钮，改成最下面一行的两个角标：
   没有边框和背景，字比正文小一号，中间夹一句「划一划换一个」。
   三样加起来约 210px，卡片内宽 273px（375 屏），留 63px 余量，不会换行。 */
.swap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 1rem;
}
.swap {
  border: none;
  background: none;
  padding: 0.2rem 0;
  color: var(--ink-faint);
  font-size: 0.76rem;
  cursor: pointer;
}
.swap i { font-style: normal; display: inline-block; }
.swipe-hint { color: var(--ink-faint); font-size: 0.74rem; }

/* 轮播位置。候选不多时画小横杠，超过 CAROUSEL_DOTS_MAX 道就退回
   「7 / 23」文字 —— 几十道菜的横杠会排到屏幕外，这是原来不做圆点的理由，
   现在仍然成立。两种形态共用这个容器，JS 决定画哪种。 */
.carousel-pos {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  margin: 0.9rem 0 0;
  color: var(--ink-faint);
  font-size: 0.8rem;
}
.carousel-pos i {
  width: 16px;
  height: 4px;
  border-radius: 3px;
  background: var(--paper-line);
  transition: width 0.25s ease, background 0.25s ease;
}
.carousel-pos i.on { width: 26px; background: var(--accent); transform: rotate(-3deg); }
```

- [ ] **Step 4: 在浏览器里量一遍**

起 `meal-fresh`（端口 8042），**URL 带 `?bust=` 强制重载样式表** —— CSS 会命中缓存，这个坑踩过。视口设 375×812，然后确认：

1. `#card` 可见，纸在底板里，胶带在纸的上边中点，拍立得在右上角；
2. `.swap-row` 三样在同一行（`getBoundingClientRect().height` 与单个按钮同高，没换行）；
3. 纸没有横向溢出：`document.querySelector('.note').scrollWidth <= .board 的 clientWidth`；
4. `#empty` / `#failure` 的外观没被连累 —— 把 `#card` 设 hidden、`#empty` 设 visible 看一眼；
5. 控制台没有报错。

- [ ] **Step 5: 提交**

```bash
git add index.html css/style.css
git commit -m "feat: 首页卡片改成便签纸结构与配色"
```

---

### Task 3: 把数据接到新结构上

**Files:**
- Modify: `src/ui-today.js`（`showAt()` 内部，以及顶部 import）

**Interfaces:**
- Consumes: `dishEmoji()`（Task 1）、`POLAROID_CAPS` `CAROUSEL_DOTS_MAX`（Task 1）、`#dish-emoji` `#polaroid-cap`（Task 2）
- Produces: `<body data-slot>` 属性（Task 2 的 CSS 靠它切配色）

- [ ] **Step 1: 补 import**

`src/ui-today.js` 第 1 行改成：

```js
import { CAROUSEL_DOTS_MAX, POLAROID_CAPS, SLOT_LABELS, SLOTS } from './config.js';
```

并在 `import { setShopLink, copyText } from './deeplink.js';` 下面加一行：

```js
import { dishEmoji } from './emoji.js';
```

- [ ] **Step 2: 加一个画位置指示的小函数**

放在 `showAt` 上面：

```js
/**
 * 画轮播位置。候选不多时画小横杠，多了就退回「7 / 23」文字 ——
 * 几十道菜的横杠会排到屏幕外（见 style.css 里 .carousel-pos 的注释）。
 * 用 createElement 不用 innerHTML：这里没有用户数据，但保持全页一致。
 */
function renderPos(index, total) {
  const box = el('carousel-pos');
  box.textContent = '';
  if (total > CAROUSEL_DOTS_MAX) {
    box.textContent = `${index + 1} / ${total}`;
    return;
  }
  for (let i = 0; i < total; i += 1) {
    const bar = document.createElement('i');
    if (i === index) bar.className = 'on';
    box.appendChild(bar);
  }
}
```

- [ ] **Step 3: 改 `showAt()`**

把原来这两行：

```js
  el('price').textContent = `约 ¥${row.dish.refPrice}`;
  el('reason').textContent = row.reason;
  el('carousel-pos').textContent = `${index + 1} / ${state.ranked.length}`;
```

改成：

```js
  el('price').textContent = `约 ¥${row.dish.refPrice}`;
  el('reason').textContent = row.reason;
  // 拍立得：emoji 按菜名猜，猜不着退回 🍽️；下面那行字跟着饭点走。
  el('dish-emoji').textContent = dishEmoji(row.dish.name);
  el('polaroid-cap').textContent = POLAROID_CAPS[state.slot] ?? '';
  // 配色靠这个属性切换（css/style.css 的 [data-slot=...]）。从后台切回来
  // 跨了饭点时 refreshIfStale 会重画，属性跟着更新。
  document.body.dataset.slot = state.slot;
  renderPos(index, state.ranked.length);
```

- [ ] **Step 4: 浏览器里验**

带 `?bust=` 重载，依次确认：

1. 拍立得里的 emoji 跟菜名对得上，下面写着「今晚吃这个？」之类；
2. `document.body.dataset.slot` 是当前饭点，底板颜色是对应那套；
3. 分别用 `?slot=breakfast` `?slot=lunch` `?slot=dinner` 打开，三套颜色和三句话都跟着变；
4. 候选数 ≤ 8 时 `#carousel-pos` 里是若干 `<i>`，当前那根带 `on`；把 `CAROUSEL_DOTS_MAX` 临时改成 1 重载，确认退回「1 / N」文字，**验完改回 8**；
5. 点「下一个」，emoji、横杠跟着走。

- [ ] **Step 5: 跑测试并提交**

```bash
node --test
git add src/ui-today.js
git commit -m "feat: 卡片接上 emoji、饭点配色与横杠位置指示"
```

---

### Task 4: 动效与「减弱动态效果」

**Files:**
- Modify: `css/style.css`（首页那一段内追加 keyframes 与动画声明；`prefers-reduced-motion` 段扩充）
- Modify: `src/ui-today.js`（`showAt()` 末尾重放贴纸动画）

**Interfaces:**
- Consumes: Task 2 的类名
- Produces: 无新接口

- [ ] **Step 1: 往 `css/style.css` 的首页段落追加动画**

```css
/* ---- 动效 ----
   飘动挂在 .note 上，不能挂到 .paper：那一层的 transform 归 JS（Task 5）。 */
.note { animation: note-float 5s ease-in-out infinite; }
@keyframes note-float {
  0%, 100% { transform: rotate(-1.6deg) translateY(0); }
  50%      { transform: rotate(-0.5deg) translateY(-5px); }
}
/* 手指按住时停住，跟手才不会边跟边飘。 */
.paper.held .note { animation-play-state: paused; }
/* 按「去下单」时纸的投影收紧，配合按钮下沉 —— 像真被按住了。 */
.paper.pressed .note { box-shadow: 0 4px 10px rgb(20 10 30 / 0.4); }

.polaroid { animation: polaroid-sway 4.2s ease-in-out infinite; }
@keyframes polaroid-sway {
  0%, 100% { transform: rotate(7deg); }
  50%      { transform: rotate(11.5deg); }
}

.sk1 { animation: sticker-twinkle 2.4s ease-in-out infinite; }
@keyframes sticker-twinkle {
  0%, 100% { opacity: 0.35; transform: rotate(var(--r)) scale(0.85); }
  50%      { opacity: 1;    transform: rotate(var(--r)) scale(1.12); }
}
.sk2 { animation: sticker-shiver 1.8s ease-in-out infinite; }
@keyframes sticker-shiver {
  0%, 100% { transform: rotate(var(--r)); }
  25%      { transform: rotate(calc(var(--r) - 7deg)); }
  75%      { transform: rotate(calc(var(--r) + 7deg)); }
}

/* 换卡时三张贴纸重新弹进来，靠 JS 加 .in 触发（showAt 末尾）。 */
.stickers span.in { animation: sticker-pop 0.42s cubic-bezier(0.2, 1.5, 0.5, 1) backwards; }
.sk1.in { animation-delay: 0.06s; }
.sk2.in { animation-delay: 0.14s; }
.sk3.in { animation-delay: 0.22s; }
@keyframes sticker-pop {
  0%   { transform: scale(0) rotate(0deg); }
  65%  { transform: scale(1.25) rotate(var(--r)); }
  100% { transform: scale(1) rotate(var(--r)); }
}

/* 两个箭头各自朝自己那边推，错开半个周期，别同步。 */
#prev i { animation: nudge-left 1.5s ease-in-out infinite; }
#swap i { animation: nudge-right 1.5s ease-in-out infinite 0.75s; }
@keyframes nudge-left  { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-3px); } }
@keyframes nudge-right { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(3px); } }

.board .primary:active { transform: translateY(5px); box-shadow: 0 1px 0 #c23f78; }
```

- [ ] **Step 2: 扩充 `prefers-reduced-motion` 段**

现有那段（`.toast` / `.shop-block`）里追加：

```css
  /* 装饰性动画全停。跟手拖动不在此列 —— 关掉手势等于关掉一个功能，
     那不是「减少动效」的意思。按钮按下的位移是操作反馈，也留着。 */
  .note, .polaroid, .sk1, .sk2, .stickers span.in, #prev i, #swap i {
    animation: none !important;
  }
  .note { transform: rotate(-1.6deg); }
  .polaroid { transform: rotate(9deg); }
```

- [ ] **Step 3: `showAt()` 末尾重放贴纸弹入**

在 `el('card').hidden = false;` 后面加：

```js
  // 换一道菜就让三张贴纸重新弹进来。先摘掉再强制回流再挂上，否则
  // 同名 class 不会重新触发动画。
  for (const sticker of document.querySelectorAll('.stickers span')) {
    sticker.classList.remove('in');
    void sticker.offsetWidth;
    sticker.classList.add('in');
  }
```

- [ ] **Step 4: 浏览器里验**

浏览器面板被隐藏时帧是冻结的（`requestAnimationFrame` 不回调、CSS 过渡不推进），**量不到透明度和位移**。所以这一步用 `getAnimations()` 查状态，不靠截图：

```js
document.querySelectorAll('.note, .polaroid, .sk1, .sk2, #prev i, #swap i')
  .forEach((e) => console.log(e.className, e.getAnimations().map((a) => a.playState + ':' + a.animationName)));
```

预期：六个元素各有一条 `running` 的动画。再点「下一个」，确认三张贴纸各多出一条 `sticker-pop`。

然后用 `resize_window` 的 `colorScheme` 或系统设置切深色，确认纸变深棕、胶带和相框压暗。

**减弱动态效果这一项桌面验不全**（Chrome 的 emulation 不一定覆盖 iOS 的行为），如实记进验收第 31 条，留给真机。

- [ ] **Step 5: 提交**

```bash
git add css/style.css src/ui-today.js
git commit -m "feat: 便签卡片的动效与减弱动态效果下的降级"
```

---

### Task 5: 跟手滑动

**Files:**
- Modify: `src/ui-today.js:294-326`（`#swap` / `#prev` 的监听器与整段 touch 手势）
- Modify: `src/ui-today.js:348`（`#mute` 里的 `step(1)`）

**Interfaces:**
- Consumes: `SWIPE_RATIO`（Task 1）、`#paper` 与 `.paper.held`（Task 2、4）
- Produces: `animateStep(delta)`，取代原先直接调 `step()` 的三处

- [ ] **Step 1: 补 import**

把 `SWIPE_RATIO` 加进 `config.js` 那条 import。

- [ ] **Step 2: 在 `step()` 下面加翻页动画**

```js
const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * 翻一道并放动画：当前卡片往手指的方向飞出去，换内容，新的从反方向弹进来。
 * 「减弱动态效果」开着时直接换，不放动画。
 *
 * 动画只碰 .paper 的 transform，不碰 .note —— 飘动在那一层。
 */
function animateStep(delta) {
  if (state.ranked.length === 0) return;
  const paper = el('paper');
  if (prefersReducedMotion() || !paper.animate) {
    step(delta);
    return;
  }
  const out = paper.animate(
    [
      { transform: paper.style.transform || 'translateX(0)', opacity: 1 },
      { transform: `translateX(${delta > 0 ? -130 : 130}%) rotate(${delta > 0 ? -10 : 10}deg)`, opacity: 0 },
    ],
    { duration: 200, easing: 'ease-in' },
  );
  out.onfinish = () => {
    step(delta);
    // 必须清掉，否则下一张卡片会带着上一张的位移出场。
    paper.style.transform = '';
    paper.animate(
      [
        { transform: `translateX(${delta > 0 ? 120 : -120}%) rotate(${delta > 0 ? 8 : -8}deg)`, opacity: 0 },
        { transform: 'translateX(0) rotate(0deg)', opacity: 1 },
      ],
      { duration: 380, easing: 'cubic-bezier(0.2, 1.2, 0.4, 1)' },
    );
  };
}
```

- [ ] **Step 3: 三处调用改成 `animateStep`**

```js
el('swap').addEventListener('click', () => { animateStep(1); });
el('prev').addEventListener('click', () => { animateStep(-1); });
```

以及 `#mute` 监听器末尾那句 `step(1);` → `animateStep(1);`（注释保持原样）。

- [ ] **Step 4: 整段 touch 手势换成 Pointer Events**

删掉 `SWIPE_MIN_X` 与两个 `touchstart` / `touchend` 监听器，换成：

```js
// 左右拖动翻菜，卡片跟着手指走。
//
// 轴向锁定是保住验收第 17 条（滑动不与纵向滚动打架）的关键：位移在任一方向
// 都不到 AXIS_LOCK_PX 时什么都不做 —— 手指刚落下的抖动不该决定方向；第一次
// 超过它时比较 |dx| 与 |dy| 定下轴向，之后不再改。
//
// .paper 上的 touch-action: pan-y 把纵向滚动留给浏览器，所以这里不需要
// preventDefault，监听器可以保持 passive，不会让滚动一卡一卡。
const AXIS_LOCK_PX = 6;
const paper = el('paper');
let drag = null;   // { x, y, dx, axis } —— 没在拖时是 null

paper.addEventListener('pointerdown', (e) => {
  // 在按钮或链接上起手不算拖卡片：否则在「去下单」上手指稍微一滑，
  // 链接就点不动了。
  if (e.target.closest('a, button')) return;
  drag = { x: e.clientX, y: e.clientY, dx: 0, axis: null };
  // 合成事件或奇怪的 pointerId 会抛，吞掉即可 —— 捕获不到只是拖到边缘
  // 可能丢事件，不影响主路径。
  try { paper.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  paper.classList.add('held');
});

paper.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (drag.axis === null) {
    if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
    drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (drag.axis === 'y') { endDrag(e, true); return; }   // 让页面去滚
  }
  drag.dx = dx;
  // 0.88 次幂：小位移几乎一比一跟手，拖得越远越沉。同时按位移的 1/26
  // 轻微旋转 —— 纸被推着走会偏一点，正着平移反而假。
  const damped = Math.sign(dx) * Math.abs(dx) ** 0.88;
  paper.style.transform = `translateX(${damped}px) rotate(${damped / 26}deg)`;
}, { passive: true });

function endDrag(e, cancel) {
  if (!drag) return;
  const { dx } = drag;
  drag = null;
  paper.classList.remove('held');
  try { paper.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }

  // 阈值按卡片宽度算，不用固定像素 —— 换个更宽的屏手感才一样。
  if (!cancel && Math.abs(dx) > paper.offsetWidth * SWIPE_RATIO) {
    animateStep(dx < 0 ? 1 : -1);   // 左拖看下一道，右拖退回上一道
    return;
  }
  // 不够就弹回原位，带一点过冲。
  if (!paper.animate) { paper.style.transform = ''; return; }
  const back = paper.animate(
    [{ transform: paper.style.transform || 'translateX(0)' }, { transform: 'translateX(0) rotate(0deg)' }],
    { duration: 300, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)' },
  );
  back.onfinish = () => { paper.style.transform = ''; };
}

paper.addEventListener('pointerup', (e) => endDrag(e, false), { passive: true });
paper.addEventListener('pointercancel', (e) => endDrag(e, true), { passive: true });

// 按住「去下单」时整张纸的投影收紧（.pressed），松手复位。
el('order').addEventListener('pointerdown', () => { paper.classList.add('pressed'); });
window.addEventListener('pointerup', () => { paper.classList.remove('pressed'); });
```

- [ ] **Step 5: 浏览器里验跟手**

桌面鼠标就能拖（Pointer Events 一套管两边）。在控制台里合成事件量一遍：

```js
const p = document.getElementById('paper');
const fire = (t, x, y) => p.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
const r = p.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
fire('pointerdown', cx, cy); fire('pointermove', cx - 20, cy); fire('pointermove', cx - 60, cy);
console.log('跟手位移', p.style.transform, '应有 held:', p.className);
fire('pointerup', cx - 60, cy);
```

要看到的：

1. 拖 60px 时 `transform` 约 `translateX(-36.7px) rotate(-1.41deg)`，`.paper` 带 `held`；
2. 这次松手**不换菜**（60px < 273 × 0.32 ≈ 87px），`transform` 最终清空；
3. 再拖 170px 松手，菜名变成下一道、横杠往后走一格；
4. 纵向合成一次（`pointermove` 只动 y），`transform` 保持空 —— 轴向锁定生效；
5. 在 `#order` 上 `pointerdown` 起手拖，卡片不动、`href` 还在。

- [ ] **Step 6: 跑测试并提交**

```bash
node --test
git add src/ui-today.js
git commit -m "feat: 左右滑动时卡片跟随手指，松手翻页或弹回"
```

---

### Task 6: 文档

**Files:**
- Modify: `CLAUDE.md`（纯模块清单那一段）
- Modify: `docs/acceptance-checklist.md`

**Interfaces:** 无

- [ ] **Step 1: `CLAUDE.md` 纯模块清单加 `emoji.js`**

把

```
src/config.js  src/dates.js  src/observations.js  src/recommender.js  src/snapshot.js
```

改成

```
src/config.js  src/dates.js  src/emoji.js  src/observations.js  src/recommender.js  src/snapshot.js
```

同一段落的「开发」小节里，把测试数量的说法（如果有）与验收清单的日期一并更新。

- [ ] **Step 2: `docs/acceptance-checklist.md` 加第 27–31 条**

按现有条目的写法追加（每条写清「怎么做、看到什么算过」），内容取自 spec §11：

27. 便签卡片在 375px 下不破版（长名字测试店；顺便看 `Yuanti SC` 在 iPhone 上是不是圆体）
28. 三个饭点各一套配色（`?slot=` 逐个开）
29. 跟手（含纵向滚动不被劫持 —— 与第 17 条一起重验）
30. 深色模式
31. 减弱动态效果下跟手仍可用

同时把第 15 条「手机宽度布局」标成待重验（第六次），第 17 条标成待重验。
文件顶部的计数改成 24 / 31。

- [ ] **Step 3: 提交**

```bash
git add CLAUDE.md docs/acceptance-checklist.md
git commit -m "docs: 纯模块清单加 emoji.js，验收清单加第 27-31 条"
```

---

## 自查

**Spec 覆盖**：§2 不动的东西 → Global Constraints + Task 2 Step 1；§3 结构 → Task 2；§3.1 横杠上限 → Task 1（常数）+ Task 3（`renderPos`）；§3.2 emoji → Task 1 + Task 3；§4 配色 → Task 2 Step 3 + Task 3 Step 3（`data-slot`）；§5 字体 → Task 2；§6 动效 → Task 4；§7 跟手 → Task 5；§8 文案 → Task 1（`POLAROID_CAPS`）+ Task 2（HTML 里的「划一划换一个」与箭头）；§9 文件表 → 文件结构；§10 取舍 → 无需实现；§11 验收 → Task 6。

**没有占位符**：每个代码步骤都是可以照抄的完整代码。

**命名一致**：`dishEmoji` / `DISH_EMOJI` / `DEFAULT_DISH_EMOJI` / `POLAROID_CAPS` / `SWIPE_RATIO` / `CAROUSEL_DOTS_MAX` / `animateStep` / `renderPos` / `endDrag` 在定义处与使用处拼写一致。类名 `.note` 是新起的 —— **不能叫 `.sheet`，那个名字已经被反馈浮层占用了**。
