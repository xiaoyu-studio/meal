/**
 * 只放行 http/https 链接。`<input type="url">` 会把 `javascript:alert(1)`
 * 当成合法的绝对 URL 放行，而这个链接两处都会被当代码执行：拼进候选池的
 * `<a href>`，以及挂到「去下单」的 href 上。分享链接是全应用唯一的真正
 * 外部输入 —— 存库前和渲染时都要查（CLAUDE.md「安全」）。
 *
 * 放在这里而不是 ui-pool.js：现在 ui-today 也要用它，一条安全规则不该有
 * 两份实现。
 */
export function isSafeLink(link) {
  try {
    const u = new URL(link);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 把店铺链接挂到「去下单」上。
 *
 * 必须是真实的 `<a href>`，不能是 `location.href = link` 赋值 —— iOS 的
 * Universal Links 对脚本发起的跳转和真实的链接点击处理方式不同，脚本跳转
 * 唤不起外卖 App，只会一路跟到平台的手机网页版要求登录（真机验收第 3 条）。
 *
 * 代价是点击后的事件记录变成了跟导航赛跑，见 ui-today.js 的 order 处理器。
 *
 * 链接不合法时摘掉 href：`<a>` 没有 href 就点不动，比跳到一个坏地址好。
 * 兜底路径是卡片上的「复制店名」。
 */
export function setShopLink(anchor, link) {
  if (isSafeLink(link)) {
    anchor.href = link;
    anchor.removeAttribute('aria-disabled');
  } else {
    anchor.removeAttribute('href');
    anchor.setAttribute('aria-disabled', 'true');
  }
}

/** 兜底路径：链接没能唤起 App 时，让用户复制店名自己去搜。 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
