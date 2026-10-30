/**
 * Hotbar layout derived from the backpack: slot 0 is the equipped pickaxe, then
 * consumables (bombs, radars), then crystals, up to 10 slots in total.
 */
export const HOTBAR_SLOTS = 10

export function hotbarItems(me) {
  if (!me) return []
  const tools = me.backpack.filter((it) => it.kind !== 'crystal')
  const crystals = me.backpack.filter((it) => it.kind === 'crystal')
  return [...tools, ...crystals].slice(0, HOTBAR_SLOTS - 1)
}

/** Item in hotbar slot `slot` (1..9), or null for the pickaxe / empty slots. */
export function itemInSlot(me, slot) {
  if (slot <= 0) return null
  return hotbarItems(me)[slot - 1] ?? null
}

export function carriedWeight(me) {
  if (!me) return 0
  let w = 0
  for (const it of me.backpack) w += it.weight
  return w
}
