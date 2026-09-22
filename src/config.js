export const CONFIG = {
  W_TASTE: 0.7,
  W_VALUE: 0.3,
  TASTE_HALFLIFE_DAYS: 60,
  COLD_START_TASTE: 0.7,
  IMPLICIT_CLICKED: 0.65,
  RATING_VALUES: { good: 1.0, ok: 0.5, bad: 0.0, skipped: 0.4 },
  FATIGUE_TAU_DISH: 7,
  FATIGUE_TAU_SHOP: 3,
  FATIGUE_TAU_TAG: 2,
  FATIGUE_MAX_SHOP_PENALTY: 0.5,
  FATIGUE_MAX_TAG_PENALTY: 0.3,
  FATIGUE_FLOOR: 0.02,
  MUTE_FLOOR: 0.05,
  MUTE_TAU_DAYS: 14,
  FEEDBACK_DELAY_MINUTES: 120,
  LONG_TIME_FDISH: 0.85,
  JITTER_MIN: 0.85,
  JITTER_MAX: 1.15,
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

/**
 * 拍立得里那个 emoji 的关键字表。**顺序就是优先级** —— 命中第一个就返回，
 * 所以「面」必须排在「鸡」前面，否则「鸡汤面」会出 🍗。改表时别打乱顺序。
 */
export const DISH_EMOJI = [
  [['汉堡', '堡'], '🍔'],
  [['面', '米线', '粉', '粿条'], '🍜'],
  [['饭', '盖浇', '煲仔', '饭团'], '🍚'],
  [['寿司', '刺身', '生鱼'], '🍣'],
  [['披萨', '比萨'], '🍕'],
  [['火锅', '麻辣烫', '香锅', '冒菜'], '🍲'],
  [['烧烤', '烤串', '串'], '🍢'],
  [['包', '饺', '馄饨', '烧麦'], '🥟'],
  [['粥', '汤'], '🥣'],
  [['沙拉', '轻食'], '🥗'],
  [['鸡'], '🍗'],
  [['虾', '蟹'], '🦐'],
  [['奶茶', '咖啡', '果汁'], '🥤'],
];

/** 一个关键字都不中时用它 —— 猜错比不猜更扎眼。 */
export const DEFAULT_DISH_EMOJI = '🍽️';

/** 拍立得下面那行字。语气是问句，跟「划一划换一个」配一对。 */
export const POLAROID_CAPS = {
  breakfast: '早上吃这个？',
  lunch: '中午吃这个？',
  dinner: '今晚吃这个？',
};

/** 跟手滑动翻页的阈值，按卡片宽度的比例算 —— 换个宽屏手感才一样。 */
export const SWIPE_RATIO = 0.32;

/** 轮播位置画成小横杠的上限；超过就退回「7 / 23」文字。见 style.css 的注释。 */
export const CAROUSEL_DOTS_MAX = 8;
