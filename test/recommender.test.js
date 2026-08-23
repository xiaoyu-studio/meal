import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCandidates, tasteOf, effectivePriceOf, valueOf } from '../src/recommender.js';
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

const paidEvt = (dishId, ts, amount) => ({
  id: `p${ts}`, ts, slot: 'lunch', dishId, type: 'paid', value: amount,
});

test('effectivePriceOf 无 paid 事件时用参考价', () => {
  assert.equal(effectivePriceOf(dish('d1', 's1', { refPrice: 25 }), []), 25);
});

test('effectivePriceOf 优先用实付价', () => {
  const d = dish('d1', 's1', { refPrice: 25 });
  assert.equal(effectivePriceOf(d, [paidEvt('d1', 1000, 31.5)]), 31.5);
});

test('effectivePriceOf 取最近一次实付价', () => {
  const d = dish('d1', 's1', { refPrice: 25 });
  const events = [paidEvt('d1', 1000, 31.5), paidEvt('d1', 5000, 28)];
  assert.equal(effectivePriceOf(d, events), 28);
});

test('effectivePriceOf 在事件乱序时仍取 ts 最大的一条', () => {
  const d = dish('d1', 's1', { refPrice: 25 });
  const events = [paidEvt('d1', 5000, 28), paidEvt('d1', 1000, 31.5)];
  assert.equal(effectivePriceOf(d, events), 28);
});

test('effectivePriceOf 忽略别的菜的实付价', () => {
  const d = dish('d1', 's1', { refPrice: 25 });
  assert.equal(effectivePriceOf(d, [paidEvt('d2', 5000, 99)]), 25);
});

test('valueOf 在候选集只有一个时返回 0.5', () => {
  assert.equal(valueOf(20, [20]), 0.5);
});

test('valueOf 给最便宜的满分、最贵的零分', () => {
  const prices = [10, 20, 30];
  assert.equal(valueOf(10, prices), 1);
  assert.equal(valueOf(20, prices), 0.5);
  assert.equal(valueOf(30, prices), 0);
});

test('valueOf 对并列价格给相同分数', () => {
  const prices = [10, 10, 20];
  assert.equal(valueOf(10, prices), valueOf(10, prices));
  assert.equal(valueOf(10, prices), 1);
  assert.equal(valueOf(20, prices), 0);
});

test('valueOf 自适应消费水平，只看相对位置', () => {
  // 绝对价格翻十倍，相对排序不变，分数也不变
  assert.equal(valueOf(20, [10, 20, 30]), valueOf(200, [100, 200, 300]));
});

test('valueOf 结果恒在 [0,1] 区间内', () => {
  const prices = [8, 15, 22, 40, 40, 6];
  for (const p of prices) {
    const v = valueOf(p, prices);
    assert.ok(v >= 0 && v <= 1, `${p} → ${v}`);
  }
});

import { fatigueOf } from '../src/recommender.js';

const TODAY = '2026-08-22';
const daysBefore = (n) => {
  const d = new Date(2026, 7, 22);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('从未吃过时三个因子都是 1', () => {
  const f = fatigueOf({ nowKey: TODAY });
  assert.equal(f.fDish, 1);
  assert.equal(f.fShop, 1);
  assert.equal(f.fTag, 1);
  assert.equal(f.total, 1);
});

test('今天刚吃过这道菜时被压到下限', () => {
  const f = fatigueOf({ dishLastEatenKey: TODAY, nowKey: TODAY });
  assert.equal(f.fDish, 0);
  assert.equal(f.total, CONFIG.FATIGUE_FLOOR);
});

test('菜品衰减符合 1 - exp(-d/7)', () => {
  const f = fatigueOf({ dishLastEatenKey: daysBefore(7), nowKey: TODAY });
  assert.ok(Math.abs(f.fDish - (1 - Math.exp(-1))) < 1e-9);
  assert.ok(Math.abs(f.fDish - 0.6321205588) < 1e-6, `实际 ${f.fDish}`);
});

test('菜品衰减的手感符合 spec 给出的四个刻度', () => {
  const at = (n) => fatigueOf({ dishLastEatenKey: daysBefore(n), nowKey: TODAY }).fDish;
  assert.ok(Math.abs(at(3) - 0.35) < 0.01, `3 天 → ${at(3)}`);
  assert.ok(Math.abs(at(7) - 0.63) < 0.01, `7 天 → ${at(7)}`);
  assert.ok(Math.abs(at(14) - 0.86) < 0.01, `14 天 → ${at(14)}`);
  assert.ok(Math.abs(at(30) - 0.99) < 0.01, `30 天 → ${at(30)}`);
});

test('店铺衰减的惩罚上限为 50%', () => {
  const sameDay = fatigueOf({ shopLastEatenKey: TODAY, nowKey: TODAY });
  assert.equal(sameDay.fShop, 0.5);
  const f = fatigueOf({ shopLastEatenKey: daysBefore(3), nowKey: TODAY });
  assert.ok(Math.abs(f.fShop - (1 - 0.5 * Math.exp(-1))) < 1e-9);
});

test('tag 衰减的惩罚上限为 30%', () => {
  const sameDay = fatigueOf({ tagLastEatenKeys: [TODAY], nowKey: TODAY });
  assert.ok(Math.abs(sameDay.fTag - 0.7) < 1e-9);
  const f = fatigueOf({ tagLastEatenKeys: [daysBefore(2)], nowKey: TODAY });
  assert.ok(Math.abs(f.fTag - (1 - 0.3 * Math.exp(-1))) < 1e-9);
});

test('多个 tag 时最近吃过的那个说了算', () => {
  const f = fatigueOf({
    tagLastEatenKeys: [daysBefore(30), daysBefore(1)], nowKey: TODAY,
  });
  const onlyRecent = fatigueOf({ tagLastEatenKeys: [daysBefore(1)], nowKey: TODAY });
  assert.equal(f.fTag, onlyRecent.fTag);
});

test('空 tag 数组等同于从未吃过', () => {
  assert.equal(fatigueOf({ tagLastEatenKeys: [], nowKey: TODAY }).fTag, 1);
});

test('total 是三个因子之积', () => {
  const f = fatigueOf({
    dishLastEatenKey: daysBefore(10),
    shopLastEatenKey: daysBefore(4),
    tagLastEatenKeys: [daysBefore(2)],
    nowKey: TODAY,
  });
  assert.ok(Math.abs(f.total - f.fDish * f.fShop * f.fTag) < 1e-9);
});

test('total 恒在 (0,1] 区间内', () => {
  const f = fatigueOf({
    dishLastEatenKey: TODAY, shopLastEatenKey: TODAY,
    tagLastEatenKeys: [TODAY], nowKey: TODAY,
  });
  assert.ok(f.total > 0 && f.total <= 1);
});
