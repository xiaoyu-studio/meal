import { SLOTS, SLOT_LABELS } from './config.js';
import { reduceObservations } from './observations.js';
import { tasteOf } from './recommender.js';
import { snapshotFilename } from './snapshot.js';
import {
  loadAll, putShop, putDish, deleteShop, deleteDish, setHygiene,
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

/**
 * 失败态下把失败卡片以外的一切收起来，跟 ui-today 的排他式失败态对齐。
 *
 * 真正非收不可的是「导入备份」：importSnapshot 先 clear 三个 store 再写入，
 * 而看到「读取失败」的人很自然会想拿备份修一修。万一碰上读坏了写还正常的
 * 部分故障，一份格式合法但过期的备份就会静默盖掉现有数据 —— 用一次读错误
 * 换来一次不可逆的丢数据。导出和「加一家店」收起来只是顺带：留着它们，
 * 用户会对着一个看起来能用的表单白填一遍。
 *
 * 注意 .io-row / .form 在 CSS 里是 flex / grid，必须配合各自的 [hidden]
 * 规则才收得掉（见 css/style.css）。
 */
function setControlsHidden(hidden) {
  el('io-row').hidden = hidden;
  el('io-msg').hidden = hidden;
  el('shop-form').hidden = hidden;
}

/** 本地存储读不出来时兜底展示的失败态。 */
function showFailure(err) {
  console.error('渲染候选池失败', err);
  el('shops').innerHTML = '';
  setControlsHidden(true);
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
            <p class="shop-meta hygiene-row">
              <label>
                卫生标记
                <select class="hygiene-select" data-hygiene="${esc(shop.id)}">
                  ${Object.entries(HYGIENE_LABELS)
                    .map(([v, label]) =>
                      `<option value="${v}"${shop.hygiene === v ? ' selected' : ''}>${label}</option>`)
                    .join('')}
                </select>
              </label>
            </p>
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
    setControlsHidden(false);
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

/**
 * 卫生标记的唯一可改入口。「吃坏了」是一次点击就永久拉黑、且按 spec §7.3
 * 刻意不做二次确认的操作 —— 那就必须在别处留一条回头路，否则误触之后只能
 * 删店重加（新 id，历史全部作废）。候选池正是用户来看和修正系统学到了什么
 * 的地方（§7.2）。
 */
el('shops').addEventListener('change', async (e) => {
  const shopId = e.target.dataset?.hygiene;
  if (!shopId) return;

  try {
    await setHygiene(shopId, e.target.value);
    await render();
  } catch (err) {
    console.error('修改卫生标记失败', err);
    el('io-msg').textContent = '修改卫生标记失败，请稍后重试。';
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

    // 必须先入文档再点：WebKit 对游离节点的下载并不可靠。
    // revoke 也不能和 click() 挤在同一 tick —— 那样下载会静默失败。
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    // 措辞不能断言「已导出」：浏览器是否真的落了盘、用户有没有在保存面板上
    // 点取消，这段代码都观察不到。而这份 JSON 是用户唯一的备份（§10），
    // 让他以为备份存在而其实没有，是这个应用里最坏的结果。
    el('io-msg').textContent = `已生成 ${a.download}，请在「文件」App 里确认。`;
  } catch (err) {
    console.error('导出备份失败', err);
    el('io-msg').textContent = '导出失败，请稍后重试。';
  }
});

el('import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // 解析和导入分两个 try：JSON.parse 抛的是引擎原生英文错误
  // （例如 "Unexpected token o in JSON at position 1"），不能直接
  // 显示给用户；只有 importSnapshot 自己抛出的才是可信的中文提示。
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    el('io-msg').textContent = '导入失败：文件不是有效的 JSON 备份。';
    e.target.value = '';
    return;
  }

  try {
    await importSnapshot(parsed);
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
