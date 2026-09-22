import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dishEmoji } from '../src/emoji.js';
import { DEFAULT_DISH_EMOJI } from '../src/config.js';

test('dishEmoji 按关键字命中', () => {
  assert.equal(dishEmoji('招牌汉堡四件套'), '🍔');
  assert.equal(dishEmoji('豚骨拉面'), '🍜');
  assert.equal(dishEmoji('番茄鸡蛋盖浇饭'), '🍚');
});

test('dishEmoji 表的顺序就是优先级', () => {
  // 「面」排在「鸡」前面，鸡汤面应当出面而不是鸡
  assert.equal(dishEmoji('鸡汤面'), '🍜');
  // 「粉」也归到面食
  assert.equal(dishEmoji('螺蛳粉'), '🍜');
});

test('dishEmoji 一个都不中就退回通用图标', () => {
  assert.equal(dishEmoji('佛跳墙'), DEFAULT_DISH_EMOJI);
  assert.equal(dishEmoji(''), DEFAULT_DISH_EMOJI);
});

test('dishEmoji 对非字符串不抛异常', () => {
  assert.equal(dishEmoji(null), DEFAULT_DISH_EMOJI);
  assert.equal(dishEmoji(undefined), DEFAULT_DISH_EMOJI);
});

test('dishEmoji 对超长菜名照常工作', () => {
  assert.equal(dishEmoji('超级无敌豪华双层芝士培根汉堡加大薯条套餐'.repeat(3)), '🍔');
});
