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

  // 三个 store 的 keyPath 都是 id。缺 id 的行会让 put() 抛出 WebKit 的
  // 英文 DataError，那是全应用最后一条会把英文报错甩给用户的路径 ——
  // 在这里拦住，换成说得清是哪一批数据出了问题的中文提示。
  for (const key of ['shops', 'dishes', 'events']) {
    for (const [i, row] of obj[key].entries()) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`导入失败：${key} 第 ${i + 1} 条不是一个对象`);
      }
      if (typeof row.id !== 'string' || row.id === '') {
        throw new Error(`导入失败：${key} 第 ${i + 1} 条缺少 id`);
      }
    }
  }

  return { shops: obj.shops, dishes: obj.dishes, events: obj.events };
}

/** 备份文件名，用本地日期，便于在「文件」App 里辨认。 */
export function snapshotFilename(exportedAt) {
  return `meal-${localDateKey(exportedAt)}.json`;
}
