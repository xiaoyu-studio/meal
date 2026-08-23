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

/**
 * 这个页面会把店名、菜名、标签这些用户手填的数据拼进一整段 innerHTML 里
 * （不是单个文本节点），所以不能像 ui-today 那样靠 textContent 天然转义 ——
 * 这里必须显式转义后再拼接。
 */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * 只放行 http/https 链接。<input type="url"> 会把 javascript:xxx 当成合法的
 * 绝对 URL 放行，而这个链接后面会被拼进 <a href> 和 openShopLink 的
 * location.href 赋值里 —— 两处都会执行它。分享链接是全应用唯一的真正外部
 * 输入，必须在存库前挡住。
 */
function isSafeLink(link) {
  try {
    const u = new URL(link);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 本地存储读不出来时兜底展示的失败态。 */
function showFailure(err) {
  console.error('渲染候选池失败', err);
  el('shops').innerHTML = '';
  el('failure-text').textContent = '本地存储读取失败，请稍后重试。';
  el('failure').hidden = false;
}

async function render() {
  try {
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
            const slotText = (d.slots ?? []).map((s) => SLOT_LABELS[s] ?? s).join('/');
            return `
              <div class="dish-row">
                <span>${esc(d.name)}　<span class="shop-meta">¥${esc(d.refPrice)}・${esc(slotText)}</span></span>
                <span class="dish-stat">
                  好吃度 ${taste}・吃过 ${eatenCount} 次
                  <button class="link" data-del-dish="${esc(d.id)}" type="button">删</button>
                </span>
              </div>`;
          })
          .join('');

        // 渲染已存的链接同样要过协议白名单 —— 这个检查是 Task 15 才加的，
        // 早先存进库里的坏数据不能靠"以后不会再存进去"就当没事。
        const linkHtml = isSafeLink(shop.link)
          ? `<a href="${esc(shop.link)}">跳转链接</a>`
          : `<span class="shop-blocked">链接无效，请点"链接失效了？"重新粘贴</span>`;

        return `
          <section class="shop-block">
            <div class="shop-head">
              <p class="shop-title">${esc(shop.name)}</p>
              <span class="shop-meta ${shop.hygiene === 'blocked' ? 'shop-blocked' : ''}">
                ${esc(PLATFORM_LABELS[shop.platform] ?? shop.platform)}・卫生${esc(HYGIENE_LABELS[shop.hygiene] ?? shop.hygiene)}
              </span>
            </div>
            <p class="shop-meta">
              ${linkHtml}
              <button class="link" data-fix-link="${esc(shop.id)}" type="button">链接失效了？</button>
              <button class="link" data-del-shop="${esc(shop.id)}" type="button">删店</button>
            </p>
            ${rows}
            <form class="form" data-dish-form="${esc(shop.id)}">
              <input name="name" placeholder="菜名" required>
              <input name="refPrice" type="number" step="0.5" placeholder="参考价" required>
              <input name="tags" placeholder="标签，逗号分隔（如：川菜,辣）">
              <label class="shop-meta">适用饭点</label>
              ${SLOTS.map(
                (s) => `<label class="shop-meta">
                  <input type="checkbox" name="slots" value="${s}" checked> ${SLOT_LABELS[s]}
                </label>`,
              ).join('')}
              <p class="io-msg" data-dish-msg></p>
              <button class="ghost" type="submit">加这道菜</button>
            </form>
          </section>`;
      })
      .join('');

    el('failure').hidden = true;
  } catch (err) {
    showFailure(err);
  }
}

el('shop-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const link = f.get('link').trim();
  const msg = el('shop-msg');

  if (!isSafeLink(link)) {
    msg.textContent = '链接无效：只支持 http/https 开头的分享链接。';
    return;
  }

  try {
    await putShop({
      id: newId(),
      name: f.get('name').trim(),
      platform: f.get('platform'),
      link,
      hygiene: f.get('hygiene'),
      note: '',
    });
    msg.textContent = '';
    e.target.reset();
    await render();
  } catch (err) {
    console.error('保存店铺失败', err);
    msg.textContent = '保存失败，请稍后重试。';
  }
});

el('shops').addEventListener('submit', async (e) => {
  const shopId = e.target.dataset.dishForm;
  if (!shopId) return;
  e.preventDefault();

  const f = new FormData(e.target);
  const slots = f.getAll('slots');
  const msgEl = e.target.querySelector('[data-dish-msg]');

  if (slots.length === 0) {
    if (msgEl) msgEl.textContent = '至少要勾一个饭点。';
    return;
  }

  try {
    await putDish({
      id: newId(),
      shopId,
      name: f.get('name').trim(),
      refPrice: Number(f.get('refPrice')),
      tags: f.get('tags').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      slots,
      active: true,
    });
    await render();
  } catch (err) {
    console.error('保存菜品失败', err);
    if (msgEl) msgEl.textContent = '保存失败，请稍后重试。';
  }
});

el('shops').addEventListener('click', async (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  try {
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
      if (!shop) return;

      const next = prompt('粘贴新的分享链接：', shop.link);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed) return;

      if (!isSafeLink(trimmed)) {
        alert('链接无效：只支持 http/https 开头的分享链接。');
        return;
      }

      await putShop({ ...shop, link: trimmed });
      await render();
    }
  } catch (err) {
    console.error('操作失败', err);
    el('io-msg').textContent = '操作失败，请稍后重试。';
  }
});

el('export').addEventListener('click', async () => {
  try {
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
  } catch (err) {
    console.error('导出备份失败', err);
    el('io-msg').textContent = '导出失败，请稍后重试。';
  }
});

el('import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await importSnapshot(JSON.parse(await file.text()));
    el('io-msg').textContent = '导入成功。';
    await render();
  } catch (err) {
    // importSnapshot 校验失败时旧数据分毫不动 —— 把它抛出的中文错误原样
    // 显示出来，绝不能吞掉让用户以为导入成功了。
    el('io-msg').textContent = err.message ?? '导入失败，请检查文件。';
  }
  e.target.value = '';
});

el('retry').addEventListener('click', () => {
  render();
});

await render();
