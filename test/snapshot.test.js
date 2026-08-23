import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAPSHOT_VERSION, toSnapshot, fromSnapshot, snapshotFilename,
} from '../src/snapshot.js';

const data = {
  shops: [{ id: 's1', name: '张记', platform: 'meituan', link: 'https://x/1', hygiene: 'unknown', note: '' }],
  dishes: [{ id: 'd1', shopId: 's1', name: '黄焖鸡', refPrice: 22, tags: ['家常'], slots: ['lunch'], active: true }],
  events: [{ id: 'e1', ts: 1755830400000, slot: 'lunch', dishId: 'd1', type: 'rated', value: 'good' }],
};

test('toSnapshot 带上版本号与导出时间', () => {
  const snap = toSnapshot(data, 1755830400000);
  assert.equal(snap.version, SNAPSHOT_VERSION);
  assert.equal(snap.exportedAt, 1755830400000);
});

test('导出 → JSON → 导入 的往返完全一致', () => {
  const snap = toSnapshot(data, 1755830400000);
  const restored = fromSnapshot(JSON.parse(JSON.stringify(snap)));
  assert.deepStrictEqual(restored, data);
});

test('空数据的往返也一致', () => {
  const empty = { shops: [], dishes: [], events: [] };
  const restored = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(empty, 1))));
  assert.deepStrictEqual(restored, empty);
});

test('fromSnapshot 拒绝非对象', () => {
  assert.throws(() => fromSnapshot(null), /不是有效/);
  assert.throws(() => fromSnapshot('abc'), /不是有效/);
  assert.throws(() => fromSnapshot(42), /不是有效/);
});

test('fromSnapshot 拒绝版本不匹配', () => {
  assert.throws(() => fromSnapshot({ version: 999, shops: [], dishes: [], events: [] }), /版本/);
});

test('fromSnapshot 拒绝缺失字段', () => {
  assert.throws(() => fromSnapshot({ version: 1, shops: [], dishes: [] }), /events/);
  assert.throws(() => fromSnapshot({ version: 1, dishes: [], events: [] }), /shops/);
});

test('fromSnapshot 拒绝字段不是数组', () => {
  assert.throws(
    () => fromSnapshot({ version: 1, shops: {}, dishes: [], events: [] }), /shops/);
});

test('fromSnapshot 只取三个已知字段，丢弃多余内容', () => {
  const restored = fromSnapshot({ ...toSnapshot(data, 1), 恶意字段: 'x' });
  assert.deepStrictEqual(Object.keys(restored).sort(), ['dishes', 'events', 'shops']);
});

test('snapshotFilename 用本地日期命名', () => {
  const ts = new Date(2026, 7, 22, 23, 30).getTime();
  assert.equal(snapshotFilename(ts), 'meal-2026-08-22.json');
});
