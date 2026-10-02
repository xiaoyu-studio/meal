import { CONFIG, SLOTS } from './config.js';
import { buildMutedIndex, reduceObservations } from './observations.js';
import { tasteOf } from './recommender.js';
import { snapshotFilename } from './snapshot.js';
import { dishEmoji } from './emoji.js';
import { isSafeLink } from './deeplink.js';
import {
  loadAll, putShop, putDish, deleteShop, deleteDish, setHygiene,
  newId, exportSnapshot, importSnapshot, appendEvent, writeCount,
} from './store.js';
import './ui-tabs.js';

const el = (id) => document.getElementById(id);
/**
 * 只是显示用的名字。存库的值一律保持 'meituan' / 'eleme' 不变 ——
 * 平台改名跟数据无关，改了 key 会让已有记录和导出的备份全部对不上。
 */
const PLATFORM_LABELS = { meituan: '🛵 美团外卖', eleme: '🛍 淘宝闪购' };
/** 卫生标记的选项文字，和「招一家新店进宫」表单里那组一致。 */
const HYGIENE_LABELS = { unknown: '待验', trusted: '放心', blocked: '冷宫（拉黑）' };
/** 印章上的两个字。 */
const HYGIENE_SEALS = { unknown: '待验', trusted: '放心', blocked: '冷宫' };
/** 加菜表单里饭点胶囊上的字，比 SLOT_LABELS 短一个字才排得下三个。 */
const SLOT_PILLS = { breakfast: '🌅 早', lunch: '☀️ 午', dinner: '🌙 晚' };
const SLOT_SHORT = { breakfast: '早', lunch: '午', dinner: '晚' };

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
 * 失败态下把失败卡片以外的一切收起来，跟 ui-today 的排他式失败态对齐。
 *
 * 真正非收不可的是「导入备份」：importSnapshot 先 clear 三个 store 再写入，
 * 而看到「读取失败」的人很自然会想拿备份修一修。万一碰上读坏了写还正常的
 * 部分故障，一份格式合法但过期的备份就会静默盖掉现有数据 —— 用一次读错误
 * 换来一次不可逆的丢数据。导出和「加一家店」收起来只是顺带：留着它们，
 * 用户会对着一个看起来能用的表单白填一遍。
 *
 * 注意 .io-row / .add-shop 在 CSS 里设了 display，必须配合各自的 [hidden]
 * 规则才收得掉（见 css/style.css）。
 */
function setControlsHidden(hidden) {
  el('io-row').hidden = hidden;
  el('io-msg').hidden = hidden;
  el('add-shop').hidden = hidden;
}

/** 好吃度画成几颗心。一条带分数的记录都没有时返回 null —— 那时 tasteOf 给的
 *  是冷启动的乐观初值 0.7，画出来是四颗心，像是吃过而且挺好吃，其实是没尝过。 */
function heartsOf(obs, now) {
  if (!obs.some((o) => o.value !== null && o.value !== undefined)) return null;
  return Math.round(tasteOf(obs, now) * CONFIG.TASTE_HEARTS);
}

let toastTimer = null;

/**
 * 屏幕底部的一次性提示。删店、导入这类「做完了但当场看不出变化」的操作
 * 需要它 —— #io-msg 是页面顶部那行小灰字，用户滚到下面操作时根本看不见。
 */
function showToast(text) {
  const t = el('toast');
  t.textContent = text;
  t.hidden = false;
  // 同一 tick 里 hidden=false 和加 class 会被合并成一次样式计算，过渡不触发。
  // 读一次 offsetWidth 强制重排，把两者分开。
  void t.offsetWidth;
  t.classList.add('toast-show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('toast-show');

    // 收起必须等淡出真的跑完，所以听 transitionend 而不是掐一个定时器 ——
    // 定时器时长一旦等于（甚至只是接近）过渡时长，display:none 就会抢在
    // 过渡结束前生效，看起来是「一闪就没」而不是淡出。
    //
    // 但 transitionend 不是一定会来：用户开了「减弱动态效果」时
    // transition 是 none，压根不派发这个事件。所以另配一个兜底定时器，
    // 谁先到谁收尾，用 done 里的判断保证只执行一次。
    let settled = false;
    const done = (e) => {
      if (e && e.propertyName !== 'opacity') return;
      if (settled) return;
      settled = true;
      t.removeEventListener('transitionend', done);
      clearTimeout(fallback);
      // 期间又弹了新的 toast，就不能收起来。
      if (!t.classList.contains('toast-show')) t.hidden = true;
    };
    const fallback = setTimeout(done, 600);
    t.addEventListener('transitionend', done);
  }, 2600);
}

/**
 * 让一个元素淡出，等过渡真的跑完再落地 —— 和 toast 收尾同一套写法。
 * transitionend 不是一定会来：开了「减弱动态效果」时 transition 是 none，
 * 压根不派发这个事件，所以另配一个兜底定时器，谁先到谁收尾。
 */
function fadeOut(node, className) {
  return new Promise((resolve) => {
    node.classList.add(className);
    let settled = false;
    const done = (e) => {
      if (e && e.propertyName !== 'opacity') return;
      if (settled) return;
      settled = true;
      node.removeEventListener('transitionend', done);
      clearTimeout(fallback);
      resolve();
    };
    const fallback = setTimeout(done, 400);
    node.addEventListener('transitionend', done);
  });
}

/** 本地存储读不出来时兜底展示的失败态。 */
function showFailure(err) {
  console.error('渲染候选池失败', err);
  el('shops').innerHTML = '';
  setControlsHidden(true);
  el('pool-failure-text').textContent = '本地存储读取失败，请稍后重试。';
  el('pool-failure').hidden = false;
}

// 上次画列表时库里写到第几次了（store.js 的 writeCount）。切回御膳房时拿它比，
// 翻牌子那边写过东西（静音、评价、下单……）才重画。
let seenWrites = -1;

async function render() {
  try {
    const now = Date.now();
    const writesAtRead = writeCount();
    const { shops, dishes, events } = await loadAll();
    const observations = reduceObservations(events);

    const obsByDish = new Map();
    for (const obs of observations) {
      let list = obsByDish.get(obs.dishId);
      if (!list) obsByDish.set(obs.dishId, (list = []));
      list.push(obs);
    }

    // 「别再推这个」是全应用唯一按下去就产生持久后果、且没有撤销出口的按钮，
    // 位置还紧挨着「复制店名」。至少让它的状态在这里看得见 —— 否则误触之后
    // 既不知道是哪道菜，也不知道生没生效，再按一次还会把时钟重新拨满。
    // 只显示事实（哪天按的），不显示「还剩几天失效」：静音是连续衰减不是开关，
    // 编一个「静音中/已过期」的阈值出来反而是在撒谎。
    const muted = buildMutedIndex(events);

    // 新店排在表单正下方 —— getAll() 按 uuid 主键排，等于随机，加完一家店
    // 要在列表里找半天。没有 createdAt 的老店（这个字段 2026-09-20 才加）
    // 一律排在后面，彼此保持原来的相对顺序，所以既有列表的样子不变。
    const createdAt = (s) => (typeof s.createdAt === 'number' ? s.createdAt : -Infinity);
    const shopIds = new Set(shops.map((s) => s.id));
    const dishCount = dishes.filter((d) => shopIds.has(d.shopId)).length;
    el('pool-count').textContent = shops.length
      ? `${shops.length} 家店 · ${dishCount} 道菜候旨`
      : '还没有店，先招一家进来';

    el('shops').innerHTML = shops
      .slice()
      .sort((a, b) => createdAt(b) - createdAt(a))
      .map((shop) => {
        const rows = dishes
          .filter((d) => d.shopId === shop.id)
          .map((d) => {
            const obs = obsByDish.get(d.id) ?? [];
            const hearts = heartsOf(obs, now);
            const eatenCount = obs.filter((o) => o.eaten).length;
            const slotText = (d.slots ?? []).map((s) => SLOT_SHORT[s] ?? s).join(' · ');
            const scoreHtml = hearts === null
              ? '<span class="dish-score">还没尝过</span>'
              : `<span class="dish-score">
                  <span class="hearts" role="img" aria-label="好吃度 ${hearts} / ${CONFIG.TASTE_HEARTS}">` +
                  '❤️'.repeat(hearts) + '🤍'.repeat(CONFIG.TASTE_HEARTS - hearts) +
                  `</span>吃过 ${eatenCount} 次</span>`;
            // 静音状态独占菜名下面一行，「取消」挨着它改的那个状态放，
            // 不跟右边的 ✕ 挨着，免得点错（spec 2026-09-14 §4.1）。
            const mutedKey = muted.get(d.id);
            const mutedHtml = mutedKey
              ? `<span class="dish-muted">🔕 ${esc(mutedKey.slice(5))} 起歇着` +
                `<button class="link" data-unmute-dish="${esc(d.id)}" type="button">取消</button></span>`
              : '';
            return `
              <div class="dish-row">
                <span class="dish-emo" aria-hidden="true">${dishEmoji(d.name)}</span>
                <span class="dish-main">
                  <span class="dish-title">${esc(d.name)}</span>
                  <span class="dish-meta"><b>¥${esc(d.refPrice)}</b>${esc(slotText)}</span>
                  ${mutedHtml}
                </span>
                ${scoreHtml}
                <button class="dish-del" data-del-dish="${esc(d.id)}" type="button"
                  aria-label="删掉「${esc(d.name)}」">✕</button>
              </div>`;
          })
          .join('');

        // 渲染已存的链接同样要过协议白名单 —— 这个检查是 Task 15 才加的，
        // 早先存进库里的坏数据不能靠"以后不会再存进去"就当没事。
        const linkHtml = isSafeLink(shop.link)
          ? `<a class="chip" href="${esc(shop.link)}">🔗 去店里</a>`
          : '<span class="chip chip-bad">链接无效，点「换链接」重新粘贴</span>';

        // 卫生标记是一枚印章，印章上盖着一个透明的 <select>：点印章就弹系统的选择框。
        // 「吃坏了」一次点击就拉黑、不做二次确认，这里是它的回头路（见下面 change 事件）。
        const hygiene = HYGIENE_SEALS[shop.hygiene] ? shop.hygiene : 'unknown';
        return `
          <section class="shop-block${hygiene === 'blocked' ? ' shop-cold' : ''}" data-shop="${esc(shop.id)}">
            <span class="ribbon" aria-hidden="true"></span>
            <div class="shop-head">
              <p class="shop-title">${esc(shop.name)}</p>
              <label class="seal seal-${hygiene}">
                <span aria-hidden="true">${HYGIENE_SEALS[hygiene]}</span>
                <select class="hygiene-select" data-hygiene="${esc(shop.id)}" aria-label="卫生标记">
                  ${Object.entries(HYGIENE_LABELS)
                    .map(([v, label]) =>
                      `<option value="${v}"${hygiene === v ? ' selected' : ''}>${label}</option>`)
                    .join('')}
                </select>
              </label>
            </div>
            <p class="chips">
              <span class="chip">${esc(PLATFORM_LABELS[shop.platform] ?? shop.platform)}</span>
              ${linkHtml}
            </p>
            ${rows}
            <details class="add-dish">
              <summary>＋ 添一道菜</summary>
              <form class="form" data-dish-form="${esc(shop.id)}">
                <div class="form-two">
                  <input name="name" placeholder="菜名" required>
                  <input name="refPrice" type="number" step="0.01" inputmode="decimal" placeholder="参考价 ¥" required>
                </div>
                <input name="tags" placeholder="标签，逗号分隔（如：川菜,辣）">
                <div class="slot-pills" role="group" aria-label="适用饭点">
                  ${SLOTS.map(
                    (s) => `<label class="slot-pill">
                      <input type="checkbox" name="slots" value="${s}" checked><span>${SLOT_PILLS[s]}</span>
                    </label>`,
                  ).join('')}
                </div>
                <p class="io-msg" data-dish-msg></p>
                <button class="go" type="submit">添上</button>
                <button class="later" type="button" data-close-details>先不添了</button>
              </form>
            </details>
            <p class="shop-acts">
              <button class="link" data-fix-link="${esc(shop.id)}" type="button">换链接</button>
              <button class="link" data-del-shop="${esc(shop.id)}" type="button">删店</button>
            </p>
          </section>`;
      })
      .join('');

    el('pool-failure').hidden = true;
    setControlsHidden(false);
    seenWrites = writesAtRead;
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
    const name = f.get('name').trim();
    await putShop({
      id: newId(),
      name,
      platform: f.get('platform'),
      link,
      hygiene: f.get('hygiene'),
      note: '',
      // 列表靠它把新店排在最前。只在新建时写：putShop 也用于改链接和
      // 改卫生标记，在那些路径上写时间会把老店挪到顶上去。
      createdAt: Date.now(),
    });
    msg.textContent = '';
    e.target.reset();
    el('add-shop').open = false;
    await render();
    // 新店现在会排在表单正下方（按 createdAt 倒序），但列表长了照样要滚动，
    // 提示仍然有用：没有它，用户会以为没保存上又填一遍。
    showToast(`已添加「${name}」`);
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
    const name = f.get('name').trim();
    await putDish({
      id: newId(),
      shopId,
      name,
      refPrice: Number(f.get('refPrice')),
      tags: f.get('tags').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      slots,
      active: true,
    });
    await render();
    // 同「加一家店」：render() 会重画整页，加菜表单跟着收起，
    // 不给提示就看不出发生过什么。
    showToast(`已添加「${name}」`);
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
    // 不弹确认框：「删」要确认是因为不可逆；取消静音点错了，
    // 下次划到这道菜再按一次「别再推这个」就回来了（spec 2026-09-14 §2.1）。
    if (button.dataset.unmuteDish) {
      const dishId = button.dataset.unmuteDish;
      const { dishes } = await loadAll();
      const name = dishes.find((d) => d.id === dishId)?.name;
      // slot 写 null：候选池没有「当前饭点」，也让归约 Pass 2 挂不到任何一顿上。
      await appendEvent({ slot: null, dishId, type: 'unmuted' });
      await render();
      showToast(name ? `已取消静音「${name}」` : '已取消静音');
      return;
    }

    if (button.dataset.delDish) {
      if (confirm('删掉这道菜？历史记录会保留。')) {
        const { dishes } = await loadAll();
        const name = dishes.find((d) => d.id === button.dataset.delDish)?.name;
        await deleteDish(button.dataset.delDish);
        await render();
        showToast(name ? `已删除「${name}」` : '已删除');
      }
      return;
    }

    if (button.dataset.delShop) {
      if (confirm('删掉这家店？它名下所有菜品也会一并删除。')) {
        const { shops } = await loadAll();
        const name = shops.find((s) => s.id === button.dataset.delShop)?.name;
        // 先写库再动画：写失败时卡片不该先消失再弹回来，错误走下面的 catch。
        await deleteShop(button.dataset.delShop);
        const block = button.closest('.shop-block');
        if (block) await fadeOut(block, 'shop-removing');
        await render();
        showToast(name ? `已删除「${name}」及其菜品` : '已删除');
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

// 「先不加了」「先不添了」：收起表单，填了一半的也清掉 —— 下次点开是一张空表。
el('view-pool').addEventListener('click', (e) => {
  const button = e.target.closest('[data-close-details]');
  if (!button) return;
  const form = button.closest('form');
  form?.reset();
  for (const msg of form?.querySelectorAll('.io-msg') ?? []) msg.textContent = '';
  const details = button.closest('details');
  if (details) details.open = false;
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
    const { shops, dishes } = await loadAll();
    el('io-msg').textContent = '导入成功。';
    await render();
    showToast(`已导入 ${shops.length} 家店、${dishes.length} 道菜`);
  } catch (err) {
    // importSnapshot 校验失败时旧数据分毫不动 —— 把它抛出的中文错误原样
    // 显示出来，绝不能吞掉让用户以为导入成功了。
    el('io-msg').textContent = err.message ?? '导入失败，请检查文件。';
  }
  e.target.value = '';
});

el('pool-retry').addEventListener('click', () => {
  render();
});

// 切到御膳房之前：库被改过就先重画，画好再开始切换动画（ui-tabs.js 等这个 Promise）。
document.addEventListener('viewwillshow', (e) => {
  if (e.detail.view === 'pool' && writeCount() !== seenWrites) e.detail.waitUntil(render());
});

await render();
