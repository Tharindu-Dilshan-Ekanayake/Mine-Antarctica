import { GRID, MOUNTAIN } from '@shared/world.js'

import { ballsInBox, sr, sx, sy, sz, VCOL, VLAYER } from '../terrain/digStore'
import { vertexBase } from '../terrain/heightGrid'
import { holeShade, shade, UV_SCALE } from './terrainMesh'

/**
 * Meshes one dug volume chunk (VCOL x VLAYER x VCOL metres) with marching tetrahedra.
 *
 * The field is f = max(y - surface, max over balls (r - |p - c|)), with bedrock
 * forced solid: f < 0 is ground. On the faces of a chunk where nothing was dug,
 * f is exactly "y - surface", so the mesh edge lands exactly on the heightfield's
 * edge (same grid spacing): no cracks between dug and undug ground.
 *
 * Tetrahedra rather than marching cubes: no 256-entry tables, no ambiguous cases,
 * and the six-tet split shares face diagonals between neighbouring cubes, so the
 * surface is watertight.
 */

const CELL = MOUNTAIN.cell
const BED = MOUNTAIN.bedrock
/** Above the surface by more than this, a sample skips the ball test (it is air). */
const AIR_MARGIN = 1.5

// Cube corner offsets and the 6 tetrahedra around the 0-6 diagonal.
const CORNER = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
]
const TETS = [
  [0, 6, 1, 2],
  [0, 6, 2, 3],
  [0, 6, 3, 7],
  [0, 6, 7, 4],
  [0, 6, 4, 5],
  [0, 6, 5, 1],
]

// Scratch buffers, grown on demand and reused by every build.
let field = new Float32Array(0)
let gradX = new Float32Array(0)
let gradY = new Float32Array(0)
let gradZ = new Float32Array(0)
let surf = new Float32Array(0)
let out = { pos: new Float32Array(30000), nor: new Float32Array(30000) }
const near = []
const colBalls = []

function ensure(size) {
  if (field.length >= size) return
  field = new Float32Array(size)
  gradX = new Float32Array(size)
  gradY = new Float32Array(size)
  gradZ = new Float32Array(size)
}

let count = 0
function pushVertex(x, y, z, nx, ny, nz) {
  if (count * 3 + 3 > out.pos.length) {
    const pos = new Float32Array(out.pos.length * 2)
    const nor = new Float32Array(out.nor.length * 2)
    pos.set(out.pos)
    nor.set(out.nor)
    out = { pos, nor }
  }
  const o = count * 3
  out.pos[o] = x
  out.pos[o + 1] = y
  out.pos[o + 2] = z
  out.nor[o] = nx
  out.nor[o + 1] = ny
  out.nor[o + 2] = nz
  count += 1
}

// Per-tet working values (corner world positions, field values, gradients).
const tp = new Float32Array(12)
const tf = new Float32Array(4)
const tg = new Float32Array(12)
// Up to 4 edge vertices from one tet.
const ev = new Float32Array(24)

/** Vertex on edge a-b of the current tet, written into ev[slot]. */
function edge(a, b, slot) {
  const fa = tf[a]
  const fb = tf[b]
  const t = fa === fb ? 0.5 : fa / (fa - fb)
  const o = slot * 6
  for (let c = 0; c < 3; c += 1) {
    ev[o + c] = tp[a * 3 + c] + (tp[b * 3 + c] - tp[a * 3 + c]) * t
    ev[o + 3 + c] = tg[a * 3 + c] + (tg[b * 3 + c] - tg[a * 3 + c]) * t
  }
}

/** Emits the triangle ev[a], ev[b], ev[c], wound so its front faces the open air. */
function tri(a, b, c) {
  const A = a * 6
  const B = b * 6
  const C = c * 6
  const ux = ev[B] - ev[A]
  const uy = ev[B + 1] - ev[A + 1]
  const uz = ev[B + 2] - ev[A + 2]
  const vx = ev[C] - ev[A]
  const vy = ev[C + 1] - ev[A + 1]
  const vz = ev[C + 2] - ev[A + 2]
  const fx = uy * vz - uz * vy
  const fy = uz * vx - ux * vz
  const fz = ux * vy - uy * vx
  const gx = ev[A + 3] + ev[B + 3] + ev[C + 3]
  const gy = ev[A + 4] + ev[B + 4] + ev[C + 4]
  const gz = ev[A + 5] + ev[B + 5] + ev[C + 5]
  const order = fx * gx + fy * gy + fz * gz < 0 ? [A, C, B] : [A, B, C]
  for (const o of order) {
    let nx = ev[o + 3]
    let ny = ev[o + 4]
    let nz = ev[o + 5]
    const l = Math.hypot(nx, ny, nz)
    if (l > 1e-6) {
      nx /= l
      ny /= l
      nz /= l
    } else {
      nx = 0
      ny = 1
      nz = 0
    }
    pushVertex(ev[o], ev[o + 1], ev[o + 2], nx, ny, nz)
  }
}

/**
 * Builds the mesh for volume chunk (cx, cz, layer) at voxel size `s` metres
 * (a multiple of the 0.5 m grid). Returns fresh, exactly-sized arrays, or null when
 * the chunk holds no surface.
 */
export function buildVolumeChunk(cx, cz, layer, s) {
  const n = Math.round(VCOL / s)
  const ny = Math.round(VLAYER / s)
  const P = n + 3
  const PY = ny + 3
  const X0 = GRID.originX + cx * VCOL
  const Z0 = GRID.originZ + cz * VCOL
  const Y0 = layer * VLAYER
  const step = Math.round(s / CELL)
  const gi0 = Math.round((X0 - GRID.originX) / CELL)
  const gj0 = Math.round((Z0 - GRID.originZ) / CELL)

  ensure(P * P * PY)
  if (surf.length < P * P) surf = new Float32Array(P * P)

  // Balls that can reach this chunk at all.
  ballsInBox(X0 - s * 2, Z0 - s * 2, X0 + VCOL + s * 2, Z0 + VCOL + s * 2, near)
  const yLo = Y0 - s * 2
  const yHi = Y0 + VLAYER + s * 2
  let w = 0
  for (let n2 = 0; n2 < near.length; n2 += 1) {
    const i = near[n2]
    if (sy[i] + sr[i] > yLo && sy[i] - sr[i] < yHi) near[w++] = i
  }
  near.length = w

  // --- Sample the field on the padded grid (index -1 .. n+1 on each axis) -----
  let neg = false
  let pos = false
  for (let k = 0; k < P; k += 1) {
    const z = Z0 + (k - 1) * s
    for (let i = 0; i < P; i += 1) {
      const x = X0 + (i - 1) * s
      const hb = vertexBase(gi0 + (i - 1) * step, gj0 + (k - 1) * step)
      const h = hb > 0 ? hb : 0
      surf[k * P + i] = h
      const bed = h > BED ? BED : h

      // Balls overlapping this vertical line, once per column of samples.
      colBalls.length = 0
      for (let n2 = 0; n2 < near.length; n2 += 1) {
        const b = near[n2]
        const dx = x - sx[b]
        const dz = z - sz[b]
        if (dx * dx + dz * dz < (sr[b] + s) * (sr[b] + s)) colBalls.push(b)
      }

      for (let j = 0; j < PY; j += 1) {
        const y = Y0 + (j - 1) * s
        let f = y - h
        if (f < AIR_MARGIN) {
          for (let c = 0; c < colBalls.length; c += 1) {
            const b = colBalls[c]
            const dx = x - sx[b]
            const dy = y - sy[b]
            const dz = z - sz[b]
            const m = sr[b] - Math.sqrt(dx * dx + dy * dy + dz * dz)
            if (m > f) f = m
          }
        }
        const fb = y - bed
        if (fb < f) f = fb
        field[(j * P + k) * P + i] = f
        if (f < 0) neg = true
        else pos = true
      }
    }
  }
  // All ground or all air: no surface in this chunk.
  if (!(neg && pos)) return null

  // --- Gradients at the corners we'll use (index 0 .. n on each axis) ---------
  const inv = 1 / (2 * s)
  for (let j = 1; j < PY - 1; j += 1) {
    for (let k = 1; k < P - 1; k += 1) {
      for (let i = 1; i < P - 1; i += 1) {
        const o = (j * P + k) * P + i
        gradX[o] = (field[o + 1] - field[o - 1]) * inv
        gradY[o] = (field[o + P * P] - field[o - P * P]) * inv
        gradZ[o] = (field[o + P] - field[o - P]) * inv
      }
    }
  }

  // --- Polygonise every cube of the chunk -------------------------------------
  count = 0
  const cornerIdx = new Int32Array(8)
  for (let j = 1; j <= ny; j += 1) {
    for (let k = 1; k <= n; k += 1) {
      for (let i = 1; i <= n; i += 1) {
        let inside = 0
        for (let c = 0; c < 8; c += 1) {
          const [ox, oy, oz] = CORNER[c]
          const o = ((j + oy) * P + (k + oz)) * P + (i + ox)
          cornerIdx[c] = o
          if (field[o] < 0) inside += 1
        }
        if (inside === 0 || inside === 8) continue

        for (let t = 0; t < 6; t += 1) {
          const tet = TETS[t]
          let mask = 0
          for (let v = 0; v < 4; v += 1) {
            const c = tet[v]
            const o = cornerIdx[c]
            const [ox, oy, oz] = CORNER[c]
            tp[v * 3] = X0 + (i + ox - 1) * s
            tp[v * 3 + 1] = Y0 + (j + oy - 1) * s
            tp[v * 3 + 2] = Z0 + (k + oz - 1) * s
            tf[v] = field[o]
            tg[v * 3] = gradX[o]
            tg[v * 3 + 1] = gradY[o]
            tg[v * 3 + 2] = gradZ[o]
            if (field[o] < 0) mask |= 1 << v
          }
          polygoniseTet(mask)
        }
      }
    }
  }
  if (count === 0) return null

  // --- Copy out with colours and uvs ---------------------------------------
  const positions = out.pos.slice(0, count * 3)
  const normals = out.nor.slice(0, count * 3)
  const colors = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  /** How deep inside the original rock each vertex is: the cave shader paints by it. */
  const depths = new Float32Array(count)
  for (let v = 0; v < count; v += 1) {
    const x = positions[v * 3]
    const y = positions[v * 3 + 1]
    const z = positions[v * 3 + 2]
    const nyv = normals[v * 3 + 1]
    // Surface height under the vertex, bilinear from the samples already taken.
    const fi = (x - X0) / s + 1
    const fk = (z - Z0) / s + 1
    const i0 = Math.min(P - 2, Math.max(0, Math.floor(fi)))
    const k0 = Math.min(P - 2, Math.max(0, Math.floor(fk)))
    const ax = fi - i0
    const az = fk - k0
    const h00 = surf[k0 * P + i0]
    const h10 = surf[k0 * P + i0 + 1]
    const h01 = surf[(k0 + 1) * P + i0]
    const h11 = surf[(k0 + 1) * P + i0 + 1]
    const h = h00 + (h10 - h00) * ax + (h01 - h00) * az + (h00 - h10 - h01 + h11) * ax * az
    const gx = (x - GRID.originX) / CELL
    const gz = (z - GRID.originZ) / CELL
    shade(colors, v * 3, nyv, h - y, gx, gz, h)
    // Dirt thrown out round the opening, on the dug ground's own surface.
    if (h - y < 0.4) holeShade(colors, v * 3, x, z, y, 0, true)
    depths[v] = h - y
    // Walls get vertical texture variation; flat ground matches the heightfield.
    const wall = 1 - Math.abs(nyv)
    uvs[v * 2] = (x + y * wall) * UV_SCALE
    uvs[v * 2 + 1] = (z + y * wall) * UV_SCALE
  }
  return { positions, normals, colors, uvs, depths, count }
}

/**
 * One tetrahedron's piece of surface. Bit v of `mask` is set when corner v is
 * inside the ground. Winding is fixed up in tri() from the field gradient.
 */
function polygoniseTet(mask) {
  switch (mask) {
    case 0x0:
    case 0xf:
      return
    // One corner differs from the other three: one triangle.
    case 0x1:
    case 0xe:
      edge(0, 1, 0)
      edge(0, 2, 1)
      edge(0, 3, 2)
      tri(0, 1, 2)
      return
    case 0x2:
    case 0xd:
      edge(1, 0, 0)
      edge(1, 3, 1)
      edge(1, 2, 2)
      tri(0, 1, 2)
      return
    case 0x4:
    case 0xb:
      edge(2, 0, 0)
      edge(2, 1, 1)
      edge(2, 3, 2)
      tri(0, 1, 2)
      return
    case 0x8:
    case 0x7:
      edge(3, 0, 0)
      edge(3, 2, 1)
      edge(3, 1, 2)
      tri(0, 1, 2)
      return
    // Two and two: a quad.
    case 0x3:
    case 0xc:
      edge(0, 3, 0)
      edge(0, 2, 1)
      edge(1, 2, 2)
      edge(1, 3, 3)
      tri(0, 1, 2)
      tri(0, 2, 3)
      return
    case 0x5:
    case 0xa:
      edge(0, 1, 0)
      edge(2, 1, 1)
      edge(2, 3, 2)
      edge(0, 3, 3)
      tri(0, 1, 2)
      tri(0, 2, 3)
      return
    case 0x6:
    case 0x9:
      edge(0, 1, 0)
      edge(1, 3, 1)
      edge(2, 3, 2)
      edge(0, 2, 3)
      tri(0, 1, 2)
      tri(0, 2, 3)
      return
    default:
  }
}
