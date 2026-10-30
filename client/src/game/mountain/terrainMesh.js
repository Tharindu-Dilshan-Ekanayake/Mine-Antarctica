import { BufferAttribute, BufferGeometry, Color } from 'three'

import { valueNoise } from '@shared/rng.js'
import { GRID, MOUNTAIN } from '@shared/world.js'
import { ballsInBox, SPILL_REACH, sr, sx, sy, sz } from '../terrain/digStore'
import { CHUNK_CELLS, coarseHeight, vertexBase, vertexHeight } from '../terrain/heightGrid'

/**
 * Geometry builders for the mountain. Everything writes into preallocated typed
 * arrays; rebuilding a chunk after a dig allocates nothing.
 */

const N = GRID.verts
const CELL = MOUNTAIN.cell
export const UV_SCALE = 1 / 6
const SKIRT_DEPTH = 4

const SNOW = new Color('#eef4fb')
const SNOW_SHADE = new Color('#cfdcec')
const ROCK = new Color('#56606e')
const ROCK_DARK = new Color('#3a4250')
const ICE = new Color('#8fd0f2')
const ICE_DEEP = new Color('#5aaee0')
const SUMMIT_SNOW = new Color('#ffffff')
const FROST_TINT = new Color('#e3eefc')
const DIRT = new Color('#8a7360')
const DIRT_DEEP = new Color('#5e4c3e')
const STONE = new Color('#6d6a72')
const ORE = [new Color('#7fe6ff'), new Color('#c69bff'), new Color('#ffd23a'), new Color('#ff8ac9')]
const _c = new Color()
/** A dug opening: near-black inside, earthy at its lip, dirt thrown out around it. */
const HOLE = new Color('#130d09')
const HOLE_LIP = new Color('#3d2b1e')
const SPILL = new Color('#7b5f47')
const SPILL_DARK = new Color('#5a4231')
const _hole = new Color()
const _holeBalls = []

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Cheap per-vertex variation so big snowfields aren't flat white. */
const hash = (i, j) => {
  const h = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453
  return h - Math.floor(h)
}

/**
 * Writes the surface colour for a vertex into colors[o..o+2].
 *
 * Layers, bottom to top: wind-rippled snow; bluish frost in hollows; glacier ice
 * sheets on mid slopes; rock bands and streaks on the steeps; bright powder near
 * the summit; and dirt where players have dug.
 */
export function shade(colors, o, ny, dug, i, j, h) {
  const slope = 1 - ny
  const streak = valueNoise(i * 0.012, j * 0.05, 3) * 0.6 + valueNoise(i * 0.05, j * 0.012, 5) * 0.4
  const patch = valueNoise(i * 0.02, j * 0.02, 11)
  const ripple = Math.sin(i * 0.35 + Math.sin(j * 0.08) * 3) * 0.5 + 0.5

  _c.copy(SNOW).lerp(SNOW_SHADE, hash(i, j) * 0.35 + ripple * 0.18)
  _c.lerp(FROST_TINT, smoothstep(0.55, 0.85, patch) * 0.6)

  // Glacier ice: smooth blue sheets on moderately steep ground.
  const ice = smoothstep(0.62, 0.78, patch) * smoothstep(0.12, 0.26, slope) * (1 - smoothstep(0.42, 0.55, slope))
  _c.lerp(ICE, ice * 0.85)
  _c.lerp(ICE_DEEP, ice * smoothstep(0.3, 0.45, slope) * 0.6)

  // Rock: steep faces, wind-scoured streaks, and horizontal strata bands.
  const band = smoothstep(0.82, 0.95, Math.sin(h * 0.22 + streak * 4) * 0.5 + 0.5) * smoothstep(0.2, 0.35, slope)
  const rock = Math.max(smoothstep(0.4, 0.66, slope), smoothstep(0.62, 0.8, streak) * smoothstep(0.14, 0.34, slope), band)
  _c.lerp(ROCK, rock * 0.92)
  _c.lerp(ROCK_DARK, rock * smoothstep(0.55, 0.75, slope) * 0.6)

  // Fresh powder near the top.
  _c.lerp(SUMMIT_SNOW, smoothstep(170, 250, h) * (1 - rock * 0.45))

  if (dug > 0.04) {
    _c.lerp(DIRT, smoothstep(0.04, 0.5, dug))
    _c.lerp(DIRT_DEEP, smoothstep(1.5, 6, dug))
    // Bands of grey stone in deep walls, and the odd glinting fleck of ore.
    _c.lerp(STONE, smoothstep(0.55, 0.8, Math.sin(h * 0.3 - dug * 0.9 + streak * 3) * 0.5 + 0.5) * smoothstep(1, 3, dug) * 0.7)
    const fleck = hash(i * 1.7, j * 2.3 + dug * 5)
    if (dug > 0.8 && fleck > 0.965) _c.lerp(ORE[Math.floor(fleck * 1000) % ORE.length], 0.85)
  }
  colors[o] = _c.r
  colors[o + 1] = _c.g
  colors[o + 2] = _c.b
}

/**
 * Paints dug openings into a surface vertex at (x, h, z): dark inside the opening, an
 * earthy lip, and a ring of thrown-out dirt round it - so a hole reads as a hole from
 * across the mountain, long before its real 3D shape is drawn. `reach` widens it all
 * (the far mesh's vertices are metres apart: small holes still catch one). `rimOnly`
 * paints just the dirt (dug surfaces whose hole is real geometry already).
 */
export function holeShade(colors, o, x, z, h, reach = 0, rimOnly = false) {
  const pad = SPILL_REACH + reach + 2.5
  ballsInBox(x - pad, z - pad, x + pad, z + pad, _holeBalls)
  if (_holeBalls.length === 0) return
  let inside = 0
  let spill = 0
  for (let n = 0; n < _holeBalls.length; n += 1) {
    const i = _holeBalls[n]
    const r = sr[i]
    const dy = h - sy[i]
    // A ball that doesn't reach the surface here leaves no opening (a tunnel deep inside).
    if (dy >= r || dy <= -r) continue
    const open = Math.sqrt(r * r - dy * dy)
    const d = Math.hypot(x - sx[i], z - sz[i])
    inside = Math.max(inside, 1 - smoothstep(open - 0.35, open + 0.1 + reach, d))
    spill = Math.max(spill, 1 - smoothstep(open, open + SPILL_REACH + reach, d))
  }
  if (spill <= 0.002) return
  _hole.setRGB(colors[o], colors[o + 1], colors[o + 2])
  const speck = hash(x * 3.1, z * 2.7)
  _hole.lerp(speck > 0.5 ? SPILL : SPILL_DARK, spill * 0.85)
  if (!rimOnly) {
    _hole.lerp(HOLE_LIP, inside * 0.7)
    _hole.lerp(HOLE, smoothstep(0.45, 1, inside))
  }
  colors[o] = _hole.r
  colors[o + 1] = _hole.g
  colors[o + 2] = _hole.b
}

const indexCache = new Map()

/** Grid triangles + skirt triangles for an n x n vertex chunk. */
function chunkIndex(n) {
  if (indexCache.has(n)) return indexCache.get(n)
  const quads = (n - 1) * (n - 1)
  const skirtQuads = 4 * (n - 1)
  const index = new Uint32Array((quads + skirtQuads) * 6)
  let k = 0
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i
      const b = a + 1
      const c = a + n
      const d = c + 1
      index[k++] = a
      index[k++] = c
      index[k++] = b
      index[k++] = b
      index[k++] = c
      index[k++] = d
    }
  }
  // Skirt vertices follow the grid: one per border vertex, walked around the edge.
  const border = borderOrder(n)
  const base = n * n
  for (let s = 0; s < border.length; s += 1) {
    const a = border[s]
    const b = border[(s + 1) % border.length]
    const a2 = base + s
    const b2 = base + ((s + 1) % border.length)
    index[k++] = a
    index[k++] = b
    index[k++] = a2
    index[k++] = b
    index[k++] = b2
    index[k++] = a2
  }
  indexCache.set(n, index)
  return index
}

const borderCache = new Map()
/** Border vertex indices in a closed loop around the chunk. */
function borderOrder(n) {
  if (borderCache.has(n)) return borderCache.get(n)
  const out = []
  for (let i = 0; i < n - 1; i += 1) out.push(i)
  for (let j = 0; j < n - 1; j += 1) out.push(j * n + n - 1)
  for (let i = n - 1; i > 0; i -= 1) out.push((n - 1) * n + i)
  for (let j = n - 1; j > 0; j -= 1) out.push(j * n)
  borderCache.set(n, out)
  return out
}

/** A reusable geometry for one near chunk at `stride` grid cells per vertex. */
export function createChunkGeometry(stride) {
  const n = CHUNK_CELLS / stride + 1
  const count = n * n + 4 * (n - 1)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(count * 3), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2))
  // Own copy: quads under dug columns are cut out of it (see setChunkHoles).
  geo.setIndex(new BufferAttribute(chunkIndex(n).slice(), 1))
  geo.userData.n = n
  geo.userData.stride = stride
  geo.userData.holes = ''
  return geo
}

/**
 * Removes the heightfield quads that lie in dug volume columns: the volume mesh draws
 * those. `isHole(colX, colZ)` gets grid-wide column indices. Rewrites the index only
 * when the set of holes in this chunk changed.
 */
export function setChunkHoles(geo, cx, cz, isHole, colSize) {
  const { n, stride } = geo.userData
  const quadsPerCol = Math.round(colSize / (MOUNTAIN.cell * stride))
  const colsPerChunk = (n - 1) / quadsPerCol
  const col0x = cx * colsPerChunk
  const col0z = cz * colsPerChunk
  let key = ''
  for (let a = 0; a < colsPerChunk; a += 1) {
    for (let b = 0; b < colsPerChunk; b += 1) key += isHole(col0x + b, col0z + a) ? '1' : '0'
  }
  if (key === geo.userData.holes) return
  geo.userData.holes = key

  const src = chunkIndex(n)
  const dst = geo.index.array
  let w = 0
  const quads = (n - 1) * (n - 1)
  for (let q = 0; q < quads; q += 1) {
    const qi = q % (n - 1)
    const qj = Math.floor(q / (n - 1))
    const hole = key.charCodeAt(Math.floor(qj / quadsPerCol) * colsPerChunk + Math.floor(qi / quadsPerCol)) === 49
    if (hole) continue
    for (let e = 0; e < 6; e += 1) dst[w++] = src[q * 6 + e]
  }
  // Skirts hang below the chunk's edges to hide seams. Where an edge runs through dug
  // ground they would hang in the open (and flicker against the neighbour's skirt),
  // so those segments go too.
  const border = borderOrder(n)
  for (let seg = 0; seg < border.length; seg += 1) {
    const va = border[seg]
    const vb = border[(seg + 1) % border.length]
    const qi = Math.min(n - 2, Math.floor(((va % n) + (vb % n)) / 2))
    const qj = Math.min(n - 2, Math.floor((Math.floor(va / n) + Math.floor(vb / n)) / 2))
    const hole = key.charCodeAt(Math.floor(qj / quadsPerCol) * colsPerChunk + Math.floor(qi / quadsPerCol)) === 49
    if (hole) continue
    const e0 = quads * 6 + seg * 6
    for (let e = 0; e < 6; e += 1) dst[w++] = src[e0 + e]
  }
  geo.setDrawRange(0, w)
  geo.index.needsUpdate = true
}

/** Fills a chunk geometry from the height grid for chunk (cx, cz). */
export function fillChunkGeometry(geo, cx, cz) {
  const { n, stride } = geo.userData
  const pos = geo.getAttribute('position').array
  const nor = geo.getAttribute('normal').array
  const col = geo.getAttribute('color').array
  const uv = geo.getAttribute('uv').array
  const i0 = cx * CHUNK_CELLS
  const j0 = cz * CHUNK_CELLS
  const span = 2 * stride * CELL

  for (let vj = 0; vj < n; vj += 1) {
    const j = j0 + vj * stride
    for (let vi = 0; vi < n; vi += 1) {
      const i = i0 + vi * stride
      const v = vj * n + vi
      const h = vertexHeight(i, j)
      const x = GRID.originX + i * CELL
      const z = GRID.originZ + j * CELL
      pos[v * 3] = x
      pos[v * 3 + 1] = h
      pos[v * 3 + 2] = z
      // Central differences: normal = (hL - hR, 2*span/2, hD - hU), normalised.
      const nx = vertexHeight(i - stride, j) - vertexHeight(i + stride, j)
      const nz = vertexHeight(i, j - stride) - vertexHeight(i, j + stride)
      const inv = 1 / Math.sqrt(nx * nx + span * span + nz * nz)
      nor[v * 3] = nx * inv
      nor[v * 3 + 1] = span * inv
      nor[v * 3 + 2] = nz * inv
      shade(col, v * 3, span * inv, vertexBase(i, j) - h, i, j, h)
      holeShade(col, v * 3, x, z, h)
      uv[v * 2] = x * UV_SCALE
      uv[v * 2 + 1] = z * UV_SCALE
    }
  }

  // Skirt: copy each border vertex straight down, hiding seams with the far mesh.
  const border = borderOrder(n)
  const base = n * n
  for (let s = 0; s < border.length; s += 1) {
    const src = border[s]
    const dst = base + s
    pos[dst * 3] = pos[src * 3]
    pos[dst * 3 + 1] = pos[src * 3 + 1] - SKIRT_DEPTH
    pos[dst * 3 + 2] = pos[src * 3 + 2]
    for (let c = 0; c < 3; c += 1) {
      nor[dst * 3 + c] = nor[src * 3 + c]
      col[dst * 3 + c] = col[src * 3 + c]
    }
    uv[dst * 2] = uv[src * 2]
    uv[dst * 2 + 1] = uv[src * 2 + 1] + SKIRT_DEPTH * UV_SCALE
  }

  geo.getAttribute('position').needsUpdate = true
  geo.getAttribute('normal').needsUpdate = true
  geo.getAttribute('color').needsUpdate = true
  geo.getAttribute('uv').needsUpdate = true
  geo.computeBoundingSphere()
}

/** The whole mountain at `step` metres per vertex. One mesh, one draw call. */
export function createFarGeometry(step) {
  const k = step / CELL
  const n = Math.floor((N - 1) / k) + 1
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(n * n * 3), 3))
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(n * n * 3), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(n * n * 3), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(n * n * 2), 2))
  const index = new Uint32Array((n - 1) * (n - 1) * 6)
  let t = 0
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i
      index[t++] = a
      index[t++] = a + n
      index[t++] = a + 1
      index[t++] = a + 1
      index[t++] = a + n
      index[t++] = a + n + 1
    }
  }
  geo.setIndex(new BufferAttribute(index, 1))
  geo.userData.n = n
  geo.userData.k = k
  return geo
}

export function fillFarGeometry(geo) {
  const { n, k } = geo.userData
  const pos = geo.getAttribute('position').array
  const nor = geo.getAttribute('normal').array
  const col = geo.getAttribute('color').array
  const uv = geo.getAttribute('uv').array
  const span = 2 * k * CELL
  // Height cache so each vertex samples the grid once; kept on the geometry.
  geo.userData.heights ??= new Float32Array(n * n)
  const heights = geo.userData.heights
  for (let vj = 0; vj < n; vj += 1) {
    for (let vi = 0; vi < n; vi += 1) heights[vj * n + vi] = coarseHeight(vi * k, vj * k)
  }
  for (let vj = 0; vj < n; vj += 1) {
    for (let vi = 0; vi < n; vi += 1) {
      const v = vj * n + vi
      const x = GRID.originX + vi * k * CELL
      const z = GRID.originZ + vj * k * CELL
      const h = heights[v]
      pos[v * 3] = x
      pos[v * 3 + 1] = h
      pos[v * 3 + 2] = z
      const nx = heights[vj * n + Math.max(0, vi - 1)] - heights[vj * n + Math.min(n - 1, vi + 1)]
      const nz = heights[Math.max(0, vj - 1) * n + vi] - heights[Math.min(n - 1, vj + 1) * n + vi]
      const inv = 1 / Math.sqrt(nx * nx + span * span + nz * nz)
      nor[v * 3] = nx * inv
      nor[v * 3 + 1] = span * inv
      nor[v * 3 + 2] = nz * inv
      shade(col, v * 3, span * inv, 0, vi * k, vj * k, h)
      holeShade(col, v * 3, x, z, h, k * CELL * 0.6)
      uv[v * 2] = x * UV_SCALE
      uv[v * 2 + 1] = z * UV_SCALE
    }
  }
  geo.getAttribute('position').needsUpdate = true
  geo.getAttribute('normal').needsUpdate = true
  geo.getAttribute('color').needsUpdate = true
  geo.getAttribute('uv').needsUpdate = true
  geo.computeBoundingSphere()
}

/**
 * Re-colours the far mesh inside an xz box (new digs there), leaving everything else
 * as it is: a few vertices per dig, no rebuild.
 */
export function recolorFar(geo, minX, minZ, maxX, maxZ) {
  const { n, k, heights } = geo.userData
  if (!heights) return
  const step = k * CELL
  const nor = geo.getAttribute('normal').array
  const col = geo.getAttribute('color').array
  const i0 = Math.max(0, Math.floor((minX - GRID.originX) / step) - 1)
  const i1 = Math.min(n - 1, Math.ceil((maxX - GRID.originX) / step) + 1)
  const j0 = Math.max(0, Math.floor((minZ - GRID.originZ) / step) - 1)
  const j1 = Math.min(n - 1, Math.ceil((maxZ - GRID.originZ) / step) + 1)
  if (i0 > i1 || j0 > j1) return
  for (let vj = j0; vj <= j1; vj += 1) {
    for (let vi = i0; vi <= i1; vi += 1) {
      const v = vj * n + vi
      const h = heights[v]
      shade(col, v * 3, nor[v * 3 + 1], 0, vi * k, vj * k, h)
      holeShade(col, v * 3, GRID.originX + vi * step, GRID.originZ + vj * step, h, step * 0.6)
    }
  }
  geo.getAttribute('color').needsUpdate = true
}

/**
 * Re-colours a near chunk inside an xz box (new digs there): only the vertices in the
 * box, nothing else touched - a few dozen per dig instead of the whole chunk.
 */
export function recolorChunk(geo, cx, cz, minX, minZ, maxX, maxZ) {
  const { n, stride } = geo.userData
  const pos = geo.getAttribute('position').array
  const nor = geo.getAttribute('normal').array
  const col = geo.getAttribute('color').array
  const i0 = cx * CHUNK_CELLS
  const j0 = cz * CHUNK_CELLS
  const step = stride * CELL
  const x0 = GRID.originX + i0 * CELL
  const z0 = GRID.originZ + j0 * CELL
  const vi0 = Math.max(0, Math.floor((minX - x0) / step))
  const vi1 = Math.min(n - 1, Math.ceil((maxX - x0) / step))
  const vj0 = Math.max(0, Math.floor((minZ - z0) / step))
  const vj1 = Math.min(n - 1, Math.ceil((maxZ - z0) / step))
  if (vi0 > vi1 || vj0 > vj1) return false
  for (let vj = vj0; vj <= vj1; vj += 1) {
    for (let vi = vi0; vi <= vi1; vi += 1) {
      const v = vj * n + vi
      const i = i0 + vi * stride
      const j = j0 + vj * stride
      const h = pos[v * 3 + 1]
      shade(col, v * 3, nor[v * 3 + 1], vertexBase(i, j) - h, i, j, h)
      holeShade(col, v * 3, pos[v * 3], pos[v * 3 + 2], h)
    }
  }
  geo.getAttribute('color').needsUpdate = true
  return true
}
