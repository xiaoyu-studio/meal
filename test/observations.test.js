import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceObservations, buildEatenIndex, buildMutedIndex, pendingFeedback, feedbackCandidate, currentPick } from '../src/observations.js';
import { CONFIG } from '../src/config.js';

const at = (dayOffset, hour) =>
  new Date(2026, 7, 22 + dayOffset, hour, 0).getTime();

const ev = (type, dishId, ts, slot = 'lunch', value = null) => ({
  id: `${type}-${dishId}-${ts}`, ts, slot, dishId, type, value,
});

test('只有 recommended，无任何后续动作 → 不带数值', () => {
  const obs = reduceObservations([ev('recommended', 'd1', at(0, 12))]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, null);
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

test('旧的 swapped 事件被忽略，该组等同于无动作', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('swapped', 'd1', at(0, 12) + 5000),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, null);
  assert.equal(obs[0].source, 'none');
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

test('同一顿有多条 recommended 时只留最后一条', () => {
  const obs = reduceObservations([
    ev('recommended', 'a', at(0, 12)),
    ev('recommended', 'b', at(0, 12) + 2000),
    ev('recommended', 'c', at(0, 12) + 4000),
    ev('clicked', 'c', at(0, 12) + 5000),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].dishId, 'c');
  assert.equal(obs[0].value, 0.65);
});

test('被丢弃那条上的反应事件一并丢弃', () => {
  const obs = reduceObservations([
    ev('recommended', 'a', at(0, 12)),
    ev('clicked', 'a', at(0, 12) + 1000),
    ev('recommended', 'b', at(0, 12) + 2000),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].dishId, 'b');
  assert.equal(obs[0].value, null);
});

test('不同饭点、不同日期各自保留自己最后那条', () => {
  const obs = reduceObservations([
    ev('recommended', 'a', at(0, 12), 'lunch'),
    ev('recommended', 'b', at(0, 12) + 1000, 'lunch'),
    ev('recommended', 'c', at(0, 19), 'dinner'),
    ev('recommended', 'd', at(1, 12), 'lunch'),
  ]);
  assert.deepEqual(
    obs.map((o) => [o.dateKey, o.slot, o.dishId]).sort(),
    [
      ['2026-08-22', 'dinner', 'c'],
      ['2026-08-22', 'lunch', 'b'],
      ['2026-08-23', 'lunch', 'd'],
    ].sort(),
  );
});

test('同一顿里划开又划回来时，选中的是最后停留的那道', () => {
  // A → B → 划回 A：A 组的 ts 锚在第一次（targetTs 要靠它），
  // 但这一顿的观察值必须是 A，不能因为 B 的 ts 更晚就选 B。
  const obs = reduceObservations([
    ev('recommended', 'a', at(0, 12)),
    ev('recommended', 'b', at(0, 12) + 2000),
    ev('recommended', 'a', at(0, 12) + 4000),
    ev('clicked', 'a', at(0, 12) + 5000),
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].dishId, 'a');
  assert.equal(obs[0].value, 0.65);
  // ts 仍是最早那次 —— 反馈浮层的 targetTs 回指依赖这一点。
  assert.equal(obs[0].ts, at(0, 12));
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

test('带 targetTs 的事件落到指定的那一组，即使之后有更新的同菜同饭点组', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('recommended', 'd1', at(1, 12)),
    { ...ev('rated', 'd1', at(1, 12) + 60000, 'lunch', 'good'), targetTs: at(0, 12) },
  ]);
  assert.equal(obs.length, 2);
  const [day0, day1] = obs;
  assert.equal(day0.dateKey, '2026-08-22');
  assert.equal(day0.source, 'rated');
  assert.equal(day0.value, 1.0);
  assert.equal(day1.dateKey, '2026-08-23');
  assert.equal(day1.source, 'none');
  assert.equal(day1.eaten, false);
});

test('没有 targetTs 的事件仍走「最近先于它的那一组」启发式', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(0, 12)),
    ev('recommended', 'd1', at(1, 12)),
    ev('rated', 'd1', at(1, 12) + 60000, 'lunch', 'good'),
  ]);
  assert.equal(obs.length, 2);
  assert.equal(obs[0].source, 'none'); // 第一天没被评上
  assert.equal(obs[1].source, 'rated');
  assert.equal(obs[1].value, 1.0);
});

test('targetTs 指向的组已不存在时退回启发式，事件不丢', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', at(1, 12)),
    { ...ev('rated', 'd1', at(1, 13), 'lunch', 'ok'), targetTs: at(0, 12) },
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].source, 'rated');
  assert.equal(obs[0].value, 0.5);
});

test('连续两天推同一道菜，第二天补评第一天：评分不被今天抢走', () => {
  // 8/22 午餐推了 A（无动作）；8/23 午餐又推了 A，浮层补问 8/22 那顿，
  // 用户点「好吃」。评分必须落在 8/22，8/23 那顿仍是未评分状态。
  const obs = reduceObservations([
    ev('recommended', 'A', at(0, 12)),
    ev('recommended', 'A', at(1, 12)),
    { ...ev('rated', 'A', at(1, 12) + 30000, 'lunch', 'good'), targetTs: at(0, 12) },
  ]);
  assert.deepEqual(
    obs.map((o) => [o.dateKey, o.source, o.value, o.eaten]),
    [
      ['2026-08-22', 'rated', 1.0, true],
      ['2026-08-23', 'none', null, false],
    ],
  );

  // 而且 8/23 那顿仍会在第三天被补问 —— 没有被误标成已评分。
  const nextDay = new Date(2026, 7, 24, 12, 0).getTime();
  assert.equal(pendingFeedback(obs, nextDay, 'lunch').dateKey, '2026-08-23');
});

const dishesById = new Map([
  ['d1', { id: 'd1', shopId: 's1', tags: ['川菜', '辣'] }],
  ['d2', { id: 'd2', shopId: 's1', tags: ['川菜'] }],
  ['d3', { id: 'd3', shopId: 's2', tags: ['面食'] }],
]);

const obs = (dishId, dateKey, eaten) => ({
  dishId, dateKey, slot: 'lunch', ts: new Date(`${dateKey}T12:00:00`).getTime(),
  value: eaten ? 1 : null, source: eaten ? 'rated' : 'none',
  ratedValue: eaten ? 'good' : null, eaten,
});

test('buildEatenIndex 只统计真的吃过的观察值', () => {
  const idx = buildEatenIndex(
    [obs('d1', '2026-08-20', true), obs('d3', '2026-08-21', false)],
    dishesById,
  );
  assert.equal(idx.byDish.get('d1'), '2026-08-20');
  assert.equal(idx.byDish.has('d3'), false);
  assert.equal(idx.byShop.has('s2'), false);
});

test('buildEatenIndex 对每个键保留最近的日期', () => {
  const idx = buildEatenIndex(
    [obs('d1', '2026-08-18', true), obs('d1', '2026-08-21', true)],
    dishesById,
  );
  assert.equal(idx.byDish.get('d1'), '2026-08-21');
});

test('buildEatenIndex 按店铺聚合不同菜品', () => {
  const idx = buildEatenIndex(
    [obs('d1', '2026-08-18', true), obs('d2', '2026-08-21', true)],
    dishesById,
  );
  assert.equal(idx.byShop.get('s1'), '2026-08-21');
});

test('buildEatenIndex 按 tag 聚合，一道菜的多个 tag 都记入', () => {
  const idx = buildEatenIndex([obs('d1', '2026-08-20', true)], dishesById);
  assert.equal(idx.byTag.get('川菜'), '2026-08-20');
  assert.equal(idx.byTag.get('辣'), '2026-08-20');
  assert.equal(idx.byTag.has('面食'), false);
});

test('buildEatenIndex 忽略候选池里已不存在的菜品', () => {
  const idx = buildEatenIndex([obs('deleted', '2026-08-20', true)], dishesById);
  assert.equal(idx.byDish.size, 0);
  assert.equal(idx.byShop.size, 0);
});

test('buildEatenIndex 对空输入返回三个空 Map', () => {
  const idx = buildEatenIndex([], dishesById);
  assert.equal(idx.byDish.size, 0);
  assert.equal(idx.byShop.size, 0);
  assert.equal(idx.byTag.size, 0);
});

const NOW = new Date(2026, 7, 22, 12, 0).getTime(); // 本地 2026-08-22 12:00
const obsAt = (dishId, dayOffset, hour, slot, source, ratedValue = null) => ({
  dishId,
  dateKey: `2026-08-${String(22 + dayOffset).padStart(2, '0')}`,
  slot,
  ts: new Date(2026, 7, 22 + dayOffset, hour, 0).getTime(),
  value: 0.5, source, ratedValue, eaten: source === 'rated',
});

test('pendingFeedback 对空历史返回 null', () => {
  assert.equal(pendingFeedback([], NOW, 'lunch'), null);
});

test('pendingFeedback 补问昨晚未评分的那顿', () => {
  const r = pendingFeedback(
    [obsAt('d1', -1, 19, 'dinner', 'clicked')], NOW, 'lunch');
  assert.equal(r.dishId, 'd1');
});

test('pendingFeedback 跳过当前这一顿', () => {
  const r = pendingFeedback(
    [obsAt('d1', 0, 12, 'lunch', 'clicked')], NOW, 'lunch');
  assert.equal(r, null);
});

test('pendingFeedback 跳过已评分的', () => {
  const r = pendingFeedback(
    [obsAt('d1', -1, 19, 'dinner', 'rated', 'good')], NOW, 'lunch');
  assert.equal(r, null);
});

test('pendingFeedback 补问推了但毫无动作的那顿', () => {
  const r = pendingFeedback(
    [obsAt('d1', -1, 19, 'dinner', 'none')], NOW, 'lunch');
  assert.equal(r.dishId, 'd1');
});

test('pendingFeedback 只看最近一条，不翻旧账', () => {
  const r = pendingFeedback([
    obsAt('old', -3, 12, 'lunch', 'clicked'),
    obsAt('recent', -1, 19, 'dinner', 'rated', 'ok'),
  ], NOW, 'lunch');
  assert.equal(r, null);
});

test('pendingFeedback 在同一顿换过再点的情况下问最后点的那个', () => {
  const r = pendingFeedback([
    obsAt('a', -1, 19, 'dinner', 'none'),
    { ...obsAt('b', -1, 19, 'dinner', 'clicked'), ts: new Date(2026, 7, 21, 19, 5).getTime() },
  ], NOW, 'lunch');
  assert.equal(r.dishId, 'b');
});

const evt = (type, dishId, hour, minute = 0, slot = 'lunch') => ({
  id: `${type}-${dishId}-${hour}${minute}`,
  ts: new Date(2026, 7, 22, hour, minute).getTime(),
  slot, dishId, type, value: null,
});

test('currentPick 对空事件返回无选择', () => {
  const p = currentPick([], 'lunch', '2026-08-22');
  assert.deepEqual(p, { activeDishId: null, activeReason: null });
});

test('currentPick 返回这一顿最后一条推荐及其理由', () => {
  const p = currentPick([
    { ...evt('recommended', 'a', 12), value: '还没试过，试试看' },
    { ...evt('recommended', 'b', 12, 30), value: '你上次说好吃' },
  ], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, 'b');
  assert.equal(p.activeReason, '你上次说好吃');
});

test('currentPick 对没存理由的旧事件返回 null 理由', () => {
  const p = currentPick([evt('recommended', 'a', 12)], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, 'a');
  assert.equal(p.activeReason, null);
});

test('currentPick 对 value 是数字的异常事件也返回 null 理由', () => {
  // 守卫的现实来源是导入的旧快照 —— fromSnapshot 只校验 id，value 可能是任意东西。
  const p = currentPick([{ ...evt('recommended', 'a', 12), value: 42 }], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, 'a');
  assert.equal(p.activeReason, null);
});

test('currentPick 忽略其他饭点和其他日期的事件', () => {
  const p = currentPick([
    evt('recommended', 'x', 12, 0, 'dinner'),
    { ...evt('recommended', 'y', 12), ts: new Date(2026, 7, 21, 12, 0).getTime() },
  ], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, null);
});

test('currentPick 忽略非 recommended 的事件', () => {
  const p = currentPick([
    { ...evt('recommended', 'a', 12), value: '换换口味' },
    evt('clicked', 'a', 12, 5),
    evt('muted', 'a', 12, 6),
  ], 'lunch', '2026-08-22');
  assert.equal(p.activeDishId, 'a');
  assert.equal(p.activeReason, '换换口味');
});

test('buildMutedIndex 取每道菜最近一次 muted 的日期', () => {
  const idx = buildMutedIndex([
    ev('muted', 'd1', at(0, 12)),
    ev('muted', 'd1', at(2, 12)),
    ev('muted', 'd2', at(1, 12)),
    ev('recommended', 'd3', at(1, 12)),
  ]);
  assert.equal(idx.get('d1'), '2026-08-24');
  assert.equal(idx.get('d2'), '2026-08-23');
  assert.equal(idx.get('d3'), undefined);
});

// ---- 2026-09-13：事件自带 dateKey（spec 2026-09-13 §3）----

const late = (d, h, m) => new Date(2026, 8, d, h, m).getTime(); // 本地 2026-09-d h:m

test('带 dateKey 的 recommended 按 dateKey 分组，而不是写入时刻', () => {
  // 23:55 打开、00:05 才补写：写入时刻已是 9/12，但这顿属于 9/11
  const obs = reduceObservations([
    { ...ev('recommended', 'B', late(12, 0, 5), 'dinner'), dateKey: '2026-09-11' },
  ]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].dateKey, '2026-09-11');
});

test('跨零点下单：只留下前一天那顿，且落在下单的那道菜上', () => {
  const events = [
    { ...ev('recommended', 'A', late(11, 23, 55), 'dinner', '还没试过，试试看'), dateKey: '2026-09-11' },
    { ...ev('recommended', 'B', late(12, 0, 5), 'dinner', '同类里最便宜'), dateKey: '2026-09-11' },
    { ...ev('clicked', 'B', late(12, 0, 5) + 1000, 'dinner'), dateKey: '2026-09-11' },
  ];
  assert.deepEqual(
    reduceObservations(events).map((o) => [o.dateKey, o.slot, o.dishId, o.source]),
    [['2026-09-11', 'dinner', 'B', 'clicked']],
  );
});

test('currentPick 认事件自带的 dateKey：跨零点下单不会预先定下第二天那顿', () => {
  const events = [
    { ...ev('recommended', 'A', late(11, 23, 55), 'dinner', '还没试过，试试看'), dateKey: '2026-09-11' },
    { ...ev('recommended', 'B', late(12, 0, 5), 'dinner', '同类里最便宜'), dateKey: '2026-09-11' },
  ];
  assert.equal(currentPick(events, 'dinner', '2026-09-12').activeDishId, null);
  assert.equal(currentPick(events, 'dinner', '2026-09-11').activeDishId, 'B');
});

test('带 dateKey 的 clicked 落到 dateKey 指定的那一组，即使启发式会挑另一组', () => {
  const obs = reduceObservations([
    // 9/11 晚餐那顿，00:05 补写
    { ...ev('recommended', 'B', late(12, 0, 5), 'dinner'), dateKey: '2026-09-11' },
    // 另一组：没有 dateKey 的老事件，按写入时刻归到 9/12，且更接近点击时刻
    ev('recommended', 'B', late(12, 0, 10), 'dinner'),
    // 点击属于 9/11 那顿；「ts 最大且 <= 点击时刻」的启发式会挑 00:10 那组
    { ...ev('clicked', 'B', late(12, 0, 15), 'dinner'), dateKey: '2026-09-11' },
  ]);
  assert.deepEqual(
    obs.map((o) => [o.dateKey, o.source]),
    [['2026-09-11', 'clicked'], ['2026-09-12', 'none']],
  );
});

// ---- 2026-09-13：补问时机（spec 2026-09-13 §4）----

test('观察值带 clickedTs：组内最后一次点下单的时刻，没点过为 null', () => {
  const obs = reduceObservations([
    ev('recommended', 'd1', late(11, 12, 0)),
    ev('clicked', 'd1', late(11, 12, 3)),
    ev('clicked', 'd1', late(11, 12, 7)),
    ev('recommended', 'd2', late(11, 19, 0), 'dinner'),
  ]);
  assert.equal(obs[0].clickedTs, late(11, 12, 7));
  assert.equal(obs[1].clickedTs, null);
});

const DELAY_MS = CONFIG.FEEDBACK_DELAY_MINUTES * 60 * 1000;

// 手工构造观察值；dateKey 与 ts 同在本地 2026-09-d
const meal = (dishId, d, h, m, slot, source, clickedTs = null) => ({
  dishId,
  dateKey: `2026-09-${String(d).padStart(2, '0')}`,
  slot,
  ts: late(d, h, m),
  value: source === 'none' ? null : 0.5,
  source,
  ratedValue: source === 'rated' ? 'ok' : null,
  eaten: source === 'rated',
  clickedTs,
});

test('下单才 10 分钟、已换饭点：不补问，但 feedbackCandidate 仍能挑出它', () => {
  const observations = [meal('burger', 11, 10, 25, 'breakfast', 'clicked', late(11, 10, 26))];
  const now = late(11, 10, 36);
  assert.equal(pendingFeedback(observations, now, 'lunch'), null);
  assert.equal(feedbackCandidate(observations, now, 'lunch').dishId, 'burger');
});

test('离下单恰好满推迟时长时补问，差 1 毫秒则不问', () => {
  const clickedAt = late(11, 10, 26);
  const observations = [meal('burger', 11, 10, 25, 'breakfast', 'clicked', clickedAt)];
  assert.equal(pendingFeedback(observations, clickedAt + DELAY_MS, 'lunch').dishId, 'burger');
  assert.equal(pendingFeedback(observations, clickedAt + DELAY_MS - 1, 'lunch'), null);
});

test('边界前下单的那顿，不会被之后一条没点过的推荐挡住', () => {
  const observations = [
    meal('burger', 11, 10, 25, 'breakfast', 'clicked', late(11, 10, 26)),
    meal('noodle', 11, 10, 35, 'lunch', 'none'), // 10:35 打开时为午餐写下的，没点
  ];
  assert.equal(pendingFeedback(observations, late(11, 12, 30), 'lunch').dishId, 'burger');
  assert.equal(pendingFeedback(observations, late(11, 18, 0), 'dinner').dishId, 'burger');
});

test('推迟期间不拿更新的、没点过的记录顶上', () => {
  // 早餐那顿的卡片一直开着，17:50 才点下单；中间另有一条没点过的午餐记录。
  // 若推迟期间改问午餐，用户随手一答，早餐就因早于「最近已评分」而永远问不到。
  const observations = [
    meal('burger', 11, 10, 25, 'breakfast', 'clicked', late(11, 17, 50)),
    meal('rice', 11, 12, 0, 'lunch', 'none'),
  ];
  const now = late(11, 18, 0);
  assert.equal(pendingFeedback(observations, now, 'dinner'), null);
  assert.equal(feedbackCandidate(observations, now, 'dinner').dishId, 'burger');
});

test('早于最近一顿已评分的下单记录不算候选，退回旧规则', () => {
  // 在旧代码上本就通过；防的是漏掉「晚于最近已评分」限制的错误实现 ——
  // 那样会把两天前的 burger 翻出来追问（spec §6.1 第 10 条）。
  const observations = [
    meal('burger', 9, 12, 0, 'lunch', 'clicked', late(9, 12, 1)),
    meal('soup', 10, 19, 0, 'dinner', 'rated'),
    meal('rice', 11, 12, 0, 'lunch', 'none'),
  ];
  assert.equal(pendingFeedback(observations, late(11, 19, 0), 'dinner').dishId, 'rice');
});

test('当前这顿下过单也不算候选；更早一顿下过单的照样问', () => {
  const observations = [
    meal('burger', 11, 8, 0, 'breakfast', 'clicked', late(11, 8, 1)),
    meal('noodle', 11, 12, 0, 'lunch', 'clicked', late(11, 12, 5)),
  ];
  assert.equal(pendingFeedback(observations, late(11, 14, 30), 'lunch').dishId, 'burger');
});

test('连着下两顿：先问早餐，评完再问午餐', () => {
  const breakfast = meal('burger', 11, 10, 25, 'breakfast', 'clicked', late(11, 10, 26));
  const lunch = meal('noodle', 11, 11, 0, 'lunch', 'clicked', late(11, 11, 1));
  assert.equal(pendingFeedback([breakfast, lunch], late(11, 13, 0), 'lunch').dishId, 'burger');

  const rated = { ...breakfast, source: 'rated', ratedValue: 'ok', eaten: true };
  assert.equal(pendingFeedback([rated, lunch], late(11, 15, 30), 'dinner').dishId, 'noodle');
});

// ---- 2026-09-14：取消静音（spec 2026-09-14 §3.2、§5.1）----

test('静音后取消 → 不在静音索引里', () => {
  const idx = buildMutedIndex([
    ev('muted', 'd1', at(0, 12)),
    ev('unmuted', 'd1', at(4, 12), null),
  ]);
  assert.equal(idx.has('d1'), false);
});

test('静音与取消 ts 相等 → 算已取消', () => {
  const ts = at(0, 12);
  const idx = buildMutedIndex([
    ev('muted', 'd1', ts),
    ev('unmuted', 'd1', ts, null),
  ]);
  assert.equal(idx.has('d1'), false);
});

test('取消只影响被取消的那道菜', () => {
  const idx = buildMutedIndex([
    ev('muted', 'd1', at(0, 12)),
    ev('muted', 'd2', at(1, 12)),
    ev('unmuted', 'd1', at(2, 12), null),
  ]);
  assert.equal(idx.has('d1'), false);
  assert.equal(idx.get('d2'), '2026-08-23');
});

test('取消之后再静音 → 以再静音那天为准', () => {
  const idx = buildMutedIndex([
    ev('muted', 'd1', at(0, 12)),
    ev('unmuted', 'd1', at(4, 12), null),
    ev('muted', 'd1', at(9, 12)),
  ]);
  assert.equal(idx.get('d1'), '2026-08-31');
});

test('先取消后静音 → 静音有效', () => {
  const idx = buildMutedIndex([
    ev('unmuted', 'd1', at(0, 12), null),
    ev('muted', 'd1', at(4, 12)),
  ]);
  assert.equal(idx.get('d1'), '2026-08-26');
});

test('只有取消没有静音 → 不在静音索引里', () => {
  const idx = buildMutedIndex([
    ev('unmuted', 'd1', at(0, 12), null),
  ]);
  assert.equal(idx.has('d1'), false);
});

test('同一天先静音、几小时后取消 → 已取消（先后比 ts 不比日期）', () => {
  const idx = buildMutedIndex([
    ev('muted', 'd1', at(0, 10)),
    ev('unmuted', 'd1', at(0, 15), null),
  ]);
  assert.equal(idx.has('d1'), false);
});

test('同一天先取消、几小时后又静音 → 静音有效（按日期比会误判成已取消）', () => {
  const idx = buildMutedIndex([
    ev('unmuted', 'd1', at(0, 10), null),
    ev('muted', 'd1', at(0, 15)),
  ]);
  assert.equal(idx.get('d1'), '2026-08-22');
});

test('slot 为 null 的 unmuted 不影响 reduceObservations', () => {
  const base = [
    ev('recommended', 'd1', at(0, 12)),
    ev('clicked', 'd1', at(0, 12) + 60000),
  ];
  const withUnmute = [...base, ev('unmuted', 'd1', at(0, 13), null)];
  assert.deepEqual(reduceObservations(withUnmute), reduceObservations(base));
});
