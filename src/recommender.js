/**
 * 硬过滤：把不该出现在今天这一顿的菜品全部剔除。
 * 店铺不存在的孤儿菜品也一并剔除 —— 没有店就没有跳转链接。
 */
export function filterCandidates({ dishes, shops, slot, excludedDishIds = [] }) {
  const shopById = new Map(shops.map((s) => [s.id, s]));
  const excluded = new Set(excludedDishIds);

  return dishes.filter((d) => {
    if (d.active === false) return false;
    if (excluded.has(d.id)) return false;
    if (!Array.isArray(d.slots) || !d.slots.includes(slot)) return false;
    const shop = shopById.get(d.shopId);
    if (!shop) return false;
    if (shop.hygiene === 'blocked') return false;
    return true;
  });
}
