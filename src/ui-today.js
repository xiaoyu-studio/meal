import { SLOT_LABELS, SLOTS, CONFIG } from './config.js';
import { slotFromTime, localDateKey } from './dates.js';
import { currentPick, pendingFeedback, reduceObservations } from './observations.js';
import { recommend } from './recommender.js';
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

let state = { slot: null, dish: null, shop: null, swapCount: 0 };

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
          <input type="number" inputmode="decimal" placeholder="实付价（元）">
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
      // 正在补问的那道菜这一顿不再推：不能一边问「上顿的黄焖鸡怎么样」
      // 一边又端上同一道黄焖鸡。
      const asking = pendingFeedback(reduceObservations(events), now, slot);
      const excludedDishIds = asking
        ? [...pick.swappedDishIds, asking.dishId]
        : pick.swappedDishIds;

      // 但候选池小到只剩它时，宁可重复推荐也不能显示「没有可推的」。
      const result =
        recommend({ dishes, shops, events, slot, now, excludedDishIds }) ??
        (asking
          ? recommend({
              dishes, shops, events, slot, now,
              excludedDishIds: pick.swappedDishIds,
            })
          : null);
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

await renderFeedback();
await render();
