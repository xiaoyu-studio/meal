import { CONFIG, EATEN_RATINGS } from './config.js';
import { localDateKey } from './dates.js';

/**
 * 把原始事件流压成观察值：一条观察值 = 一顿饭里的一道菜。
 * 分组键为「饭点 + 菜品」，不包含日期。同一顿内的重复 recommended
 * （例如用户重载页面）会自然折叠为一条。
 * dateKey 来自该分组内的 recommended 事件。
 */
export function reduceObservations(events) {
  const groups = new Map();
  for (const e of events) {
    const key = `${e.slot}|${e.dishId}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(e);
  }

  const out = [];
  for (const [key, list] of groups) {
    const recommended = list
      .filter((e) => e.type === 'recommended')
      .sort((a, b) => a.ts - b.ts)[0];
    if (!recommended) continue;

    const rated = list.find((e) => e.type === 'rated');
    const swapped = list.find((e) => e.type === 'swapped');
    const clicked = list.find((e) => e.type === 'clicked');

    let value;
    let source;
    if (rated) {
      value = CONFIG.RATING_VALUES[rated.value] ?? CONFIG.IMPLICIT_NO_ACTION;
      source = 'rated';
    } else if (swapped) {
      value = CONFIG.IMPLICIT_SWAPPED;
      source = 'swapped';
    } else if (clicked) {
      value = CONFIG.IMPLICIT_CLICKED;
      source = 'clicked';
    } else {
      value = CONFIG.IMPLICIT_NO_ACTION;
      source = 'none';
    }

    const dateKey = localDateKey(recommended.ts);
    const [slot, dishId] = key.split('|');
    out.push({
      dishId,
      dateKey,
      slot,
      ts: recommended.ts,
      value,
      source,
      ratedValue: rated ? rated.value : null,
      eaten: rated ? EATEN_RATINGS.includes(rated.value) : false,
    });
  }

  return out.sort((a, b) => a.ts - b.ts);
}
