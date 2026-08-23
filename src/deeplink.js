/**
 * 打开店铺链接。用整页跳转而非 window.open —— iOS Safari 会拦截
 * 非用户手势触发的新窗口，而整页跳转能可靠唤起外卖 App。
 */
export function openShopLink(link) {
  window.location.href = link;
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
