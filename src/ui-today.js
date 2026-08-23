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
