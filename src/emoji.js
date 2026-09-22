import { DISH_EMOJI, DEFAULT_DISH_EMOJI } from './config.js';

/**
 * 按菜名猜一个 emoji。表的顺序就是优先级（见 config.js 里 DISH_EMOJI 的注释）：
 * 命中第一个就返回，全不中退回通用图标。
 *
 * 纯函数：不碰时钟、随机数、DOM、存储。
 */
export function dishEmoji(name) {
  if (typeof name !== 'string' || name === '') return DEFAULT_DISH_EMOJI;
  for (const [keywords, emoji] of DISH_EMOJI) {
    if (keywords.some((k) => name.includes(k))) return emoji;
  }
  return DEFAULT_DISH_EMOJI;
}
