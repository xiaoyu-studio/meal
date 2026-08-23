import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCandidates } from '../src/recommender.js';

const shops = [
  { id: 's1', name: '张记', platform: 'meituan', link: 'https://x/1', hygiene: 'unknown' },
  { id: 's2', name: '李记', platform: 'eleme', link: 'https://x/2', hygiene: 'blocked' },
  { id: 's3', name: '王记', platform: 'meituan', link: 'https://x/3', hygiene: 'trusted' },
];

const dish = (id, shopId, over = {}) => ({
  id, shopId, name: `菜${id}`, refPrice: 20, tags: ['家常'],
  slots: ['lunch', 'dinner'], active: true, ...over,
});

test('放行符合条件的菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's1')], shops, slot: 'lunch', excludedDishIds: [],
  });
  assert.deepEqual(out.map((d) => d.id), ['d1']);
});

test('剔除被拉黑店铺的菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's1'), dish('d2', 's2')],
    shops, slot: 'lunch', excludedDishIds: [],
  });
  assert.deepEqual(out.map((d) => d.id), ['d1']);
});

test('剔除已停用的菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's1', { active: false })],
    shops, slot: 'lunch', excludedDishIds: [],
  });
  assert.deepEqual(out, []);
});

test('剔除饭点不匹配的菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's1')], shops, slot: 'breakfast', excludedDishIds: [],
  });
  assert.deepEqual(out, []);
});

test('剔除本顿已被换掉的菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's1'), dish('d2', 's3')],
    shops, slot: 'lunch', excludedDishIds: ['d1'],
  });
  assert.deepEqual(out.map((d) => d.id), ['d2']);
});

test('剔除店铺已不存在的孤儿菜品', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 'ghost')], shops, slot: 'lunch', excludedDishIds: [],
  });
  assert.deepEqual(out, []);
});

test('excludedDishIds 省略时默认为空', () => {
  const out = filterCandidates({ dishes: [dish('d1', 's1')], shops, slot: 'lunch' });
  assert.equal(out.length, 1);
});

test('全部被拉黑时返回空数组', () => {
  const out = filterCandidates({
    dishes: [dish('d1', 's2')], shops, slot: 'lunch', excludedDishIds: [],
  });
  assert.deepEqual(out, []);
});
