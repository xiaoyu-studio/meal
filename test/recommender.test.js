import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCandidates, tasteOf } from '../src/recommender.js';
import { CONFIG } from '../src/config.js';

const DAY = 86400000;
const NOW = new Date(2026, 7, 22, 12, 0).getTime();

const shops = [
  { id: 's1', name: '张记', platform: 'meituan', link: 'https://x/1', hygiene: 'unknown' },
  { id: 's2', name: '李记', platform: 'eleme', link: 'https://x/2', hygiene: 'blocked' },
  { id: 's3', name: '王记', platform: 'meituan', link: 'https://x/3', hygiene: 'trusted' },
];

const dish = (id, shopId, over = {}) => ({
  id, shopId, name: `菜${id}`, refPrice: 20, tags: ['家常'],
  slots: ['lunch', 'dinner'], active: true, ...over,
});

const o = (value, daysAgo) => ({
  dishId: 'd1', dateKey: 'x', slot: 'lunch', ts: NOW - daysAgo * DAY,
  value, source: 'rated', ratedValue: null, eaten: true,
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

test('零观察值时用乐观初始化 0.7', () => {
  assert.equal(tasteOf([], NOW), CONFIG.COLD_START_TASTE);
  assert.equal(tasteOf([], NOW), 0.7);
});

test('单条 good 得 1.0', () => {
  assert.equal(tasteOf([o(1.0, 0)], NOW), 1.0);
});

test('单条 bad 得 0.0', () => {
  assert.equal(tasteOf([o(0.0, 0)], NOW), 0.0);
});

test('同日两条取平均', () => {
  assert.equal(tasteOf([o(1.0, 0), o(0.0, 0)], NOW), 0.5);
});

test('半衰期 60 天：60 天前的权重恰为今天的一半', () => {
  // 今天 bad(0) 权重 1；60 天前 good(1) 权重 0.5 → (0 + 0.5) / 1.5 = 1/3
  const t = tasteOf([o(0.0, 0), o(1.0, 60)], NOW);
  assert.ok(Math.abs(t - 1 / 3) < 1e-9, `期望 ≈0.3333，实际 ${t}`);
});

test('近期评价压过久远评价', () => {
  const recent = tasteOf([o(1.0, 1), o(0.0, 200)], NOW);
  const stale = tasteOf([o(0.0, 1), o(1.0, 200)], NOW);
  assert.ok(recent > 0.8, `期望 >0.8，实际 ${recent}`);
  assert.ok(stale < 0.2, `期望 <0.2，实际 ${stale}`);
});

test('结果恒在 [0,1] 区间内', () => {
  const t = tasteOf([o(0.65, 3), o(0.2, 10), o(0.45, 30)], NOW);
  assert.ok(t >= 0 && t <= 1);
});
