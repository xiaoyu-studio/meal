export const CONFIG = {
  W_TASTE: 0.7,
  W_VALUE: 0.3,
  TASTE_HALFLIFE_DAYS: 60,
  COLD_START_TASTE: 0.7,
  IMPLICIT_CLICKED: 0.65,
  IMPLICIT_SWAPPED: 0.2,
  IMPLICIT_NO_ACTION: 0.45,
  RATING_VALUES: { good: 1.0, ok: 0.5, bad: 0.0, skipped: 0.4 },
  FATIGUE_TAU_DISH: 7,
  FATIGUE_TAU_SHOP: 3,
  FATIGUE_TAU_TAG: 2,
  FATIGUE_MAX_SHOP_PENALTY: 0.5,
  FATIGUE_MAX_TAG_PENALTY: 0.3,
  FATIGUE_FLOOR: 0.02,
  LONG_TIME_FDISH: 0.85,
  JITTER_MIN: 0.85,
  JITTER_MAX: 1.15,
  MAX_SWAPS: 2,
};

export const SLOTS = ['breakfast', 'lunch', 'dinner'];

export const SLOT_LABELS = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
};

/** 饭点推断阈值，单位为「当天第几分钟」。 */
export const SLOT_BOUNDARIES = {
  breakfastEnd: 10 * 60 + 30,
  lunchEnd: 15 * 60,
};

/** 吃过了才算「吃过」—— 用于腻味系数。'skipped' 不算。 */
export const EATEN_RATINGS = ['good', 'ok', 'bad'];
