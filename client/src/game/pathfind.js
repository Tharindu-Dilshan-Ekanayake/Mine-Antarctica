import { GATE, PLAZA, PLOT_SIZE, plotGateDir, PLOTS } from '@shared/world.js'

import { blockedAt, colliderVersion } from './world/ground'

/**
 * Walking routes around the base, for the guide's arrow trail: A* on a 1 m grid over
 * the plaza (and a strip outside the gate), blocked by everything you'd bump into -
 * stalls, statues, lamp posts, the perimeter fence - and by the garden fences, which
 * you can only enter through their gap. The raw grid path is then pulled tight (line
 * of sight), so the trail runs in straight, natural lines.
 *
 * Off the plaza (on the mountain) there's nothing to walk around: straight lines.
 */

const CELL = 1
/** Body clearance kept from obstacles. */
const PAD = 0.7
const MIN_X = PLAZA.minX - 2
const MIN_Z = PLAZA.minZ - 14
const MAX_X = PLAZA.maxX + 2
const MAX_Z = PLAZA.maxZ + 2
const W = Math.ceil((MAX_X - MIN_X) / CELL)
const H = Math.ceil((MAX_Z - MIN_Z) / CELL)
const N = W * H

/** Where routes cross the gate: just outside it, on the mountain side. */
export const GATE_OUT = { x: GATE.x, z: PLAZA.minZ - 10 }

const blocked = new Uint8Array(N)
let builtFor = -1

const cellX = (i) => MIN_X + ((i % W) + 0.5) * CELL
const cellZ = (i) => MIN_Z + (Math.floor(i / W) + 0.5) * CELL
const inGrid = (x, z) => x > MIN_X && x < MAX_X && z > MIN_Z && z < MAX_Z
const cellOf = (x, z) => Math.floor((z - MIN_Z) / CELL) * W + Math.floor((x - MIN_X) / CELL)

/** On a garden's fence (anywhere but its entrance gap)? */
function onPlotFence(x, z) {
  const h = PLOT_SIZE / 2
  for (let i = 0; i < PLOTS.length; i += 1) {
    const p = PLOTS[i]
    const dx = x - p.x
    const dz = z - p.z
    if (Math.abs(dx) > h + PAD || Math.abs(dz) > h + PAD) continue
    const nearX = Math.abs(Math.abs(dx) - h) < PAD
    const nearZ = Math.abs(Math.abs(dz) - h) < PAD
    if (nearX && Math.abs(dz) <= h + PAD) return true
    if (nearZ && Math.abs(dx) <= h + PAD) {
      // The gate side has the entrance.
      if (Math.sign(dz) === plotGateDir(i) && Math.abs(dx) < 2 - PAD * 0.5) continue
      return true
    }
  }
  return false
}

function build() {
  if (builtFor === colliderVersion.n) return
  builtFor = colliderVersion.n
  for (let i = 0; i < N; i += 1) {
    const x = cellX(i)
    const z = cellZ(i)
    blocked[i] = blockedAt(x, z, PAD) || onPlotFence(x, z) ? 1 : 0
  }
}

/** The nearest open cell to (x, z), within a few metres (you may stand by a wall). */
function openCellNear(x, z) {
  const c0 = cellOf(x, z)
  if (!blocked[c0]) return c0
  const cx = c0 % W
  const cz = Math.floor(c0 / W)
  for (let r = 1; r <= 5; r += 1) {
    for (let dz = -r; dz <= r; dz += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const x2 = cx + dx
        const z2 = cz + dz
        if (x2 < 0 || z2 < 0 || x2 >= W || z2 >= H) continue
        const i = z2 * W + x2
        if (!blocked[i]) return i
      }
    }
  }
  return -1
}

// A* scratch, reused for every search.
const gScore = new Float32Array(N)
const parent = new Int32Array(N)
const stamp = new Uint32Array(N)
const closed = new Uint32Array(N)
let run = 0
const heap = new Int32Array(N)
const heapF = new Float32Array(N)
let heapN = 0

function heapPush(i, f) {
  let k = heapN++
  while (k > 0) {
    const p = (k - 1) >> 1
    if (heapF[p] <= f) break
    heap[k] = heap[p]
    heapF[k] = heapF[p]
    k = p
  }
  heap[k] = i
  heapF[k] = f
}

function heapPop() {
  const top = heap[0]
  const lastI = heap[--heapN]
  const lastF = heapF[heapN]
  let k = 0
  for (;;) {
    let c = 2 * k + 1
    if (c >= heapN) break
    if (c + 1 < heapN && heapF[c + 1] < heapF[c]) c += 1
    if (heapF[c] >= lastF) break
    heap[k] = heap[c]
    heapF[k] = heapF[c]
    k = c
  }
  heap[k] = lastI
  heapF[k] = lastF
  return top
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
]

/** Grid A* from cell a to cell b; the cell path (a..b), or null. */
function astar(a, b) {
  run += 1
  heapN = 0
  const bx = b % W
  const bz = Math.floor(b / W)
  const h = (i) => {
    const dx = Math.abs((i % W) - bx)
    const dz = Math.abs(Math.floor(i / W) - bz)
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)
  }
  stamp[a] = run
  gScore[a] = 0
  parent[a] = -1
  heapPush(a, h(a))
  while (heapN) {
    const i = heapPop()
    if (closed[i] === run) continue
    closed[i] = run
    if (i === b) break
    const x = i % W
    const z = Math.floor(i / W)
    for (const [dx, dz, cost] of DIRS) {
      const x2 = x + dx
      const z2 = z + dz
      if (x2 < 0 || z2 < 0 || x2 >= W || z2 >= H) continue
      const j = z2 * W + x2
      if (blocked[j] || closed[j] === run) continue
      // No cutting corners past an obstacle.
      if (dx && dz && (blocked[z * W + x2] || blocked[z2 * W + x])) continue
      const g = gScore[i] + cost
      if (stamp[j] === run && g >= gScore[j]) continue
      stamp[j] = run
      gScore[j] = g
      parent[j] = i
      heapPush(j, g + h(j))
    }
  }
  if (closed[b] !== run) return null
  const cells = []
  for (let i = b; i !== -1; i = parent[i]) cells.push(i)
  return cells.reverse()
}

/** Clear straight walk from (ax, az) to (bx, bz)? */
function lineOfSight(ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az)
  const steps = Math.ceil(len / 0.4)
  for (let k = 1; k < steps; k += 1) {
    const t = k / steps
    const x = ax + (bx - ax) * t
    const z = az + (bz - az) * t
    if (inGrid(x, z) && blocked[cellOf(x, z)]) return false
  }
  return true
}

/** A route inside the grid, as [x, z] points from (sx, sz) to (gx, gz), pulled tight. */
function gridRoute(sx, sz, gx, gz) {
  const a = openCellNear(sx, sz)
  const b = openCellNear(gx, gz)
  if (a < 0 || b < 0) return [[sx, sz], [gx, gz]]
  const cells = astar(a, b)
  if (!cells) return [[sx, sz], [gx, gz]]
  const raw = [[sx, sz], ...cells.map((i) => [cellX(i), cellZ(i)]), [gx, gz]]
  // String-pulling: from each kept point, jump to the farthest one in plain sight.
  const out = [raw[0]]
  let k = 0
  while (k < raw.length - 1) {
    let far = k + 1
    for (let j = raw.length - 1; j > k + 1; j -= 1) {
      if (lineOfSight(raw[k][0], raw[k][1], raw[j][0], raw[j][1])) {
        far = j
        break
      }
    }
    out.push(raw[far])
    k = far
  }
  return out
}

/**
 * A walking route from (sx, sz) to (gx, gz) as [x, z] points: around everything in
 * the base, through the gate when it leads on or off the mountain.
 */
export function routeTo(sx, sz, gx, gz) {
  build()
  const sIn = inGrid(sx, sz)
  const gIn = inGrid(gx, gz)
  if (sIn && gIn) return gridRoute(sx, sz, gx, gz)
  if (!sIn && gIn) return [[sx, sz], ...gridRoute(GATE_OUT.x, GATE_OUT.z, gx, gz)]
  if (sIn && !gIn) return [...gridRoute(sx, sz, GATE_OUT.x, GATE_OUT.z), [gx, gz]]
  return [[sx, sz], [gx, gz]]
}
