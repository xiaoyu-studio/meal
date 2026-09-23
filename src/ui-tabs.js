// 两个标签（翻牌子 / 御膳房）在同一页里切换。
//
// 以前是两个 HTML 页面、靠浏览器的跨页过渡淡入淡出。那条路在 iPhone 上一直不顺：
// 新页面第一帧还没读完库、只有一片底色；iOS 给整页拍快照只拍到偏短的高度，
// 屏幕底下一截瞬间变色 —— 而且这些只有真机上才看得到，没法在桌面上验。
// 现在两个视图叠在同一页里，切换动画自己写，没有重载、没有快照。
//
// 首帧显示哪个视图由 index.html <head> 里那行脚本按地址里的 #pool 定好
// （写在 <html data-view>），CSS 据此显示视图、摆好标签高亮 —— 不等这个模块。
//
// 切换前先发 viewwillshow 事件：视图的脚本可以交一个 Promise 过来（waitUntil），
// 比如对方改过数据、要先重画。等它画好再开始动画，最多等 WAIT_MAX_MS ——
// 否则动画播着播着内容突然一变。

const root = document.documentElement;
const WAIT_MAX_MS = 300;
const DURATION_MS = 320;
const SHIFT_PX = 18;
const EASE = 'cubic-bezier(0.3, 0, 0.2, 1)';

const views = {
  today: document.getElementById('view-today'),
  pool: document.getElementById('view-pool'),
};
const TITLES = { today: '今天这顿', pool: '御膳房' };
// 标签从左到右的顺序：往右边的标签切，内容往左走；反过来往右走。
const ORDER = ['today', 'pool'];

export function currentView() {
  return root.dataset.view === 'pool' ? 'pool' : 'today';
}

/**
 * 状态栏颜色（theme-color）。iOS 拿它涂状态栏那一条（2026-09-23 真机录屏：
 * 状态栏像素与页面底色一致）。翻牌子用渐变顶端的饭点色，御膳房用页面底色。
 * 饭点和深浅色一变、视图一切都要重写，所以 ui-today.js 改完 data-slot 也调它。
 */
export function paintStatusBar() {
  const name = currentView() === 'pool' ? '--bg' : '--board-a';
  const color = getComputedStyle(root).getPropertyValue(name).trim();
  if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

/** 当前视图以外的那个视图点不到、读屏也跳过；标签的 aria-current 跟着走。 */
function settle(view) {
  for (const [name, node] of Object.entries(views)) node.inert = name !== view;
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.tab === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  document.title = TITLES[view];
  paintStatusBar();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

let switching = false;

async function switchTo(next) {
  const prev = currentView();
  if (next === prev || switching || !views[next]) return;
  switching = true;
  try {
    const pending = [];
    document.dispatchEvent(new CustomEvent('viewwillshow', {
      detail: { view: next, waitUntil: (p) => pending.push(p) },
    }));
    if (pending.length) await Promise.race([Promise.allSettled(pending), sleep(WAIT_MAX_MS)]);

    // 地址栏跟着改，但不留历史：主屏 App 没有返回键，历史只会越攒越多。
    // 保留查询参数（快捷指令带的 ?slot=）。
    history.replaceState(null, '', location.pathname + location.search + (next === 'pool' ? '#pool' : ''));

    const outgoing = views[prev];
    const incoming = views[next];
    const dir = ORDER.indexOf(next) > ORDER.indexOf(prev) ? -1 : 1;

    if (prefersReducedMotion() || !outgoing.animate) {
      root.dataset.view = next;
      settle(next);
      return;
    }

    // 切换期间两个视图都显示：新的在下面、不透明；旧的盖在上面淡出。
    // 只淡上面那一层，屏幕上每一刻都恰好是「旧 × (1−t) + 新 × t」，
    // 两层一起半透明的话中间会透出后面的底色，就是「闪一下」。
    // 背景铺满整屏不动，只让里面的内容顺着方向错开一点，有个去向。
    root.classList.add('switching');
    outgoing.classList.add('leaving');
    root.dataset.view = next;   // 标签高亮的底块由 CSS 过渡滑过去
    settle(next);

    const timing = { duration: DURATION_MS, easing: EASE, fill: 'both' };
    const anims = [
      outgoing.animate([{ opacity: 1 }, { opacity: 0 }], timing),
      outgoing.firstElementChild.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(${dir * SHIFT_PX}px)` }], timing),
      incoming.firstElementChild.animate(
        [{ transform: `translateX(${-dir * SHIFT_PX}px)` }, { transform: 'translateX(0)' }], timing),
    ];
    await Promise.all(anims.map((a) => a.finished.catch(() => {})));
    outgoing.classList.remove('leaving');
    root.classList.remove('switching');
    for (const a of anims) a.cancel();
  } finally {
    switching = false;
  }
}

// 标签和「去添加菜品」这类页内链接都走这里。它们本身是真链接（href 指向
// index.html / index.html#pool），脚本没加载时照样能用。
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-tab]');
  if (!link) return;
  e.preventDefault();
  switchTo(link.dataset.tab);
});

// 地址里的 #pool 被别处改了（手动改地址、从别的链接跳进来）也跟着切。
// switchTo 自己用 replaceState 改地址，不会触发这个事件。
window.addEventListener('hashchange', () => switchTo(location.hash === '#pool' ? 'pool' : 'today'));

// 系统深浅色切换时两套底色都会变，状态栏跟着重写。
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', paintStatusBar);

settle(currentView());
