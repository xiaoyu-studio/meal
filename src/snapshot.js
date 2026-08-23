import { localDateKey } from './dates.js';

export const SNAPSHOT_VERSION = 1;

/** 打包成可写入文件的快照对象。 */
export function toSnapshot({ shops, dishes, events }, exportedAt) {
  return { version: SNAPSHOT_VERSION, exportedAt, shops, dishes, events };
}

/**
 * 校验并解包快照。这是用户唯一的备份还原路径，
 * 因此宁可报错也不做任何容错猜测。
 */
export function fromSnapshot(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('导入失败：不是有效的备份文件');
  }
  if (obj.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `导入失败：备份版本不匹配（需要 ${SNAPSHOT_VERSION}，文件里是 ${obj.version}）`,
    );
  }
  for (const key of ['shops', 'dishes', 'events']) {
    if (!Array.isArray(obj[key])) {
      throw new Error(`导入失败：字段 ${key} 缺失或不是数组`);
    }
  }
  return { shops: obj.shops, dishes: obj.dishes, events: obj.events };
}

/** 备份文件名，用本地日期，便于在「文件」App 里辨认。 */
export function snapshotFilename(exportedAt) {
  return `meal-${localDateKey(exportedAt)}.json`;
}
