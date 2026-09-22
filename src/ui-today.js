import { CAROUSEL_DOTS_MAX, POLAROID_CAPS, SLOT_LABELS, SLOTS, SWIPE_RATIO } from './config.js';
import { slotFromTime, localDateKey } from './dates.js';
import { currentPick, feedbackCandidate, pendingFeedback, reduceObservations } from './observations.js';
import { rankCandidates } from './recommender.js';
import { loadAll, appendEvent, setHygiene } from './store.js';
import { setShopLink, copyText } from './deeplink.js';
import { dishEmoji } from './emoji.js';

const el = (id) => document.getElementById(id);

/** slot 优先取 URL 参数（快捷指令会带上），缺失或非法时按当前时间推断。 */
function resolveSlot(now) {
  const fromUrl = new URLSearchParams(location.search).get('slot');
  return SLOTS.includes(fromUrl) ? fromUrl : slotFromTime(now);
}

/** 本地存储读不出来时兜底展示的失败态 —— 用户手机上没有控制台可看。 */
function showFailure(err) {
  console.error('渲染「今天这顿」失败', err);
  el('card').hidden = true;
  el('empty').hidden = true;
  el('failure-text').textContent = '本地存储读取失败，请稍后重试。';
  el('failure').hidden = false;
}

// ranked 是这一顿的完整候选列表，页面加载时算定，浏览期间不重算 ——
// 否则划着划着顺序会变。index 是当前停在第几道。
let state = { slot: null, dateKey: null, dish: null, shop: null, ranked: [], index: 0, shops: [], recordedDishId: null };

const RATING_LABELS = { good: '好吃', ok: '还行', bad: '不了', skipped: '没吃成' };

/**
 * 渲染补问上一顿的浮层。已评过、就是当前这顿、或下单还没满推迟时长的，都不问——
 * 挑哪一顿在 feedbackCandidate 里，到没到期在 pendingFeedback 里；
 * 这里只负责渲染 pendingFeedback 返回的结果。
 *
 * 本地存储读取失败时不该拦住主卡片渲染：吞掉错误、跳过浮层即可。
 */
async function renderFeedback(now = Date.now(), data = null) {
  try {
    const slot = resolveSlot(now);
    const { shops, dishes, events } = data ?? await loadAll();

    // 传进去的是此刻还在候选池的菜：已删的菜那顿问不出口，交给它顺延到上一顿，
    // 否则那顿会一直占着候选位，别的顿也问不到（TODO 第 7 条）。
    const live = new Set(dishes.map((d) => d.id));
    const target = pendingFeedback(reduceObservations(events), now, slot, live);
    if (!target) return;

    const dish = dishes.find((d) => d.id === target.dishId);
    if (!dish) return; // 兜底：正常情况下 live 已经把这种挑掉了
    const shop = shops.find((s) => s.id === dish.shopId);

    const overlay = el('feedback');
    overlay.innerHTML = `
      <div class="sheet">
        <p class="fb-question"></p>
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
          <input type="number" step="0.01" inputmode="decimal" placeholder="实付价（元）">
          <button type="button" data-action="save-price">保存</button>
        </div>
        <p class="fb-price-msg" hidden></p>
      </div>
    `;
    // dish.name 来自用户在候选池里填写的数据（Task 15），不能当作可信 HTML 拼进
    // innerHTML —— 走 textContent 天然转义，不需要额外的转义辅助函数。
    overlay.querySelector('.fb-question').textContent = `上顿的${dish.name}怎么样？`;
    overlay.hidden = false;

    const close = () => { overlay.hidden = true; overlay.innerHTML = ''; };

    // 用 onclick 赋值而不是 addEventListener：回到前台时 renderFeedback 可能再跑一遍，
    // 叠加的监听器会让一次点击写两条 rated，旧的那条还指向上一次问的那一顿。
    overlay.onclick = async (e) => {
      const button = e.target.closest('button');
      if (!button) return;

      try {
        if (button.dataset.rate) {
          // targetTs 回指被问的那一顿。写入时 render() 已经把今天这顿的
          // recommended 事件追加进去了，若今天推的恰好是同一道菜，没有这个
          // 回指，这条评分会落到今天那一组上。
          await appendEvent({
            slot: target.slot, dishId: target.dishId, targetTs: target.ts,
            type: 'rated', value: button.dataset.rate,
          });
          close();
          await render();
          return;
        }

        if (button.dataset.action === 'sick') {
          await appendEvent({
            slot: target.slot, dishId: target.dishId, targetTs: target.ts, type: 'sick',
          });
          await appendEvent({
            slot: target.slot, dishId: target.dishId, targetTs: target.ts,
            type: 'rated', value: 'bad',
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
          const msg = overlay.querySelector('.fb-price-msg');
          const amount = Number(overlay.querySelector('.fb-price-box input').value);
          // 非法输入以前是静默吞掉、输入框照样收起来 —— 看起来跟保存成功
          // 一模一样。这是全应用最容易让人以为「存上了」而其实没存的地方。
          if (!Number.isFinite(amount) || amount <= 0) {
            msg.textContent = '请输入大于 0 的金额。';
            msg.hidden = false;
            return;
          }
          await appendEvent({
            slot: target.slot, dishId: target.dishId, targetTs: target.ts,
            type: 'paid', value: amount,
          });
          overlay.querySelector('.fb-price-box').hidden = true;
          // 写成功才说成功：appendEvent 抛异常会被下面的 catch 接走并关掉浮层。
          msg.textContent = `已记下实付 ¥${amount}`;
          msg.hidden = false;
        }
      } catch (err) {
        // 反馈写入失败不该把浮层卡死在打开状态——记录并关闭，用户下次还有机会。
        console.error('记录反馈失败', err);
        close();
      }
    };
  } catch (err) {
    // 读取本地存储失败时跳过浮层即可，不能连累主卡片渲染。
    console.error('渲染反馈浮层失败', err);
  }
}

/**
 * 画轮播位置。候选不多时画小横杠，多了就退回「7 / 23」文字 ——
 * 几十道菜的横杠会排到屏幕外（见 style.css 里 .carousel-pos 的注释）。
 * 用 createElement 不用 innerHTML：这里没有用户数据，但保持全页一致。
 */
function renderPos(box, index, total) {
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

/** 轮播里第 i 道之后（delta 为负就是之前）第 |delta| 道的下标，首尾相接。 */
function wrapIndex(i, delta) {
  const n = state.ranked.length;
  return (((i + delta) % n) + n) % n;
}

/**
 * 把第 i 道菜的内容写进一张便签。上面那张（有 id 的）和垫在底下那张
 * （复制出来、摘掉了 id）共用这一个函数，所以按 class 找元素，不按 id ——
 * 两张卡片长得必须一模一样，翻页时底下那张才能无缝顶上来。
 * 全部走 textContent：菜名和店名是用户数据。
 */
function paintNote(note, i) {
  const row = state.ranked[i];
  const shop = state.shops.find((s) => s.id === row.dish.shopId);
  const q = (sel) => note.querySelector(sel);
  q('.slot-label').textContent = SLOT_LABELS[state.slot];
  q('.dish-name').textContent = row.dish.name;
  q('.shop-name').textContent = shop.name;
  q('.price').textContent = `约 ¥${row.dish.refPrice}`;
  q('.reason').textContent = row.reason;
  // 拍立得：emoji 按菜名猜，猜不着退回 🍽️；下面那行字跟着饭点走。
  q('.pic').textContent = dishEmoji(row.dish.name);
  q('.cap').textContent = POLAROID_CAPS[state.slot] ?? '';
  renderPos(q('.carousel-pos'), i, state.ranked.length);
}

// ---- 垫在底下的那张卡片 ----
//
// 不是装饰：里面就是真的下一道（往右拖时换成上一道）。平时它比上面那张小一圈、
// 往上错开一点，从上沿露出一条边；拖动时跟着拖的距离慢慢浮上来，到翻页阈值时
// 刚好和上面那张重合。翻页时上面那张飞走，底下这张已经在原位了。
//
// 它是从上面那张复制出来的：结构一致才能无缝替换。复制后摘掉所有 id（否则
// el() 会找错元素）、摘掉「去下单」的 href，整个容器 inert —— 只给看，
// 点不到、读屏软件也跳过。
const under = el('under');
const underNote = el('paper').querySelector('.note').cloneNode(true);
for (const node of underNote.querySelectorAll('[id]')) node.removeAttribute('id');
underNote.querySelector('a')?.removeAttribute('href');
under.appendChild(underNote);
let underDir = 0;   // 底下现在画的是哪个方向的邻居：1 下一道，-1 上一道

/** 底下那张换成 dir 方向的邻居。只有一道菜时没有邻居，整张藏起来。 */
function paintUnder(dir) {
  if (state.ranked.length < 2) {
    under.hidden = true;
    underDir = 0;
    return;
  }
  under.hidden = false;
  paintNote(underNote, wrapIndex(state.index, dir));
  underDir = dir;
}

/**
 * 底下那张浮上来的程度，0 是平时（缩小、错开），1 是和上面那张重合。
 * 具体的缩放和位移在 CSS 里按 --p 算，这里只写一个数。
 * smooth 为真时带过渡（松手之后），拖动过程中必须不带 —— 要跟手。
 */
function setUnderProgress(p, smooth = false) {
  under.classList.toggle('moving', smooth);
  under.style.setProperty('--p', String(p));
}

/** 把轮播的第 i 项画到卡片上。不写任何事件 —— 浏览是免费的。 */
function showAt(index) {
  const row = state.ranked[index];
  const shop = state.shops.find((s) => s.id === row.dish.shopId);
  state = { ...state, index, dish: row.dish, shop };

  paintNote(el('paper').querySelector('.note'), index);
  // 每翻一张都要重挂 —— 换了菜就换了店，href 不跟着走就会跳到上一家。
  setShopLink(el('order'), shop.link);
  el('failure').hidden = true;
  el('empty').hidden = true;
  el('card').hidden = false;
  // 底下那张平时垫的是下一道。
  setUnderProgress(0);
  paintUnder(1);
  // 换一道菜就让三张贴纸重新弹进来。先摘掉再强制回流再挂上，否则
  // 同名 class 不会重新触发动画。只动上面那张的贴纸，底下那张不动。
  for (const sticker of el('paper').querySelectorAll('.stickers span')) {
    sticker.classList.remove('in');
    void sticker.offsetWidth;
    sticker.classList.add('in');
  }
}

/** 前后翻一道，首尾相接。 */
function step(delta) {
  if (state.ranked.length === 0) return;
  showAt(wrapIndex(state.index, delta));
}

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * 翻一道并放动画：上面那张往手指的方向飞出去，底下那张同时浮到原位；
 * 飞完换内容，上面那张回到原位，此时它和底下那张画的是同一道菜，看不出替换。
 * 「减弱动态效果」开着时直接换，不放动画。
 *
 * 动画只碰 .paper 的 transform，不碰 .note —— 飘动在那一层。
 */
function animateStep(delta) {
  if (state.ranked.length === 0) return;
  const paper = el('paper');
  if (prefersReducedMotion() || !paper.animate) {
    paper.style.transform = '';
    step(delta);
    return;
  }
  if (underDir !== delta) paintUnder(delta);
  setUnderProgress(1, true);
  const from = paper.style.transform || 'translateX(0)';
  paper.style.transform = '';
  // fill: forwards 让它飞完之后停在屏幕外，等 onfinish 里换好内容再 cancel 回原位 ——
  // 否则飞完的那一帧会先闪回旧内容。
  const out = paper.animate(
    [
      { transform: from, opacity: 1 },
      { transform: `translateX(${delta > 0 ? -130 : 130}%) rotate(${delta > 0 ? -10 : 10}deg)`, opacity: 0 },
    ],
    { duration: 220, easing: 'ease-in', fill: 'forwards' },
  );
  out.onfinish = () => {
    step(delta);   // showAt 里会把底下那张复位、重画成新的下一道
    out.cancel();
  };
}

async function render(now = Date.now(), data = null) {
  try {
    const slot = resolveSlot(now);
    // 整页底色跟着饭点走（css/style.css 的 body[data-slot]）。在这里写而不在
    // showAt 里写：「没菜可推」那张卡片也铺在同一个颜色上，切来切去底色不跳。
    // 从后台切回来跨了饭点时 refreshIfStale 会重画，属性跟着更新。
    document.body.dataset.slot = slot;
    const { shops, dishes, events } = data ?? await loadAll();
    const nowKey = localDateKey(now);

    const pick = currentPick(events, slot, nowKey);

    // 用 feedbackCandidate 而不是 pendingFeedback：推迟期间浮层不弹，
    // 但刚下单还没评分的那道菜同样不该排在开场位（spec 2026-09-13 §4.4）。
    // 两者挑的是同一顿 —— 同样排除当前这顿、同样只看晚于最近已评分的 ——
    // 区别只在 feedbackCandidate 不看推迟时长到没到。
    // live 同 renderFeedback：两处必须挑出同一顿，否则守卫会去躲一道
    // 根本不会被问到的菜。
    const live = new Set(dishes.map((d) => d.id));
    const asking = feedbackCandidate(reduceObservations(events), now, slot, live);
    const ranked = rankCandidates({ dishes, shops, events, slot, now });

    if (ranked.length === 0) {
      el('failure').hidden = true;
      el('card').hidden = true;
      el('empty').hidden = false;
      return;
    }

    // 这一顿定过没有？定过就回到那道菜上 —— 刷新与下单往返都不该改变所见。
    // findIndex 返回 -1 有两种可能：没定过，或者定下的那道菜已经被从候选池里
    // 删掉了。后者按「没定过」处理并重新写一条 —— 否则事件日志里会一直挂着
    // 一条指向已删除菜的推荐记录，而屏幕上显示的却是另一道。
    const decided = pick.activeDishId
      ? ranked.findIndex((r) => r.dish.id === pick.activeDishId)
      : -1;

    let index = 0;
    if (decided >= 0) {
      index = decided;
      // 显示当初记下的那条理由，而不是此刻重算的那句。这一顿已经有了
      // recommended 事件，重算时「有没有历史观察值」的判据就变了，
      // 理由会换成另一句 —— 用户会以为页面自己改了主意。
      // 旧事件没存理由（activeReason 为 null）时才退回重算的那句。
      if (pick.activeReason) ranked[index].reason = pick.activeReason;
    } else {
      // 正在补问的那道菜不排在初始位置：不能一边问「上顿的黄焖鸡怎么样」
      // 一边又端上同一道黄焖鸡。但它仍留在轮播里，用户划得到。
      if (asking && ranked.length > 1 && ranked[0].dish.id === asking.dishId) {
        index = 1;
      }
      await appendEvent({
        slot, dateKey: nowKey, dishId: ranked[index].dish.id,
        type: 'recommended', value: ranked[index].reason,
      });
    }

    // shops 存进 state：翻页时 showAt 还要用它查店名，而 step() 是从
    // 按钮和手势里调的，拿不到 render() 的局部变量。
    // recordedDishId 记的是这一顿已经写进事件流的那道菜 ——「去下单」
    // 靠它判断要不要补写，省掉一次多余的 loadAll()。
    // dateKey 与 slot 一起定格在渲染这一刻：之后在这张卡片上下单，
    // 哪怕已经过了零点，事件也属于这一顿。
    state = {
      slot, dateKey: nowKey, dish: null, shop: null, ranked, index, shops,
      recordedDishId: ranked[index].dish.id,
    };
    showAt(index);
  } catch (err) {
    showFailure(err);
  }
}

/**
 * 记下「去下单」这一次点击。跟页面跳转并行跑，所以自己吞掉全部错误 ——
 * 抛出去也没人接得住，页面下一刻就走了。
 *
 * 入参是点击那一刻的 state 快照，不读模块变量：这个函数在导航期间才跑完，
 * 期间用户可能已经划到别的菜上了。
 */
async function recordOrder({ slot, dateKey, dish, ranked, index, recordedDishId }) {
  // 用户可能浏览到了别的菜上。这一顿的观察值应当落在他真正下单的那道，
  // 所以先补一条 recommended —— 归约那边只认最后一条。
  // 用 recordedDishId 判断，不必再读一次库。
  if (recordedDishId !== dish.id) {
    try {
      await appendEvent({
        slot, dateKey, dishId: dish.id, type: 'recommended', value: ranked[index].reason,
      });
      // 只有当用户还停在这道菜上时才更新 —— 否则会把划走之后的状态写脏。
      if (state.dish?.id === dish.id) state = { ...state, recordedDishId: dish.id };
    } catch (err) {
      // 补写失败就不改 recordedDishId，下次点还会再试一遍。
      console.error('补写 recommended 事件失败', err);
    }
  }
  try {
    await appendEvent({ slot, dateKey, dishId: dish.id, type: 'clicked' });
  } catch (err) {
    // 记录失败不该拦住下单 —— 日志是记账，不是门槛。
    console.error('记录「去下单」事件失败', err);
  }
}

// 不 preventDefault，也不 await：跳转交给 <a href> 的默认行为完成，那是
// 唤起外卖 App 的前提（见 deeplink.js）。代价是这两条写入跟导航赛跑。
//
// 赛输了会怎样，两条都不致命：
//   `clicked` 丢了只是少一条 0.65 的隐式信号，第二天照样会补问这一顿 ——
//   补问认的是 recommended 那条，它在渲染时就写好了，不参与这场赛跑。
//   补写的 recommended 丢了更明显：切回来时卡片退回原来那道菜，看得见，
//   再点一次就补上了。
//
// 之所以敢赛：openDB 的 promise 是缓存的（store.js），页面渲染时就已经打开，
// 所以 appendEvent 里那个 await 只跨一个微任务，事务在导航发出前就排进去了。
el('order').addEventListener('click', () => {
  // 没有 href 说明链接不合法，点了也不会跳 —— 不该记一条「下单」。
  if (!state.dish || !el('order').href) return;
  recordOrder(state);
});

el('swap').addEventListener('click', () => {
  animateStep(1);
});

// 手势能右划往回，按钮侧也得有 —— 桌面上没有手势，滑动不灵时也要绕一整圈。
// 和翻页一样不写任何事件：浏览是免费的。
el('prev').addEventListener('click', () => {
  animateStep(-1);
});

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
  // 底下那张：往左拖露出下一道，往右拖露出上一道，方向一变就重画。
  // 拖到翻页阈值时刚好浮到原位 —— 松手翻过去就是它。
  if (dx !== 0) {
    const dir = dx < 0 ? 1 : -1;
    if (dir !== underDir && underDir !== 0) paintUnder(dir);
    setUnderProgress(Math.min(Math.abs(dx) / (paper.offsetWidth * SWIPE_RATIO), 1));
  }
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
  if (!paper.style.transform) return;   // 根本没动过（比如纵向滑）
  setUnderProgress(0, true);   // 底下那张跟着沉回去
  const from = paper.style.transform;
  // 先清掉内联位移再放动画：动画播放期间盖在上面，播完自然落回原位。
  // 不在 onfinish 里清 —— 那 0.3 秒里手指可能又按下开始新一次拖动，
  // 到时 onfinish 会把新拖出来的位移抹掉。
  paper.style.transform = '';
  paper.animate?.(
    [{ transform: from }, { transform: 'translateX(0) rotate(0deg)' }],
    { duration: 300, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)' },
  );
}

paper.addEventListener('pointerup', (e) => endDrag(e, false), { passive: true });
paper.addEventListener('pointercancel', (e) => endDrag(e, true), { passive: true });

// 按住「去下单」时整张纸的投影收紧（.pressed），松手复位。
el('order').addEventListener('pointerdown', () => { paper.classList.add('pressed'); });
window.addEventListener('pointerup', () => { paper.classList.remove('pressed'); });
window.addEventListener('pointercancel', () => { paper.classList.remove('pressed'); });

el('mute').addEventListener('click', async () => {
  const dish = state.dish;
  if (!dish) return;
  try {
    await appendEvent({ slot: state.slot, dishId: dish.id, type: 'muted' });
  } catch (err) {
    // 这个按钮的全部意义就是让它持久生效，所以写失败必须让用户看见 ——
    // 手机上没有控制台可看。也不要翻页：卡片一动，用户就会以为记下了。
    console.error('记录「别再推这个」事件失败', err);
    const original = el('reason').textContent;
    el('reason').textContent = '没记上，请稍后再试';
    // 这 2 秒里用户可以翻页。恢复前确认还停在同一张卡片上，
    // 否则会把旧卡片的理由写到新卡片上去。
    setTimeout(() => {
      if (state.dish?.id === dish.id) el('reason').textContent = original;
    }, 2000);
    return;
  }
  // 排序已在加载时算定，这道菜本轮仍留在轮播里；静音下次加载才生效。
  // 但至少先把它翻过去，别让用户盯着一道刚被自己静音的菜。
  animateStep(1);
});

el('copy-shop').addEventListener('click', async () => {
  try {
    const ok = await copyText(state.shop.name);
    el('copy-shop').textContent = ok ? '已复制店名' : '复制失败，请长按选择';
  } catch (err) {
    console.error('复制店名失败', err);
    el('copy-shop').textContent = '复制失败，请长按选择';
  }
  setTimeout(() => { el('copy-shop').textContent = '复制店名'; }, 2000);
});

el('retry').addEventListener('click', () => {
  render();
});

/**
 * 画一整页：浮层 + 卡片。一次渲染只读一遍库，两者看到的必然是同一份数据 ——
 * 各读各的话中间隔着一次 await，浮层和卡片可能依据两份不同的快照。
 * 读不出来就是失败态，浮层也不用画了。
 *
 * 评分后重渲染与「重试」仍各自调 render()：那时必须重新读库才能看见刚写进去的事件。
 */
async function renderAll(now = Date.now()) {
  let data;
  try {
    data = await loadAll();
  } catch (err) {
    showFailure(err);
    return;
  }
  await renderFeedback(now, data);
  await render(now, data);
}

// 启动时只读一次时钟：两者各读一次的话，恰好跨过饭点边界时
// 会一个按早餐算、一个按午餐算。评分后重渲染与「重试」照旧各取当下时刻。
const startedAt = Date.now();
await renderAll(startedAt);

// iOS 主屏 App 从后台切回来常常不重新加载页面，卡片会停在切走时那一顿 ——
// 昨晚的卡片今早点下单，这一单就记到了昨天晚餐上。回到前台时查一次时钟：
// 日期和饭点都没变就什么都不动（下单往返回来卡片不能变），变了才整页重画。
// 不在点下单那一刻查：那会把轮播从手指底下重置（spec 2026-09-13 §2.1）。
let refreshing = false;
async function refreshIfStale() {
  if (refreshing || document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (localDateKey(now) === state.dateKey && resolveSlot(now) === state.slot) return;
  refreshing = true;
  try {
    // 开着的浮层问的是按旧时刻挑出来的那一顿，先收掉再按新时刻重挑。
    el('feedback').hidden = true;
    el('feedback').innerHTML = '';
    await renderAll(now);
  } finally {
    refreshing = false;
  }
}

document.addEventListener('visibilitychange', refreshIfStale);
window.addEventListener('pageshow', (e) => { if (e.persisted) refreshIfStale(); });
