import { baseHeight, GRID, MOUNTAIN } from '@shared/world.js'

import { addBall, resetBalls } from './digStore'

/**
 * The untouched mountain surface as a heightfield, shared by rendering, physics and
 * picking.
 *
 * A 0.5 m grid over the mountain's square footprint. Each vertex is filled from the
 * analytic surface the first time its chunk is touched (filling all ~590k at once
 * would stall start-up on a phone).
 *
 * Digging never edits this grid: every swing removes a ball of ground (see
 * digStore), and the solid mountain is "below this surface and outside every ball".
 * Every client applies the same balls, so every client sees the same tunnels.
 */

const N = GRID.verts
const CELL = MOUNTAIN.cell
export const CHUNK_CELLS = MOUNTAIN.chunk / CELL
export const CHUNKS = GRID.size / MOUNTAIN.chunk

const base = new Float32Array(N * N)
const filled = new Uint8Array(CHUNKS * CHUNKS)

let seed = 1
/** Digs applied so far, so the network layer can apply only new ones. */
let appliedDigs = 0
/** Bumped on reset; renderers rebuild everything when it changes. */
let generation = 0

const clampI = (i) => (i < 0 ? 0 : i >= N ? N - 1 : i)
const chunkOfVert = (i) => Math.min(CHUNKS - 1, Math.floor(i / CHUNK_CELLS))

function fillChunk(cx, cz) {
  const k = cz * CHUNKS + cx
  if (filled[k]) return
  filled[k] = 1
  const i0 = cx * CHUNK_CELLS
  const j0 = cz * CHUNK_CELLS
  for (let j = j0; j <= j0 + CHUNK_CELLS; j += 1) {
    const z = GRID.originZ + j * CELL
    for (let i = i0; i <= i0 + CHUNK_CELLS; i += 1) {
      base[j * N + i] = baseHeight(GRID.originX + i * CELL, z, seed)
    }
  }
}

/** Surface height at grid vertex (i, j); fills its chunk if needed. */
export function vertexBase(i, j) {
  i = clampI(i)
  j = clampI(j)
  const cx = chunkOfVert(i)
  const cz = chunkOfVert(j)
  if (!filled[cz * CHUNKS + cx]) fillChunk(cx, cz)
  return base[j * N + i]
}

/** Alias kept for the mesh builders: the surface never moves, only balls are cut. */
export const vertexHeight = vertexBase

/**
 * Height for the coarse far mesh: grid data where loaded, else the analytic surface
 * (identical values, but computing it never forces a chunk fill).
 */
export function coarseHeight(i, j) {
  i = clampI(i)
  j = clampI(j)
  if (filled[chunkOfVert(j) * CHUNKS + chunkOfVert(i)]) return base[j * N + i]
  return baseHeight(GRID.originX + i * CELL, GRID.originZ + j * CELL, seed)
}

export function insideGrid(x, z) {
  return x >= GRID.originX && z >= GRID.originZ && x <= GRID.originX + GRID.size && z <= GRID.originZ + GRID.size
}

/** Bilinear surface height at a world point, or -Infinity outside the grid. */
export function terrainHeight(x, z) {
  if (!insideGrid(x, z)) return -Infinity
  const gx = (x - GRID.originX) / CELL
  const gz = (z - GRID.originZ) / CELL
  const i = Math.min(N - 2, Math.floor(gx))
  const j = Math.min(N - 2, Math.floor(gz))
  const fx = gx - i
  const fz = gz - j
  const h00 = vertexBase(i, j)
  const h10 = vertexBase(i + 1, j)
  const h01 = vertexBase(i, j + 1)
  const h11 = vertexBase(i + 1, j + 1)
  return h00 + (h10 - h00) * fx + (h01 - h00) * fz + (h00 - h10 - h01 + h11) * fx * fz
}

/** Surface height without forcing chunk loads, for decorations scattered mountain-wide. */
export function peekHeight(x, z) {
  if (!insideGrid(x, z)) return -Infinity
  return coarseHeight(Math.round((x - GRID.originX) / CELL), Math.round((z - GRID.originZ) / CELL))
}

/** Applies the server's dig list incrementally; resets the mountain on a reroll. */
export function syncDigs(newSeed, digs) {
  if (newSeed !== seed || digs.length < appliedDigs) reset(newSeed)
  for (let i = appliedDigs; i < digs.length; i += 1) {
    const d = digs[i]
    addBall(d.x, d.y, d.z, d.r, d.by)
  }
  appliedDigs = digs.length
}

export function reset(newSeed) {
  seed = newSeed
  appliedDigs = 0
  filled.fill(0)
  resetBalls()
  generation += 1
}

export const getSeed = () => seed
/** Changes whenever the terrain does (a new dig, or a new mountain). */
export const getDigCount = () => appliedDigs + generation * 100000
export const getGeneration = () => generation
