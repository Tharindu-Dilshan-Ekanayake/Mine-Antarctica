import { BufferAttribute, BufferGeometry, Color } from 'three'

import { PICKAXE_BY_ID } from '@shared/catalog.js'

import { GeoBuilder } from '../world/geoBuilder'
import { pickaxeStyle } from './pickaxeStyles'

/**
 * Held-pickaxe meshes: one merged geometry per pickaxe type (plus a glowing part for
 * the fancy ones), cached for the session and shared by every avatar holding it.
 *
 * Built in "arm space": the pivot is the shoulder, the hand hangs at y = -HAND, the
 * handle points forward (+Z) and the head sits across its far end, its points
 * curving back toward the hand like a real pickaxe.
 */
export const SHOULDER = { x: -0.36, y: 1.36, z: 0 }
export const HAND = 0.68
/** Distance along the handle (from the hand) to the head. */
export const HEAD_Z = 0.98
/** Overall size of the held tool. */
const TOOL_SCALE = 1.2

const cache = new Map()
const _c = new Color()
const lighten = (hex, k) => `#${_c.set(hex).lerp(new Color('#ffffff'), k).getHexString()}`
const darken = (hex, k) => `#${_c.set(hex).multiplyScalar(1 - k).getHexString()}`

/** Point on one curved arm of the head, u = 0 at the collar .. 1 at the tip. */
function armPoint(style, side, u) {
  const y = side * (0.07 + u * style.length)
  const z = HEAD_Z - style.curve * 0.32 * u * u
  return [y, z]
}

/** A tapered, bevelled, curved pick arm ending in a point. */
function pickArm(b, glow, style, side, rarity) {
  const SEG = 4
  const y0 = -HAND
  const spine = darken(style.head, 0.35)
  for (let s = 0; s < SEG; s += 1) {
    const u0 = s / SEG
    const u1 = (s + 1) / SEG
    const [ya, za] = armPoint(style, side, u0)
    const [yb, zb] = armPoint(style, side, u1)
    const len = Math.hypot(yb - ya, zb - za)
    // Rotating +Y about X by `rx` points it along this segment.
    const rx = Math.atan2(zb - za, yb - ya)
    // Perpendicular in the YZ plane, flipped so it always faces away from the hand.
    const flip = Math.cos(rx) >= 0 ? 1 : -1
    const ny = -Math.sin(rx) * flip
    const nz = Math.cos(rx) * flip
    const w = 0.2 * (1 - u0 * 0.65)
    const my = (ya + yb) / 2
    const mz = (za + zb) / 2
    // Body, a bright bevel on the outer face, and a dark spine on the inner one.
    b.box(0, y0 + my, mz, w * 0.95, len * 1.08, w, style.head, { rx, jitter: 0.06 })
    b.box(0, y0 + my + ny * w * 0.42, mz + nz * w * 0.42, w * 0.45, len * 1.04, w * 0.22, style.edge, { rx })
    b.box(0, y0 + my - ny * w * 0.42, mz - nz * w * 0.42, w * 0.5, len * 1.04, w * 0.18, spine, { rx })
  }
  // The point, continuing the last segment's direction.
  const [yt, zt] = armPoint(style, side, 1)
  const [yp, zp] = armPoint(style, side, 0.92)
  const dir = Math.atan2(zt - zp, yt - yp)
  const tipLen = 0.17
  const target = rarity >= 3 && style.glow ? glow : b
  target.cone(0, y0 + yt + Math.cos(dir) * tipLen * 0.45, zt + Math.sin(dir) * tipLen * 0.45, 0.05, tipLen, rarity >= 3 && style.glow ? style.glow : style.edge, {
    rx: dir,
    seg: 4,
  })
}

/** A flat, wide chopping blade (the adze side). */
function blade(b, glow, style, side, rarity) {
  const y0 = -HAND
  const [ym, zm] = armPoint(style, side, 0.45)
  const [ye, ze] = armPoint(style, side, 0.9)
  b.box(0, y0 + ym, zm, 0.11, style.length * 0.55, 0.15, style.head, { rx: 0.15 * side, jitter: 0.06 })
  // Fan-shaped cutting edge.
  b.box(0, y0 + ye, ze, 0.08, 0.1, 0.34, style.edge, { rx: 0.1 * side })
  b.box(0, y0 + ye - side * 0.03, ze, 0.12, 0.12, 0.26, style.head, { rx: 0.1 * side })
  if (rarity >= 3 && glow && style.glow) glow.box(0, y0 + ye + side * 0.06, ze, 0.05, 0.04, 0.36, style.glow)
}

/** Head grown from crystal shards along the arm. */
function crystalArm(b, glow, style, side, rarity) {
  const y0 = -HAND
  const target = glow && rarity >= 3 ? glow : b
  for (let k = 0; k < 4; k += 1) {
    const u = 0.2 + k * 0.22
    const [y, z] = armPoint(style, side, u)
    const r = 0.075 * (1 - k * 0.15)
    const h = 0.18 + (3 - k) * 0.03
    // Shards lean outward along the arm, alternating front/back.
    target.crystal(0, y0 + y - side * h * 0.3, z + (k % 2 ? 0.03 : -0.03), r, h, k % 2 ? style.edge : style.head, {
      rz: 0,
      rx: side > 0 ? -0.2 - u * 0.5 : Math.PI + 0.2 + u * 0.5,
      jitter: 0.12,
    })
  }
  // A dark stone core holding the shards.
  const [ym, zm] = armPoint(style, side, 0.45)
  b.box(0, y0 + ym, zm, 0.1, style.length * 0.7, 0.1, darken(style.head, 0.55), { rx: 0.12 * side })
  const [yt, zt] = armPoint(style, side, 1)
  target.cone(0, y0 + yt, zt, 0.06, 0.2, style.edge, { rx: side > 0 ? -0.35 : Math.PI + 0.35, seg: 4 })
}

function buildTool(id) {
  const def = PICKAXE_BY_ID[id]
  const style = pickaxeStyle(id)
  const rarity = def?.rarity ?? 0
  const b = new GeoBuilder()
  const glow = new GeoBuilder()
  const y = -HAND

  // --- Handle: shaft, grip wrap, bands, pommel ---------------------------------
  b.cyl(0, y, 0.4, 0.036, 0.042, 1.16, style.handle, { rx: Math.PI / 2, seg: 6, jitter: 0.08 })
  // Lighter grain stripe on the shaft.
  b.box(0.03, y + 0.012, 0.45, 0.012, 0.012, 0.95, lighten(style.handle, 0.3))
  for (let k = 0; k < 3; k += 1) {
    b.cyl(0, y, -0.1 + k * 0.1, 0.05, 0.05, 0.07, k % 2 ? darken(style.grip, 0.25) : style.grip, {
      rx: Math.PI / 2,
      seg: 6,
    })
  }
  const pommel = rarity >= 2 ? style.collar : darken(style.handle, 0.3)
  b.sphere(0, y, -0.2, 0.06, pommel, { seg: 6, rings: 4 })
  if (rarity >= 1) b.cyl(0, y, 0.62, 0.05, 0.05, 0.03, style.collar, { rx: Math.PI / 2, seg: 6 })

  // --- Collar where the head meets the shaft -----------------------------------
  b.box(0, y, HEAD_Z, 0.17, 0.26, 0.24, style.collar, { jitter: 0.05 })
  b.cyl(0, y, HEAD_Z - 0.13, 0.055, 0.06, 0.06, darken(style.collar, 0.3), { rx: Math.PI / 2, seg: 6 })
  if (rarity >= 1) {
    for (const s of [-1, 1]) b.sphere(s * 0.07, y + s * 0.06, HEAD_Z, 0.022, lighten(style.collar, 0.5), { seg: 4, rings: 3 })
  }

  // --- Head ----------------------------------------------------------------------
  for (const side of [1, -1]) {
    if (style.shape === 'crystal') crystalArm(b, glow, style, side, rarity)
    else if (style.shape === 'adze' && side < 0) blade(b, glow, style, side, rarity)
    else pickArm(b, glow, style, side, rarity)
  }

  // --- Gem on both faces of the collar -----------------------------------------
  if (style.gem) {
    const g = rarity >= 3 ? glow : b
    for (const s of [-1, 1]) g.octa(s * 0.072, y, HEAD_Z, 0.055, style.gem, { sx: 0.5 })
  }
  // A floating crown of sparks around the legendary/mythic heads.
  if (rarity >= 4 && style.glow) {
    for (let k = 0; k < 6; k += 1) {
      const a = (k / 6) * Math.PI * 2
      glow.octa(Math.cos(a) * 0.16, y + Math.sin(a) * 0.16, HEAD_Z + 0.08, 0.03, style.glow)
    }
  }

  const solid = b.build()
  const glowGeo = glow.parts.length ? glow.build() : null
  // Chunky, readable tools: scale about the hand so the grip stays in the fist.
  for (const g of [solid, glowGeo]) {
    if (!g) continue
    g.translate(0, HAND, 0)
    g.scale(TOOL_SCALE, TOOL_SCALE, TOOL_SCALE)
    g.translate(0, -HAND, 0)
  }
  return { solid, glow: glowGeo, style }
}

/** { solid, glow, style } for a pickaxe id; cached. */
export function toolGeometry(pickaxeId) {
  const id = PICKAXE_BY_ID[pickaxeId] ? pickaxeId : 'rusted'
  if (!cache.has(id)) cache.set(id, buildTool(id))
  return cache.get(id)
}

/**
 * The swoosh left behind the head during a swing: a fan in the shoulder's YZ plane,
 * from the head's position back along its arc. Vertex colour fades it toward the
 * tail, so with additive blending the tail melts away.
 */
let trailGeo = null
export function trailGeometry() {
  if (trailGeo) return trailGeo
  const SEG = 14
  const SWEEP = 1.5
  const head = [-HAND, HEAD_Z * TOOL_SCALE]
  const R = Math.hypot(head[0], head[1])
  const base = Math.atan2(head[1], head[0])
  const pos = []
  const col = []
  for (let s = 0; s <= SEG; s += 1) {
    const k = s / SEG
    const a = base - k * SWEEP
    const fade = (1 - k) ** 1.6
    for (const r of [R - 0.32, R + 0.12]) {
      pos.push(0, Math.cos(a) * r, Math.sin(a) * r)
      col.push(fade, fade, fade)
    }
  }
  const index = []
  for (let s = 0; s < SEG; s += 1) {
    const a = s * 2
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  trailGeo = new BufferGeometry()
  trailGeo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  trailGeo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  trailGeo.setIndex(index)
  return trailGeo
}
