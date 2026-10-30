import { MOUNTAIN } from '@shared/world.js'

import { ballsAt, sr, sx, sy, sz } from './digStore'
import { insideGrid, peekHeight, terrainHeight } from './heightGrid'

/**
 * 3D questions about the dug mountain. Ground is solid when it is below the surface
 * (or the snow plane) and outside every dug ball; nothing is ever cut below bedrock.
 * All of it is allocation-free: physics, the camera and aiming call it every frame.
 */

const BED = MOUNTAIN.bedrock

/** The top of the ground column at (x, z) before any digging: mountain or snow plane. */
export function surfaceAt(x, z) {
  const h = terrainHeight(x, z)
  return h > 0 ? h : 0
}

/** Bedrock height under (x, z): balls never cut below it. Off the mountain it is the surface. */
const bedAt = (h) => (h > BED ? BED : h)

export function isSolid(x, y, z) {
  const h = surfaceAt(x, z)
  if (y >= h) return false
  if (y < bedAt(h)) return true
  if (!insideGrid(x, z)) return true
  const list = ballsAt(x, z)
  for (let n = 0; n < list.length; n += 1) {
    const i = list[n]
    const dx = x - sx[i]
    const dy = y - sy[i]
    const dz = z - sz[i]
    if (dx * dx + dy * dy + dz * dz < sr[i] * sr[i]) return false
  }
  return true
}

/**
 * Highest standing point at or below `yq` in the column at (x, z): the top of the
 * ground you'd land on. If `yq` is inside solid ground, returns `yq` (that's a wall).
 * `h` may be passed to use a precomputed surface height.
 */
export function floorBelow(x, yq, z, h = surfaceAt(x, z)) {
  let c = yq < h ? yq : h
  const bed = bedAt(h)
  if (c <= bed || !insideGrid(x, z)) return c
  const list = ballsAt(x, z)
  // Drop through every ball the point is inside, until it rests on solid ground.
  let moved = true
  while (moved) {
    moved = false
    for (let n = 0; n < list.length; n += 1) {
      const i = list[n]
      const dx = x - sx[i]
      const dz = z - sz[i]
      const r2 = sr[i] * sr[i] - dx * dx - dz * dz
      if (r2 <= 0) continue
      const half = Math.sqrt(r2)
      const bottom = sy[i] - half
      if (bottom < c && c <= sy[i] + half) {
        c = bottom
        moved = true
      }
    }
  }
  return c < bed ? bed : c
}

/**
 * Lowest solid point at or above `y` in the column at (x, z): the ceiling over your
 * head. Infinity when the column is open to the sky.
 */
export function ceilAbove(x, y, z, h = surfaceAt(x, z)) {
  if (y >= h) return Infinity
  if (y < bedAt(h) || !insideGrid(x, z)) return y
  const list = ballsAt(x, z)
  let c = y
  let moved = true
  while (moved) {
    moved = false
    for (let n = 0; n < list.length; n += 1) {
      const i = list[n]
      const dx = x - sx[i]
      const dz = z - sz[i]
      const r2 = sr[i] * sr[i] - dx * dx - dz * dz
      if (r2 <= 0) continue
      const half = Math.sqrt(r2)
      const top = sy[i] + half
      if (sy[i] - half <= c && c < top) {
        c = top
        moved = true
      }
    }
  }
  return c >= h ? Infinity : c
}

/** Top of the ground at (x, z), dug craters included. */
export const groundTop = (x, z) => floorBelow(x, Infinity, z)

/** Like groundTop but never forces terrain chunks to load (mountain-wide decorations). */
export function groundTopPeek(x, z) {
  const p = peekHeight(x, z)
  return floorBelow(x, Infinity, z, p > 0 ? p : 0)
}

/** How far below the original surface (x, y, z) is, in metres (0 if above). */
export function depthBelowSurface(x, y, z) {
  const d = surfaceAt(x, z) - y
  return d > 0 ? d : 0
}

const STEP = 0.25

/**
 * Distance along a unit ray to the first solid ground, or -1 within `maxDist`.
 * Marches in small steps, then refines the crossing by bisection.
 */
export function raycastSolid(ox, oy, oz, dx, dy, dz, maxDist) {
  let prev = 0
  if (isSolid(ox, oy, oz)) return 0
  for (let t = STEP; t <= maxDist + STEP; t += STEP) {
    const tt = t > maxDist ? maxDist : t
    if (isSolid(ox + dx * tt, oy + dy * tt, oz + dz * tt)) {
      let lo = prev
      let hi = tt
      for (let k = 0; k < 7; k += 1) {
        const mid = (lo + hi) / 2
        if (isSolid(ox + dx * mid, oy + dy * mid, oz + dz * mid)) hi = mid
        else lo = mid
      }
      return hi
    }
    prev = tt
    if (tt === maxDist) break
  }
  return -1
}
