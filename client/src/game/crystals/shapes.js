import { SHAPES } from '@shared/catalog.js'

import { GeoBuilder } from '../world/geoBuilder'

/**
 * Procedural low-poly crystal meshes, one per shape, ~1 unit tall with the base
 * at y = 0. Vertex colours are a white/grey mask: the per-instance colour of each
 * crystal type multiplies it, so details (beaks, spots, eyes) come out as darker or
 * lighter shades of the body colour.
 */

const W = '#ffffff'
const MID = '#9a9a9a'
const DARK = '#3a3a3a'

/** Crystal spikes sprouting from a creature: [x, y, z, radius, height, tilt x, tilt z]. */
function spikes(b, list) {
  for (const [x, y, z, r, h, rx, rz] of list) b.crystal(x, y, z, r, h, W, { rx, rz, jitter: 0.15 })
}

const builders = {
  cluster(b) {
    b.dodeca(0, 0.08, 0, 0.35, MID, { sy: 0.4 })
    const tips = [
      [0, 0, 0, 0.17, 0.95],
      [0.2, 0.3, 0.1, 0.12, 0.7],
      [-0.22, -0.35, 0.05, 0.13, 0.65],
      [0.05, 0.1, -0.4, 0.11, 0.6],
      [-0.1, -0.15, 0.35, 0.1, 0.55],
      [0.28, -0.05, -0.3, 0.09, 0.45],
    ]
    for (const [x, rz, rx, r, h] of tips) b.crystal(x, 0.05, rx * 0.5, r, h, W, { rz, rx, jitter: 0.2 })
  },
  column(b) {
    b.crystal(0, 0, 0, 0.2, 0.55, W, { jitter: 0.15 })
    b.crystal(0.05, 0.4, 0.02, 0.17, 0.5, W, { rz: -0.12, jitter: 0.15 })
    b.crystal(0.1, 0.78, 0.04, 0.13, 0.32, W, { rz: -0.2, jitter: 0.15 })
    b.box(0, 0.04, 0, 0.5, 0.08, 0.5, MID)
  },
  obelisk(b) {
    b.box(0, 0.4, 0, 0.32, 0.8, 0.32, W, { jitter: 0.12 })
    b.cone(0, 0.92, 0, 0.23, 0.25, W, { seg: 4, ry: Math.PI / 4 })
    b.box(0, 0.04, 0, 0.5, 0.08, 0.5, MID)
  },
  shard(b) {
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2
      b.crystal(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08, 0.06, 0.55 + (i % 3) * 0.18, W, {
        rx: Math.sin(a) * 0.5,
        rz: -Math.cos(a) * 0.5,
        jitter: 0.25,
      })
    }
    b.crystal(0, 0, 0, 0.08, 1, W)
  },
  geode(b) {
    b.ico(0, 0.45, 0, 0.45, W, { jitter: 0.25 })
    b.ico(0.12, 0.62, 0.3, 0.16, MID)
    spikes(b, [
      [0.1, 0.55, 0.32, 0.07, 0.3, 1.0, -0.3],
      [0.2, 0.6, 0.25, 0.06, 0.24, 0.8, -0.8],
      [0.02, 0.62, 0.3, 0.05, 0.22, 0.9, 0.3],
    ])
  },
  beetle(b) {
    b.sphere(0, 0.18, 0, 0.42, W, { sy: 0.55, seg: 8, rings: 5, jitter: 0.1 })
    b.sphere(0, 0.18, 0.4, 0.17, DARK, { seg: 6, rings: 4 })
    for (const [x, z] of [[0.18, 0.05], [-0.2, -0.12], [0.1, -0.25], [-0.12, 0.18]]) {
      b.sphere(x, 0.38, z, 0.07, DARK, { seg: 5, rings: 3, sy: 0.5 })
    }
    b.box(0, 0.4, -0.02, 0.02, 0.06, 0.7, DARK)
    spikes(b, [
      [0.12, 0.3, -0.05, 0.07, 0.32, -0.2, -0.45],
      [-0.12, 0.3, -0.1, 0.06, 0.28, -0.3, 0.45],
      [0, 0.32, -0.22, 0.07, 0.36, -0.55, 0],
    ])
  },
  duck(b) {
    b.sphere(0, 0.3, 0, 0.32, W, { sz: 1.2, sy: 0.85, seg: 8, rings: 6 })
    b.sphere(0, 0.68, 0.18, 0.2, W, { seg: 8, rings: 6 })
    b.box(0, 0.64, 0.42, 0.16, 0.06, 0.16, MID)
    b.sphere(0.1, 0.74, 0.32, 0.03, DARK, { seg: 4, rings: 3 })
    b.sphere(-0.1, 0.74, 0.32, 0.03, DARK, { seg: 4, rings: 3 })
    b.cone(0, 0.42, -0.36, 0.1, 0.22, W, { rx: -1.2, seg: 4 })
    spikes(b, [
      [0, 0.82, 0.12, 0.05, 0.24, -0.3, 0],
      [0.06, 0.8, 0.08, 0.04, 0.18, -0.2, -0.5],
      [-0.06, 0.8, 0.08, 0.04, 0.18, -0.2, 0.5],
    ])
  },
  bird(b) {
    b.sphere(0, 0.42, 0, 0.26, W, { sy: 1.3, seg: 7, rings: 5 })
    b.sphere(0, 0.82, 0.05, 0.18, W, { seg: 7, rings: 5 })
    b.cone(0, 0.78, 0.26, 0.07, 0.18, DARK, { rx: Math.PI / 2, seg: 4 })
    b.box(0.25, 0.45, -0.02, 0.06, 0.4, 0.3, MID, { rz: -0.25 })
    b.box(-0.25, 0.45, -0.02, 0.06, 0.4, 0.3, MID, { rz: 0.25 })
    b.box(0, 0.15, -0.28, 0.16, 0.35, 0.05, MID, { rx: 0.6 })
    b.sphere(0.08, 0.87, 0.18, 0.03, DARK, { seg: 4, rings: 3 })
    b.sphere(-0.08, 0.87, 0.18, 0.03, DARK, { seg: 4, rings: 3 })
    spikes(b, [
      [0, 0.96, 0.0, 0.05, 0.26, -0.5, 0],
      [0, 0.94, -0.06, 0.04, 0.2, -0.9, 0],
      [0.05, 0.2, -0.32, 0.05, 0.35, -2.2, -0.2],
      [-0.05, 0.2, -0.32, 0.05, 0.35, -2.2, 0.2],
    ])
  },
  critter(b) {
    b.sphere(0, 0.3, 0, 0.26, W, { sz: 1.7, seg: 8, rings: 5, jitter: 0.08 })
    b.sphere(0, 0.42, 0.48, 0.2, W, { seg: 8, rings: 5 })
    for (const [x, z] of [[0.16, 0.25], [-0.16, 0.25], [0.16, -0.25], [-0.16, -0.25]]) {
      b.box(x, 0.1, z, 0.1, 0.22, 0.1, MID)
    }
    b.cone(0, 0.32, -0.6, 0.1, 0.4, W, { rx: -Math.PI / 2, seg: 5 })
    // Frills (gills / ears).
    b.cone(0.17, 0.6, 0.45, 0.05, 0.2, MID, { rz: -0.6, seg: 4 })
    b.cone(-0.17, 0.6, 0.45, 0.05, 0.2, MID, { rz: 0.6, seg: 4 })
    b.sphere(0.09, 0.47, 0.64, 0.035, DARK, { seg: 4, rings: 3 })
    b.sphere(-0.09, 0.47, 0.64, 0.035, DARK, { seg: 4, rings: 3 })
    spikes(b, [
      [0, 0.48, 0.2, 0.06, 0.26, -0.25, 0],
      [0, 0.5, 0.0, 0.07, 0.32, -0.35, 0],
      [0, 0.48, -0.2, 0.06, 0.28, -0.5, 0],
      [0.08, 0.44, -0.05, 0.04, 0.18, -0.3, -0.6],
      [-0.08, 0.44, 0.08, 0.04, 0.18, -0.3, 0.6],
    ])
  },
  egg(b) {
    b.ico(0, 0.5, 0, 0.38, W, { detail: 1, sy: 1.35, jitter: 0.12 })
    b.crystal(0.15, 0.55, 0.25, 0.06, 0.25, MID, { rx: 1, rz: -0.4 })
    b.crystal(-0.2, 0.35, 0.18, 0.05, 0.2, MID, { rx: 0.9, rz: 0.6 })
  },
  star(b) {
    b.octa(0, 0.5, 0, 0.3, W)
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2
      b.cone(Math.cos(a) * 0.32, 0.5, Math.sin(a) * 0.32, 0.09, 0.38, W, { rz: Math.PI / 2, ry: -a, seg: 4 })
    }
    b.cone(0, 0.92, 0, 0.09, 0.32, W, { seg: 4 })
    b.cone(0, 0.08, 0, 0.09, 0.32, MID, { seg: 4, rx: Math.PI })
  },
}

const cache = new Map()

/** Merged geometry for a shape, cached for the session. */
export function shapeGeometry(shape) {
  if (cache.has(shape)) return cache.get(shape)
  const b = new GeoBuilder()
  ;(builders[shape] ?? builders.cluster)(b)
  const geo = b.build()
  cache.set(shape, geo)
  return geo
}

export { SHAPES }
