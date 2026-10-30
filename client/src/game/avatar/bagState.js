import { CRYSTAL_BY_ID } from '@shared/catalog.js'

/** A fresh backpack summary for <Backpack>: load, capacity, the colours inside. */
export const emptyBag = () => ({ kg: 0, cap: 22, colors: [], version: 0, bump: 0 })

/**
 * Refreshes `bag` from a backpack item list and capacity. Bumps the version (and the
 * bounce, when something was added) only if anything changed.
 */
export function syncBag(bag, items, cap) {
  let kg = 0
  let crystals = 0
  for (const it of items) {
    kg += it.weight
    if (it.kind === 'crystal') crystals += 1
  }
  if (Math.abs(kg - bag.kg) < 1e-6 && cap === bag.cap && crystals === bag.count) return
  if (kg > bag.kg + 1e-6) bag.bump = 1
  bag.kg = kg
  bag.cap = cap
  bag.count = crystals
  // The six most recent crystals' colours, for the shards poking out of the top.
  const colors = []
  for (let i = items.length - 1; i >= 0 && colors.length < 6; i -= 1) {
    const type = items[i].kind === 'crystal' ? CRYSTAL_BY_ID[items[i].type] : null
    if (type) colors.push(type.color)
  }
  bag.colors = colors
  bag.version += 1
}
