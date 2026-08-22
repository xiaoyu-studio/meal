import { SLOT_BOUNDARIES } from './config.js';

/** 时间戳 → 本地时区的 'YYYY-MM-DD'。 */
export function localDateKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 两个日期键之间的自然日差。fromKey 为空时返回 Infinity（表示"从未发生"）。
 * 用 Math.round 而非 Math.floor，以吸收夏令时导致的 ±1 小时偏差。
 */
export function daysBetweenKeys(fromKey, toKey) {
  if (!fromKey) return Infinity;
  const from = new Date(`${fromKey}T00:00:00`).getTime();
  const to = new Date(`${toKey}T00:00:00`).getTime();
  return Math.round((to - from) / 86400000);
}

/** 按本地时间推断当前是哪一顿。 */
export function slotFromTime(ts) {
  const d = new Date(ts);
  const minutes = d.getHours() * 60 + d.getMinutes();
  if (minutes < SLOT_BOUNDARIES.breakfastEnd) return 'breakfast';
  if (minutes < SLOT_BOUNDARIES.lunchEnd) return 'lunch';
  return 'dinner';
}
