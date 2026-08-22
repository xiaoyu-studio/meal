import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey, daysBetweenKeys, slotFromTime } from '../src/dates.js';
import { CONFIG } from '../src/config.js';

test('localDateKey 按本地时区取自然日', () => {
  const ts = new Date(2026, 7, 22, 23, 30).getTime(); // 本地 2026-08-22 23:30
  assert.equal(localDateKey(ts), '2026-08-22');
});

test('localDateKey 补零到两位', () => {
  const ts = new Date(2026, 0, 5, 9, 0).getTime(); // 本地 2026-01-05
  assert.equal(localDateKey(ts), '2026-01-05');
});

test('daysBetweenKeys 返回整数自然日差', () => {
  assert.equal(daysBetweenKeys('2026-08-20', '2026-08-22'), 2);
  assert.equal(daysBetweenKeys('2026-08-22', '2026-08-22'), 0);
});

test('daysBetweenKeys 跨月份正确', () => {
  assert.equal(daysBetweenKeys('2026-07-31', '2026-08-01'), 1);
});

test('daysBetweenKeys 对空起点返回 Infinity', () => {
  assert.equal(daysBetweenKeys(undefined, '2026-08-22'), Infinity);
  assert.equal(daysBetweenKeys(null, '2026-08-22'), Infinity);
});

test('slotFromTime 在 10:30 与 15:00 处切换', () => {
  assert.equal(slotFromTime(new Date(2026, 7, 22, 10, 29).getTime()), 'breakfast');
  assert.equal(slotFromTime(new Date(2026, 7, 22, 10, 30).getTime()), 'lunch');
  assert.equal(slotFromTime(new Date(2026, 7, 22, 14, 59).getTime()), 'lunch');
  assert.equal(slotFromTime(new Date(2026, 7, 22, 15, 0).getTime()), 'dinner');
  assert.equal(slotFromTime(new Date(2026, 7, 22, 21, 0).getTime()), 'dinner');
});

test('CONFIG 的两个权重之和为 1', () => {
  assert.equal(CONFIG.W_TASTE + CONFIG.W_VALUE, 1);
});
