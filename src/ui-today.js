import { SLOT_LABELS, SLOTS } from './config.js';
import { slotFromTime, localDateKey } from './dates.js';
import { currentPick, pendingFeedback, reduceObservations } from './observations.js';
import { rankCandidates } from './recommender.js';
import { loadAll, appendEvent, setHygiene } from './store.js';
import { openShopLink, copyText } from './deeplink.js';

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
let state = { slot: null, dish: null, shop: null, ranked: [], index: 0 };

const RATING_LABELS = { good: '好吃', ok: '还行', bad: '不了', skipped: '没吃成' };

/**
 * 渲染补问上一顿的浮层。已评过、被换掉、或就是当前这顿的，都不问——
 * 这些跳过规则全在 pendingFeedback 里，这里只负责渲染它返回的结果。
 *
 * 本地存储读取失败时不该拦住主卡片渲染：吞掉错误、跳过浮层即可。
 */
async function renderFeedback() {
  try {
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
      </div>
    `;
    // dish.name 来自用户在候选池里填写的数据（Task 15），不能当作可信 HTML 拼进
    // innerHTML —— 走 textContent 天然转义，不需要额外的转义辅助函数。
    overlay.querySelector('.fb-question').textContent = `上顿的${dish.name}怎么样？`;
    overlay.hidden = false;

    const close = () => { overlay.hidden = true; overlay.innerHTML = ''; };

    overlay.addEventListener('click', async (e) => {
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
          const amount = Number(overlay.querySelector('.fb-price-box input').value);
          if (Number.isFinite(amount) && amount > 0) {
            await appendEvent({
              slot: target.slot, dishId: target.dishId, targetTs: target.ts,
              type: 'paid', value: amount,
            });
          }
          overlay.querySelector('.fb-price-box').hidden = true;
        }
      } catch (err) {
        // 反馈写入失败不该把浮层卡死在打开状态——记录并关闭，用户下次还有机会。
        console.error('记录反馈失败', err);
        close();
      }
    });
  } catch (err) {
    // 读取本地存储失败时跳过浮层即可，不能连累主卡片渲染。
    console.error('渲染反馈浮层失败', err);
  }
}

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

async function render() {
  try {
    const now = Date.now();
    const slot = resolveSlot(now);
    const { shops, dishes, events } = await loadAll();
    const nowKey = localDateKey(now);

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
  } catch (err) {
    showFailure(err);
  }
}

el('order').addEventListener('click', async () => {
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
  try {
    await appendEvent({
      slot: state.slot, dishId: state.dish.id, type: 'clicked',
    });
  } catch (err) {
    // 记录失败不该拦住下单 —— 日志是记账，不是门槛。
    console.error('记录「去下单」事件失败', err);
  }
  openShopLink(state.shop.link);
});

el('swap').addEventListener('click', () => {
  step(1);
});

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

await renderFeedback();
await render();
