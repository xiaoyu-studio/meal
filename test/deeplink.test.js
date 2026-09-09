import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeLink, setShopLink } from '../src/deeplink.js';

test('isSafeLink 放行 http 与 https', () => {
  assert.equal(isSafeLink('https://h5.waimai.meituan.com/waimai/mindex/menu?poi_id_str=1'), true);
  // 美团分享出来的短链就是 http 的，不能因为它不是 https 就挡掉。
  assert.equal(isSafeLink('http://dpurl.cn/abcdefg'), true);
});

test('isSafeLink 挡住伪协议', () => {
  // <input type="url"> 会把这三个都当成合法的绝对 URL 放行。
  assert.equal(isSafeLink('javascript:alert(1)'), false);
  assert.equal(isSafeLink('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isSafeLink('file:///etc/passwd'), false);
});

test('isSafeLink 挡住空值与相对路径', () => {
  assert.equal(isSafeLink(''), false);
  assert.equal(isSafeLink(undefined), false);
  assert.equal(isSafeLink(null), false);
  assert.equal(isSafeLink('pool.html'), false);
});

/** setShopLink 只碰 href / aria-disabled 两个属性，用最小替身就够测。 */
function fakeAnchor() {
  return {
    attrs: {},
    set href(v) { this.attrs.href = v; },
    get href() { return this.attrs.href ?? ''; },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
  };
}

test('setShopLink 合法链接时挂上 href', () => {
  const a = fakeAnchor();
  setShopLink(a, 'https://example.com/shop/1');
  assert.equal(a.attrs.href, 'https://example.com/shop/1');
  assert.equal(a.attrs['aria-disabled'], undefined);
});

test('setShopLink 非法链接时摘掉 href', () => {
  const a = fakeAnchor();
  a.href = 'https://example.com/old';
  setShopLink(a, 'javascript:alert(1)');
  assert.equal(a.attrs.href, undefined);
  assert.equal(a.attrs['aria-disabled'], 'true');
});

test('setShopLink 从非法切回合法时会清掉 aria-disabled', () => {
  // 轮播翻页会反复调用它，上一道菜留下的禁用态不能粘在下一道上。
  const a = fakeAnchor();
  setShopLink(a, '');
  setShopLink(a, 'https://example.com/shop/2');
  assert.equal(a.attrs.href, 'https://example.com/shop/2');
  assert.equal(a.attrs['aria-disabled'], undefined);
});
