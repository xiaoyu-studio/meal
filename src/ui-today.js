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

/** 本地存储读不出来时兜底展示的失败态 —— 用户手机上没有控制台可看。 */
function showFailure(err) {
  console.error('渲染「今天这顿」失败', err);
  el('card').hidden = true;
  el('empty').hidden = true;
  el('failure-text').textContent = '本地存储读取失败，请稍后重试。';
  el('failure').hidden = false;
}

let state = { slot: null, dish: null, shop: null, swapCount: 0 };

async function render() {
  try {
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
      el('failure').hidden = true;
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
    el('failure').hidden = true;
    el('empty').hidden = true;
    el('card').hidden = false;
  } catch (err) {
    showFailure(err);
  }
}

el('order').addEventListener('click', async () => {
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

el('swap').addEventListener('click', async () => {
  try {
    await appendEvent({
      slot: state.slot, dishId: state.dish.id, type: 'swapped',
    });
    await render();
  } catch (err) {
    console.error('记录「换一个」事件失败', err);
    const original = el('reason').textContent;
    el('reason').textContent = '换一个失败，请稍后再试';
    setTimeout(() => { el('reason').textContent = original; }, 2000);
  }
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

await render();
