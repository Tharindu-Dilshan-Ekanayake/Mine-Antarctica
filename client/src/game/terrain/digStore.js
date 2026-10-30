import { GRID, MOUNTAIN } from '@shared/world.js'

/**
 * Every ball of ground dug out of the current mountain, with a spatial hash so a
 * point query only looks at the few balls near it.
 *
 * Also tracks which volume columns (MOUNTAIN.volumeColumn square, full height) have
 * been touched: those are drawn volumetrically, everything else stays a heightfield.
 */

/** Hash cell size (m). Balls are listed in every cell their footprint overlaps. */
const HASH = 4
const HASH_N = Math.ceil(GRID.size / HASH) + 1

export const VCOL = MOUNTAIN.volumeColumn
export const VCOLS = GRID.size / VCOL
/** Vertical size of one volume chunk (m); columns are stacks of these. */
export const VLAYER = 8

export const sx = []
export const sy = []
export const sz = []
export const sr = []
/** Who dug each ball (a server-made id; 0 = unknown). */
export const sby = []

/** hash cell index -> array of ball indices */
const cells = new Map()

/**
 * Column key -> { minY, version }: lowest point any ball reached in it and a counter
 * bumped on every change, so meshes know when to rebuild.
 */
export const columns = new Map()

/** Volume chunk keys touched since the renderer last looked. */
const dirtyVolumes = new Set()
/** Ground boxes [minX, minZ, maxX, maxZ] whose surface colour changed (a hole, its dirt). */
const dirtySurface = []
/** How far the thrown-out dirt round a hole reaches past its edge (m). */
export const SPILL_REACH = 2.1

const clampCell = (i) => (i < 0 ? 0 : i >= HASH_N ? HASH_N - 1 : i)
const cellX = (x) => clampCell(Math.floor((x - GRID.originX) / HASH))
const cellZ = (z) => clampCell(Math.floor((z - GRID.originZ) / HASH))

export const columnKey = (cx, cz) => cz * VCOLS + cx
/** Layers below y = 0 (down to bedrock) get keys too: layer indices are offset by this. */
export const LAYER_BASE = Math.ceil(-MOUNTAIN.bedrock / VLAYER) + 1
/** The lowest layer that can hold ground (bedrock's). */
export const MIN_LAYER = Math.floor(MOUNTAIN.bedrock / VLAYER)
export const volumeKey = (cx, cz, layer) => ((layer + LAYER_BASE) * VCOLS + cz) * VCOLS + cx

export function addBall(x, y, z, r, by = 0) {
  const i = sx.length
  sx.push(x)
  sy.push(y)
  sz.push(z)
  sr.push(r)
  sby.push(by)
  const reach = r + SPILL_REACH + 0.5
  dirtySurface.push(x - reach, z - reach, x + reach, z + reach)

  for (let hz = cellZ(z - r); hz <= cellZ(z + r); hz += 1) {
    for (let hx = cellX(x - r); hx <= cellX(x + r); hx += 1) {
      const k = hz * HASH_N + hx
      let list = cells.get(k)
      if (!list) {
        list = []
        cells.set(k, list)
      }
      list.push(i)
    }
  }

  const c0x = Math.max(0, Math.floor((x - r - GRID.originX) / VCOL))
  const c1x = Math.min(VCOLS - 1, Math.floor((x + r - GRID.originX) / VCOL))
  const c0z = Math.max(0, Math.floor((z - r - GRID.originZ) / VCOL))
  const c1z = Math.min(VCOLS - 1, Math.floor((z + r - GRID.originZ) / VCOL))
  const l0 = Math.max(MIN_LAYER, Math.floor((y - r) / VLAYER))
  const l1 = Math.floor((y + r) / VLAYER)
  for (let cz = c0z; cz <= c1z; cz += 1) {
    for (let cx = c0x; cx <= c1x; cx += 1) {
      const k = columnKey(cx, cz)
      const col = columns.get(k)
      if (col) {
        col.minY = Math.min(col.minY, y - r)
        col.version += 1
      } else {
        columns.set(k, { minY: y - r, version: 1 })
      }
      for (let l = l0; l <= l1; l += 1) dirtyVolumes.add(volumeKey(cx, cz, l))
    }
  }
}

/** Balls whose footprint overlaps the cell containing (x, z). Shared array: read only. */
const EMPTY = []
export function ballsAt(x, z) {
  return cells.get(cellZ(z) * HASH_N + cellX(x)) ?? EMPTY
}

let stamp = 0
let stamps = new Uint32Array(1024)

/** Indices of balls overlapping an xz box, deduplicated, into `out`. */
export function ballsInBox(minX, minZ, maxX, maxZ, out) {
  out.length = 0
  stamp += 1
  if (stamps.length < sx.length) {
    const next = new Uint32Array(sx.length * 2)
    next.set(stamps)
    stamps = next
  }
  for (let hz = cellZ(minZ); hz <= cellZ(maxZ); hz += 1) {
    for (let hx = cellX(minX); hx <= cellX(maxX); hx += 1) {
      const list = cells.get(hz * HASH_N + hx)
      if (!list) continue
      for (let n = 0; n < list.length; n += 1) {
        const i = list[n]
        if (stamps[i] === stamp) continue
        stamps[i] = stamp
        out.push(i)
      }
    }
  }
  return out
}

export function resetBalls() {
  sx.length = 0
  sy.length = 0
  sz.length = 0
  sr.length = 0
  sby.length = 0
  cells.clear()
  columns.clear()
  dirtyVolumes.clear()
  dirtySurface.length = 0
}

/** The surface boxes changed since last asked, as a flat [minX, minZ, maxX, maxZ, ...] list. */
export function takeDirtySurface() {
  const out = dirtySurface.slice()
  dirtySurface.length = 0
  return out
}

export const ballCount = () => sx.length

export function takeDirtyVolumes(out) {
  for (const k of dirtyVolumes) out.add(k)
  dirtyVolumes.clear()
}
