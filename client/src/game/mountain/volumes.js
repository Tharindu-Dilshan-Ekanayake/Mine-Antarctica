import { BufferAttribute, BufferGeometry } from 'three'

import { GRID, MOUNTAIN } from '@shared/world.js'
import { columns, columnKey, LAYER_BASE, MIN_LAYER, takeDirtyVolumes, VCOL, VCOLS, VLAYER, volumeKey } from '../terrain/digStore'
import { vertexBase } from '../terrain/heightGrid'
import { buildVolumeChunk } from './volumeMesh'

/**
 * Keeps the dug parts of the near mountain meshed.
 *
 * Dug columns are scheduled when they come within the streamed window; their volume
 * chunks are built a few per frame (nearest first), cached, and merged into one mesh
 * per 32 m terrain chunk. A column counts as "ready" once every chunk in it is built,
 * and only then does the heightfield cut its hole there, so nothing ever flickers
 * open while it's still being built.
 */

const CHUNK_COLS = MOUNTAIN.chunk / VCOL
const CELL = MOUNTAIN.cell
const MAX_CACHE = 500

/** volume key -> mesh arrays (or null: built, holds no surface) */
const cache = new Map()
const pending = new Set()
/** column key -> number of its chunks still pending */
const colPending = new Map()
const scheduled = new Set()
/** column key -> [lowest layer, highest layer] covering its surface */
const colRange = new Map()
const ready = new Set()
/** Ready columns currently within view radius (the ones actually drawn). */
const shown = new Set()

let voxel = 0.5
/** Bumped whenever a column becomes ready, so the heightfield re-cuts its holes. */
let readyVersion = 0
/** 32 m chunk keys whose merged mesh is out of date. */
const staleChunks = new Set()

const _dirty = new Set()
const _order = []

/**
 * Most columns one connected dug area may bring in at once: a hard cap, so a mountain
 * dug hollow by eight players can't blow the triangle budget.
 */
const MAX_DRAWN = 96
/** Dug columns to draw this frame: whole connected dug areas near the player. */
const eligible = new Set()
/** column key -> index of its connected dug area (this frame). */
const compOf = new Map()
const compAllReady = []
const compAnyShown = []
const _queue = []

export const isColumnReady = (cx, cz) => shown.has(columnKey(cx, cz))
export const getReadyVersion = () => readyVersion

export function resetVolumes(s) {
  voxel = s
  cache.clear()
  pending.clear()
  colPending.clear()
  scheduled.clear()
  colRange.clear()
  ready.clear()
  shown.clear()
  staleChunks.clear()
  readyVersion += 1
}

const colOf = (vkey) => vkey % (VCOLS * VCOLS)
const layerOf = (vkey) => Math.floor(vkey / (VCOLS * VCOLS)) - LAYER_BASE
const chunkOfCol = (ck) => {
  const cx = ck % VCOLS
  const cz = Math.floor(ck / VCOLS)
  return Math.floor(cz / CHUNK_COLS) * (VCOLS / CHUNK_COLS) + Math.floor(cx / CHUNK_COLS)
}

function addPending(vkey) {
  if (pending.has(vkey)) return
  pending.add(vkey)
  const ck = colOf(vkey)
  colPending.set(ck, (colPending.get(ck) ?? 0) + 1)
}

/** Lowest and highest layer that can hold surface in this column. */
function layerRange(ck) {
  let r = colRange.get(ck)
  if (!r) {
    const cx = ck % VCOLS
    const cz = Math.floor(ck / VCOLS)
    const i0 = (cx * VCOL) / CELL
    const j0 = (cz * VCOL) / CELL
    const span = VCOL / CELL
    let lo = Infinity
    let hi = -Infinity
    for (let j = 0; j <= span; j += 2) {
      for (let i = 0; i <= span; i += 2) {
        const h = Math.max(0, vertexBase(i0 + i, j0 + j))
        if (h < lo) lo = h
        if (h > hi) hi = h
      }
    }
    r = [lo, hi]
    colRange.set(ck, r)
  }
  const minY = Math.min(r[0], columns.get(ck)?.minY ?? r[0])
  return [Math.max(MIN_LAYER, Math.floor((minY - 1) / VLAYER)), Math.floor((r[1] + 1) / VLAYER)]
}

function schedule(ck) {
  scheduled.add(ck)
  const cx = ck % VCOLS
  const cz = Math.floor(ck / VCOLS)
  const [l0, l1] = layerRange(ck)
  for (let l = l0; l <= l1; l += 1) addPending(volumeKey(cx, cz, l))
}

/**
 * One frame of work. `win` is [minChunkX, minChunkZ, maxChunkX, maxChunkZ] in 32 m
 * chunks (inclusive); only dug columns inside it and within `radius` metres of the
 * player are meshed. `budgetMs` caps the time spent building.
 */
export function updateVolumes(px, pz, win, radius, budgetMs) {
  const cMinX = win[0] * CHUNK_COLS
  const cMinZ = win[1] * CHUNK_COLS
  const cMaxX = (win[2] + 1) * CHUNK_COLS - 1
  const cMaxZ = (win[3] + 1) * CHUNK_COLS - 1
  const reach = radius + VCOL * 0.71
  const inChunkWindow = (ck) => {
    const cx = ck % VCOLS
    const cz = Math.floor(ck / VCOLS)
    return cx >= cMinX && cx <= cMaxX && cz >= cMinZ && cz <= cMaxZ
  }
  const withinReach = (ck) => {
    const dx = GRID.originX + ((ck % VCOLS) + 0.5) * VCOL - px
    const dz = GRID.originZ + (Math.floor(ck / VCOLS) + 0.5) * VCOL - pz
    return dx * dx + dz * dz <= reach * reach
  }

  // What to draw: every dug area that reaches within `radius` of you is drawn WHOLE -
  // all of its connected dug columns. Drawing only the near half of a tunnel would
  // leave the far half as a bare surface skin with no walls, and you'd see straight
  // through the mountain into the sky.
  eligible.clear()
  compOf.clear()
  compAllReady.length = 0
  compAnyShown.length = 0
  for (const seed of columns.keys()) {
    if (eligible.size >= MAX_DRAWN) break
    if (eligible.has(seed) || !inChunkWindow(seed) || !withinReach(seed)) continue
    const id = compAllReady.length
    compAllReady.push(true)
    compAnyShown.push(false)
    _queue.length = 0
    _queue.push(seed)
    eligible.add(seed)
    for (let qi = 0; qi < _queue.length; qi += 1) {
      const ck = _queue[qi]
      compOf.set(ck, id)
      if (!ready.has(ck)) compAllReady[id] = false
      if (shown.has(ck)) compAnyShown[id] = true
      const cx = ck % VCOLS
      const cz = Math.floor(ck / VCOLS)
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx
          const nz = cz + dz
          if ((!dx && !dz) || nx < 0 || nz < 0 || nx >= VCOLS || nz >= VCOLS) continue
          const nk = columnKey(nx, nz)
          if (eligible.has(nk) || !columns.has(nk) || !inChunkWindow(nk) || eligible.size >= MAX_DRAWN) continue
          eligible.add(nk)
          _queue.push(nk)
        }
      }
    }
  }
  const inWindow = (ck) => eligible.has(ck)

  // New digs: rebuild the chunks they touched, in columns we already track.
  takeDirtyVolumes(_dirty)
  for (const vk of _dirty) {
    const ck = colOf(vk)
    if (!scheduled.has(ck)) continue
    // A new ball can reach below the column's previous lowest layer.
    const [l0] = layerRange(ck)
    const cx = ck % VCOLS
    const cz = Math.floor(ck / VCOLS)
    for (let l = l0; l < layerOf(vk); l += 1) {
      const k = volumeKey(cx, cz, l)
      if (!cache.has(k)) addPending(k)
    }
    addPending(vk)
  }
  _dirty.clear()

  // Dug columns entering the window.
  for (const ck of columns.keys()) {
    if (!scheduled.has(ck) && inWindow(ck)) schedule(ck)
  }

  // Build nearest first, within the time budget.
  if (pending.size) {
    _order.length = 0
    for (const vk of pending) {
      const ck = colOf(vk)
      if (!inWindow(ck)) continue
      const cx = ck % VCOLS
      const cz = Math.floor(ck / VCOLS)
      const dx = GRID.originX + (cx + 0.5) * VCOL - px
      const dz = GRID.originZ + (cz + 0.5) * VCOL - pz
      _order.push({ vk, d: dx * dx + dz * dz })
    }
    _order.sort((a, b) => a.d - b.d)
    const start = performance.now()
    for (let n = 0; n < _order.length; n += 1) {
      if (n > 0 && performance.now() - start > budgetMs) break
      const vk = _order[n].vk
      const ck = colOf(vk)
      const cx = ck % VCOLS
      const cz = Math.floor(ck / VCOLS)
      cache.set(vk, buildVolumeChunk(cx, cz, layerOf(vk), voxel))
      pending.delete(vk)
      const left = (colPending.get(ck) ?? 1) - 1
      colPending.set(ck, left)
      if (left <= 0 && !ready.has(ck)) {
        ready.add(ck)
        readyVersion += 1
      }
      staleChunks.add(chunkOfCol(ck))
    }
  }

  // Which ready columns are drawn: those of the dug areas in range. A dug area that
  // isn't drawn yet switches on only once all of it is built (never half a tunnel);
  // one already drawn takes in new digs as soon as they're built.
  let changed = false
  for (const ck of ready) {
    const comp = compOf.get(ck)
    const inRange = comp !== undefined && (compAllReady[comp] || compAnyShown[comp])
    if (inRange !== shown.has(ck)) {
      if (inRange) shown.add(ck)
      else shown.delete(ck)
      changed = true
    }
  }
  for (const ck of shown) {
    if (!ready.has(ck)) {
      shown.delete(ck)
      changed = true
    }
  }
  if (changed) readyVersion += 1

  // Keep memory bounded: forget built chunks far outside the window.
  if (cache.size > MAX_CACHE) {
    const dropped = new Set()
    for (const vk of cache.keys()) {
      const ck = colOf(vk)
      if (inChunkWindow(ck)) continue
      cache.delete(vk)
      dropped.add(ck)
    }
    for (const vk of pending) if (dropped.has(colOf(vk))) pending.delete(vk)
    for (const ck of dropped) {
      scheduled.delete(ck)
      colPending.delete(ck)
      if (ready.delete(ck)) readyVersion += 1
    }
  }
}

/** True (once) when this 32 m chunk's merged volume mesh needs rebuilding. */
export function takeStale(chunkKey) {
  return staleChunks.delete(chunkKey)
}

const _parts = []

/**
 * Concatenates every ready column's volume chunks inside 32 m chunk (kx, kz) into
 * `geo`, growing it if needed. Returns the geometry to use (a new one if it grew).
 */
export function mergeChunk(geo, kx, kz) {
  _parts.length = 0
  let total = 0
  for (let a = 0; a < CHUNK_COLS; a += 1) {
    for (let b = 0; b < CHUNK_COLS; b += 1) {
      const cx = kx * CHUNK_COLS + b
      const cz = kz * CHUNK_COLS + a
      const ck = columnKey(cx, cz)
      if (!shown.has(ck)) continue
      const [l0, l1] = layerRange(ck)
      for (let l = l0; l <= l1; l += 1) {
        const part = cache.get(volumeKey(cx, cz, l))
        if (!part) continue
        _parts.push(part)
        total += part.count
      }
    }
  }

  let g = geo
  const cap = g?.userData.capacity ?? 0
  if (!g || cap < total) {
    g?.dispose()
    const capacity = Math.max(3000, Math.ceil(total * 1.5))
    g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(capacity * 3), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(capacity * 3), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(capacity * 3), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array(capacity * 2), 2))
    g.setAttribute('aDepth', new BufferAttribute(new Float32Array(capacity), 1))
    g.userData.capacity = capacity
  }
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const col = g.getAttribute('color')
  const uv = g.getAttribute('uv')
  const depth = g.getAttribute('aDepth')
  let o = 0
  for (const p of _parts) {
    pos.array.set(p.positions, o * 3)
    nor.array.set(p.normals, o * 3)
    col.array.set(p.colors, o * 3)
    uv.array.set(p.uvs, o * 2)
    if (p.depths) depth.array.set(p.depths, o)
    o += p.count
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  col.needsUpdate = true
  uv.needsUpdate = true
  depth.needsUpdate = true
  g.setDrawRange(0, total)
  g.userData.count = total
  // No bounding sphere: the buffers have spare capacity. The mesh is never culled
  // (at most 9 of them, all inside the streamed window around the player).
  return g
}

/** Counts for debugging the volume pipeline (dev tools / tests). */
export const volumeStats = () => ({
  cached: cache.size,
  pending: pending.size,
  scheduled: scheduled.size,
  ready: ready.size,
  shown: shown.size,
  readyVersion,
})
