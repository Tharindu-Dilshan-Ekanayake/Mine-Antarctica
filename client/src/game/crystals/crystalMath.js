import { crystalScale } from '@shared/catalog.js'

import { floorBelow } from '../terrain/solid'

/**
 * Where a world crystal sits. Buried ones are centred inside the wall/floor where they
 * were found (so they poke out of the tunnel face); loose ones rest on whatever
 * ground is below them. Both follow the terrain as tunnels change around them.
 */
export function crystalBaseY(c) {
  const s = crystalScale(c.weight)
  if (c.state === 0) return c.y - s * 0.45
  return floorBelow(c.x, c.y + 0.3, c.z) + 0.05
}

/** Approximate pick sphere: centre height and radius. */
export function crystalPickSphere(c) {
  const s = crystalScale(c.weight)
  return { cy: crystalBaseY(c) + s * 0.5, r: s * 0.6 + 0.35 }
}
