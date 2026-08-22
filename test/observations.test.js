import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceObservations } from '../src/observations.js';

const at = (dayOffset, hour) =>
  new Date(2026, 7, 22 + dayOffset, hour, 0).getTime();

const ev = (type, dishId, ts, slot = 'lunch', value = null) => ({
  id: `${type}-${dishId}-${ts}`, ts, slot, dishId, type, value,
});

test('只有 recommended，无任何后续动作 → 0.45', () => {
  const obs = reduceObservations([ev('recommended', 'd1', at(0, 12))]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 0.45);
  assert.equal(obs[0].source, 'none');
  assert.equal(obs[0].eaten, false);
});

test('clicked 未被 rated 覆盖 → 0.65', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('clicked', 'd1', at(0, 12) + 60000),
  ]);
  assert.equal(obs[0].value, 0.65);
  assert.equal(obs[0].source, 'clicked');
});

test('swapped → 0.2', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('swapped', 'd1', at(0, 12) + 5000),
  ]);
  assert.equal(obs[0].value, 0.2);
  assert.equal(obs[0].source, 'swapped');
});

test('rated 优先级高于 clicked', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('clicked', 'd1', at(0, 12) + 60000),
    ev('rated', 'd1', at(1, 12), 'lunch', 'good'),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 1.0);
  assert.equal(obs[0].source, 'rated');
  assert.equal(obs[0].ratedValue, 'good');
  assert.equal(obs[0].eaten, true);
});

test('skipped 记为 0.4 且不算吃过', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('clicked', 'd1', at(0, 12) + 60000),
    ev('rated', 'd1', at(1, 12), 'lunch', 'skipped'),
  ]);
  assert.equal(obs[0].value, 0.4);
  assert.equal(obs[0].eaten, false);
});

test('rated bad 算吃过（吃了但难吃）', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('rated', 'd1', at(1, 12), 'lunch', 'bad'),
  ]);
  assert.equal(obs[0].value, 0.0);
  assert.equal(obs[0].eaten, true);
});

test('没有 recommended 的事件组被忽略', () => {
  const obs = reduceObservations([ev('clicked', 'd1', at(0, 12))]);
  assert.equal(obs.length, 0);
});

test('同一顿换两次产生三条独立观察值', () => {
  const obs = reduceObservations([
    ev('recommended', 'a', at(0, 12)),
    ev('swapped', 'a', at(0, 12) + 1000),
    ev('recommended', 'b', at(0, 12) + 2000),
    ev('swapped', 'b', at(0, 12) + 3000),
    ev('recommended', 'c', at(0, 12) + 4000),
    ev('clicked', 'c', at(0, 12) + 5000),
  ]);
  assert.equal(obs.length, 3);
  assert.deepEqual(obs.map((o) => o.dishId), ['a', 'b', 'c']);
  assert.deepEqual(obs.map((o) => o.value), [0.2, 0.2, 0.65]);
});

test('同一天不同饭点的同一道菜是两条观察值', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12), 'lunch'),
    ev('recommended', 'd1', at(0, 19), 'dinner'),
  ]);
  assert.equal(obs.length, 2);
});

test('页面重载导致的重复 recommended 被折叠为一条', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('recommended', 'd1', at(0, 12) + 30000),
    ev('clicked', 'd1', at(0, 12) + 60000),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 0.65);
});

test('返回结果按 ts 升序', () => {
  const obs = reduceObservations([
    ev('recommended', 'b', at(2, 12)),
    ev('recommended', 'a', at(0, 12)),
    ev('recommended', 'c', at(1, 12)),
  ]);
  assert.deepEqual(obs.map((o) => o.dishId), ['a', 'c', 'b']);
});

test('跨天无反应的同菜同饭点产生两条不同的观察值', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12), 'lunch'),
    ev('recommended', 'd1', at(3, 12), 'lunch'),
  ]);
  assert.equal(obs.length, 2);
  assert.deepEqual(obs.map((o) => o.dateKey), ['2026-08-22', '2026-08-25']);
  assert.deepEqual(obs.map((o) => o.dishId), ['d1', 'd1']);
  assert.deepEqual(obs.map((o) => o.slot), ['lunch', 'lunch']);
});

test('多个 rated 事件，最后一个赢', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('rated', 'd1', at(0, 13), 'lunch', 'ok'),
    ev('rated', 'd1', at(1, 14), 'lunch', 'good'),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 1.0);
  assert.equal(obs[0].ratedValue, 'good');
});
