import { CAULDRON, GATE, PLAZA, PLOT_SIZE, plotGateDir, PLOTS, SPAWN, STALLS, TREADMILLS } from '@shared/world.js'

import { mulberry32 } from '@shared/rng.js'
import { GeoBuilder } from '../world/geoBuilder'
import { addBoxCollider, addCircleCollider, clearColliders } from '../world/ground'

/**
 * The base (lobby): every static prop, merged into two meshes.
 *
 *   solid - wood, metal, snow, NPCs, pumpkins... (matte)
 *   glow  - crystal statues, bulbs, lantern glass, cauldron brew (self-lit)
 *
 * Colliders are registered here too, so the geometry and what you bump into can't
 * drift apart.
 */

const WOOD = '#3a3330'
const WOOD_DARK = '#2a2422'
const RUST = '#8a5a3c'
const SNOW = '#f2f6fb'
const IRON = '#23252b'

/** Stall front opening faces +Z. Exported so signs/labels can align with it. */
export const STALL_SIGN_Y = 6.4

/** Leaderboard panel placement, shared with the texture renderer. */
export const BOARDS = [
  { x: 18, z: -44, w: 12, h: 7, y: 4.6, title: 'MOST CRYSTALS MINED' },
  { x: 34, z: -44, w: 12, h: 7, y: 4.6, title: 'RICHEST MINERS' },
]

/**
 * Plot info boards, on each plot's back fence (opposite its gate), facing into the plot
 * and across to the corridor. `ry` turns a back-row board round to face north.
 */
export const PLOT_BOARDS = PLOTS.map((p, i) => {
  const dir = plotGateDir(i)
  return { x: p.x - 4.5, z: p.z - dir * (PLOT_SIZE / 2 + 0.2), w: 6.4, h: 3.2, y: 2.6, ry: dir > 0 ? 0 : Math.PI, face: dir }
})

/**
 * The big name sign over each garden's entrance (south side): the owner's name, readable
 * from both sides. `x, y, z` is the sign's centre.
 */
export const PLOT_NAME_BOARDS = PLOTS.map((p, i) => ({ x: p.x, z: p.z + plotGateDir(i) * (PLOT_SIZE / 2), w: 7.2, h: 1.8, y: 3.7 }))

/** Each plot's accent colour: its corner stones and its name sign. */
export const PLOT_TINTS = ['#7fe6ff', '#ff9ccf', '#8cf03c', '#ffd23a', '#c9a7ff', '#ff8a1e', '#5ee0c8', '#ff5a7a']

/** Lamp posts carrying the string lights. */
const LAMPS = [
  [-70, -50], [-46, -50], [-24, -50], [-9, -50], [9, -50], [30, -50], [52, -50], [70, -50],
  [-70, -20], [-70, 12], [-70, 48], [70, -20], [70, 12], [70, 48],
  [-40, 48], [-12, 48], [12, 48], [40, 48],
]

function fence(b, x0, z0, x1, z1, { height = 1.5, post = 2.6, collide = true, color = WOOD } = {}) {
  const dx = x1 - x0
  const dz = z1 - z0
  const len = Math.hypot(dx, dz)
  const ry = Math.atan2(dx, dz)
  const n = Math.max(1, Math.round(len / post))
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    b.box(x0 + dx * t, height / 2, z0 + dz * t, 0.34, height + 0.2, 0.34, WOOD_DARK)
  }
  const mx = (x0 + x1) / 2
  const mz = (z0 + z1) / 2
  for (const y of [height * 0.38, height * 0.85]) {
    b.box(mx, y, mz, 0.16, 0.26, len, color, { ry })
  }
  if (collide) {
    const horizontal = Math.abs(dx) > Math.abs(dz)
    addBoxCollider(mx, mz, horizontal ? len / 2 : 0.3, horizontal ? 0.3 : len / 2)
  }
}

function stall(b, glow, s) {
  const { x, z, colors } = s
  // Counter and back shelf.
  b.box(x, 0.6, z + 1.6, 8, 1.2, 1.4, WOOD)
  b.box(x, 1.25, z + 1.6, 8.4, 0.12, 1.7, '#5b5049')
  b.box(x, 1.4, z - 1.8, 8, 2.8, 0.5, WOOD_DARK)
  // Posts: taller at the back so the awning slopes towards the front.
  for (const sx of [-3.9, 3.9]) {
    b.box(x + sx, 2.2, z - 1.8, 0.35, 4.4, 0.35, WOOD_DARK)
    b.box(x + sx, 1.75, z + 2.4, 0.35, 3.5, 0.35, WOOD_DARK)
  }
  // Striped awning: 8 slanted planks alternating the stall colours.
  const slope = Math.atan2(4.4 - 3.5, 4.2)
  for (let i = 0; i < 8; i += 1) {
    b.box(x - 3.5 + i, 4.05, z + 0.3, 1.02, 0.18, 5.2, colors[i % 2], { rx: slope })
  }
  // Scalloped front edge.
  for (let i = 0; i < 8; i += 1) {
    b.box(x - 3.5 + i, 3.45, z + 2.85, 1.0, 0.5, 0.12, colors[i % 2])
  }
  // A blanket of snow on the awning, lumpy at the ridge.
  b.box(x, 4.2, z + 0.1, 8.3, 0.16, 4.6, SNOW, { rx: slope })
  for (let i = 0; i < 5; i += 1) b.sphere(x - 3.2 + i * 1.6, 4.45, z - 1.2, 0.45, SNOW, { sy: 0.45, seg: 6, rings: 3 })
  icicles(glow, x - 3.9, x + 3.9, 3.2, z + 2.95)
  // The keeper behind the counter is drawn by <Shopkeepers>.
  // Crates and sacks.
  b.box(x - 4.8, 0.45, z + 1.2, 0.9, 0.9, 0.9, '#7a5a34', { ry: 0.3 })
  b.sphere(x + 4.9, 0.5, z + 1.9, 0.6, '#d8c06a', { sy: 0.8 })
  // A few display crystals on the counter.
  glow.crystal(x - 2.5, 1.3, z + 1.5, 0.18, 0.7, colors[0])
  glow.crystal(x + 2.2, 1.3, z + 1.6, 0.15, 0.55, '#7fe6ff', { rz: 0.3 })
  addBoxCollider(x, z + 0.4, 4.3, 2.4)
}

function gate(b, glow) {
  const { x, z, halfWidth } = GATE
  for (const side of [-1, 1]) {
    const px = x + side * (halfWidth + 0.6)
    b.box(px, 4.5, z, 1.7, 9, 1.7, RUST, { jitter: 0.15, seed: side })
    b.box(px, 0.3, z, 2.2, 0.6, 2.2, WOOD_DARK)
    b.box(px, 9.1, z, 2.1, 0.4, 2.1, WOOD_DARK)
    addBoxCollider(px, z, 1.1, 1.1)
    // Hanging lanterns.
    b.box(x + side * 3.2, 7.9, z, 0.08, 1.2, 0.08, IRON)
    b.box(x + side * 3.2, 7.0, z, 0.55, 0.75, 0.55, IRON)
    glow.box(x + side * 3.2, 7.0, z, 0.4, 0.55, 0.4, '#ffce6b')
  }
  b.box(x, 9.6, z, halfWidth * 2 + 4, 1.0, 1.4, WOOD)
  b.box(x, 10.3, z, halfWidth * 2 + 2, 0.4, 1.0, WOOD_DARK)
  b.box(x, 10.62, z, halfWidth * 2 + 2.2, 0.28, 1.15, SNOW)
  icicles(glow, x - halfWidth - 1.8, x + halfWidth + 1.8, 9.1, z + 0.72)
  icicles(glow, x - halfWidth - 1.8, x + halfWidth + 1.8, 9.1, z - 0.72)
  // Zone-coloured pennants strung across the gate.
  const zoneColors = ['#e8d9a8', '#5ee05e', '#4aa8ff', '#c06bff', '#ffb52e', '#ff4f9a']
  for (let i = 0; i < 12; i += 1) {
    const px = x - halfWidth + 0.6 + i * ((halfWidth * 2 - 1.2) / 11)
    const sag = Math.sin((i / 11) * Math.PI) * 0.9
    b.cone(px, 8.3 - sag, z + 0.75, 0.32, 0.7, zoneColors[i % 6], { rx: Math.PI, seg: 3 })
  }
  for (const side of [-1, 1]) {
    b.box(x + side * (halfWidth + 0.6), 9.42, z, 2.3, 0.18, 2.3, SNOW)
  }
  // Cobweb-ish corner braces.
  for (const side of [-1, 1]) {
    b.box(x + side * (halfWidth - 0.6), 8.6, z, 0.25, 1.8, 0.25, WOOD_DARK, { rz: side * 0.7 })
  }
  // Chevron ramp leading out to the mountain.
  for (let i = 0; i < 2; i += 1) {
    b.box(x - 2.6 + i * 5.2, 0.06, z - 5, 3.6, 0.12, 6, '#2c2f36', { rx: -0.03 })
  }
}

/** A row of hanging icicles from (x0..x1, y, z). */
function icicles(glow, x0, x1, y, z) {
  const n = Math.max(3, Math.round((x1 - x0) / 0.55))
  for (let i = 0; i <= n; i += 1) {
    const len = 0.25 + ((i * 7919) % 5) * 0.12
    glow.cone(x0 + ((x1 - x0) * i) / n, y - len / 2, z, 0.07, len, '#cfefff', { rx: Math.PI, seg: 4 })
  }
}

/** Domed ice-block igloo with an entrance tunnel facing +Z. */
export const IGLOO = { x: 58, z: -28, r: 4.2 }
function igloo(b, glow) {
  const { x, z, r } = IGLOO
  const rings = 5
  for (let k = 0; k < rings; k += 1) {
    const a0 = (k / rings) * (Math.PI / 2)
    const ringR = Math.cos(a0) * r
    const y = Math.sin(a0) * r
    const blocks = Math.max(4, Math.round((ringR * Math.PI * 2) / 1.3))
    for (let i = 0; i < blocks; i += 1) {
      const t = (i + (k % 2) * 0.5) / blocks
      const a = t * Math.PI * 2
      // Blocks sit just proud of the dome so the seams read.
      b.box(x + Math.cos(a) * (ringR + 0.05), y + 0.4, z + Math.sin(a) * (ringR + 0.05), 1.2, 0.8, 0.3, i % 3 ? '#eaf4ff' : '#d6e8fa', {
        ry: -a + Math.PI / 2,
      })
    }
  }
  b.sphere(x, 0, z, r * 0.98, '#e4f0fc', { seg: 12, rings: 6, sy: 1.02, jitter: 0.04 })
  // Tunnel and dark doorway.
  b.box(x, 1, z + r + 0.6, 2.4, 2, 2.2, '#e8f2fd')
  b.box(x, 0.85, z + r + 1.72, 1.3, 1.6, 0.06, '#1b2433')
  glow.box(x, 0.55, z + r + 1.68, 1.0, 0.9, 0.04, '#ffb347')
  addCircleCollider(x, z, r + 0.3)
  addBoxCollider(x, z + r + 0.6, 1.3, 1.2)
}

function snowman(b, x, z, ry) {
  b.sphere(x, 0.9, z, 1.0, SNOW, { seg: 10, rings: 7 })
  b.sphere(x, 2.25, z, 0.72, SNOW, { seg: 10, rings: 7 })
  b.sphere(x, 3.25, z, 0.5, SNOW, { seg: 10, rings: 7 })
  const fx = Math.sin(ry)
  const fz = Math.cos(ry)
  b.cone(x + fx * 0.6, 3.25, z + fz * 0.6, 0.08, 0.45, '#ff7a1a', { rx: Math.PI / 2, ry, seg: 5 })
  for (const s of [-1, 1]) {
    b.sphere(x + fx * 0.44 + fz * s * 0.17, 3.4, z + fz * 0.44 - fx * s * 0.17, 0.06, '#111', { seg: 4, rings: 3 })
  }
  b.cyl(x, 3.75, z, 0.38, 0.38, 0.5, '#1d1f2b', { seg: 8 })
  b.cyl(x, 3.52, z, 0.58, 0.58, 0.06, '#1d1f2b', { seg: 8 })
  b.cyl(x, 2.82, z, 0.58, 0.62, 0.2, '#e0262b', { seg: 8 })
  for (let i = 0; i < 3; i += 1) b.sphere(x + fx * 0.7, 2.0 + i * 0.3, z + fz * 0.7, 0.06, '#111', { seg: 4, rings: 3 })
  addCircleCollider(x, z, 1.1)
}

/** Frozen pond the penguins love. */
export const POND = { x: -24, z: 36, r: 7, ice: 0.2 }
function pond(b) {
  const { x, z, r } = POND
  // Snow bank around the edge, sloping down to the plaza.
  b.cyl(x, 0.06, z, r + 0.6, r + 1.5, 0.12, '#f4f8fd', { seg: 24 })
  // The ice: a darker deep-water ring under a bright slab.
  b.cyl(x, 0.08, z, r, r, 0.16, '#5fb6e6', { seg: 24 })
  b.cyl(x, 0.18, z, r - 0.5, r - 0.2, 0.04, '#9fdcf8', { seg: 24 })
  // Glassy sheen patches.
  b.cyl(x - 1.5, 0.22, z + 1, r * 0.42, r * 0.42, 0.04, '#d4f1ff', { seg: 14 })
  b.cyl(x + 2.4, 0.22, z - 2, r * 0.18, r * 0.18, 0.04, '#d4f1ff', { seg: 10 })
  // A few cracks in the ice.
  for (const [cx, cz, len, ry] of [[1.2, 1.6, 2.6, 0.5], [-2.6, -1.4, 2.2, 2.1], [0.4, -3.1, 1.8, 1.2]]) {
    b.box(x + cx, 0.27, z + cz, 0.06, 0.02, len, '#ffffff', { ry })
  }
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI * 2
    b.ico(x + Math.cos(a) * (r + 1), 0.15, z + Math.sin(a) * (r + 1), 0.55 + (i % 3) * 0.2, SNOW, { sy: 0.5, jitter: 0.05 })
  }
}

/**
 * A treadmill's frame: a steel bed, low curbs along both sides with a glowing strip,
 * and lit arrow posts at each end pointing the way it runs. (The moving belt itself is
 * its own animated mesh, see Treadmills.jsx.)
 */
function treadmill(b, glow, t) {
  const len = t.x1 - t.x0
  const mx = (t.x0 + t.x1) / 2
  const color = t.dir > 0 ? '#3df0ff' : '#ffd23a'
  b.box(mx, 0.03, t.z, len + 0.6, 0.06, t.w + 0.5, '#2a2e38')
  for (const side of [-1, 1]) {
    const z = t.z + side * (t.w / 2 + 0.12)
    b.box(mx, 0.1, z, len + 0.6, 0.2, 0.22, '#3a404c')
    glow.box(mx, 0.21, z, len + 0.4, 0.03, 0.08, color)
  }
  // End caps, and an arrow post at the start of each lane.
  for (const x of [t.x0 - 0.3, t.x1 + 0.3]) b.box(x, 0.08, t.z, 0.3, 0.16, t.w + 0.5, '#4a5160')
  const start = t.dir > 0 ? t.x0 - 1.2 : t.x1 + 1.2
  b.box(start, 1.1, t.z + (t.dir > 0 ? -1 : 1) * (t.w / 2 + 0.5), 0.16, 2.2, 0.16, '#23252b')
  const ax = start + t.dir * 0.2
  const az = t.z + (t.dir > 0 ? -1 : 1) * (t.w / 2 + 0.5)
  glow.box(ax, 2.25, az, 0.9, 0.5, 0.08, color)
  glow.box(ax + t.dir * 0.55, 2.25, az, 0.3, 0.3, 0.08, color, { rz: Math.PI / 4 })
}

function lampPost(b, glow, x, z) {
  b.cyl(x, 2.8, z, 0.14, 0.2, 5.6, IRON, { seg: 6 })
  b.box(x, 5.7, z, 0.7, 0.18, 0.7, IRON)
  glow.box(x, 5.3, z, 0.42, 0.55, 0.42, '#ffd27a')
  addCircleCollider(x, z, 0.35)
}

/** Sagging string of bulbs between two posts. */
function stringLights(b, glow, x0, z0, x1, z1, rand) {
  const n = Math.max(4, Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.6))
  const palette = ['#ffd85c', '#ffb347', '#fff2b3', '#ff9f43']
  for (let i = 1; i < n; i += 1) {
    const t = i / n
    const sag = Math.sin(t * Math.PI) * 1.2
    const x = x0 + (x1 - x0) * t
    const z = z0 + (z1 - z0) * t
    const y = 5.6 - sag
    b.box(x, y + 0.12, z, 0.05, 0.12, 0.05, '#1b1b1b')
    glow.octa(x, y, z, 0.15, palette[Math.floor(rand() * palette.length)])
  }
}

function pumpkin(b, x, z, r, rand) {
  b.sphere(x, r * 0.8, z, r, '#ff7a1a', { sy: 0.78, seg: 8, rings: 6, jitter: 0.12, seed: x })
  b.cyl(x, r * 1.55, z, 0.06 * r * 3, 0.08 * r * 3, r * 0.5, '#3f6b21', { seg: 5, rz: (rand() - 0.5) * 0.4 })
}

function deadTree(b, x, z, h, rand) {
  b.cyl(x, h / 2, z, 0.12, 0.32, h, '#2b2522', { seg: 5 })
  for (let i = 0; i < 4; i += 1) {
    const y = h * (0.45 + rand() * 0.45)
    const ry = rand() * Math.PI * 2
    const len = 1 + rand() * 1.8
    b.cyl(x + Math.sin(ry) * len * 0.4, y + 0.5, z + Math.cos(ry) * len * 0.4, 0.04, 0.09, len, '#2b2522', {
      seg: 4,
      rx: Math.cos(ry) * 0.9,
      rz: -Math.sin(ry) * 0.9,
    })
  }
}

/** A huge decorative crystal formation, the centrepiece of the base. */
function crystalStatue(glow, b, x, z, scale, palette, rand) {
  b.dodeca(x, 0.6 * scale, z, 3.2 * scale, '#2c3446', { sy: 0.45, jitter: 0.2, seed: x })
  const count = 9
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.4
    const lean = 0.25 + rand() * 0.45
    const r = (0.6 + rand() * 0.9) * scale
    const h = (4 + rand() * 7) * scale
    const off = rand() * 2.2 * scale
    glow.crystal(x + Math.cos(a) * off, 0.4 * scale, z + Math.sin(a) * off, r, h, palette[i % palette.length], {
      rx: Math.sin(a) * lean,
      rz: -Math.cos(a) * lean,
      seed: i + x,
    })
  }
  glow.crystal(x, 0.5 * scale, z, 1.6 * scale, 13 * scale, palette[0], { seed: z })
  addCircleCollider(x, z, 4.2 * scale)
}

function cauldron(b, glow) {
  const { x, z } = CAULDRON
  b.cyl(x, 1.6, z, 2.6, 2.1, 3.2, '#1c1d22', { seg: 12 })
  b.cyl(x, 3.25, z, 2.75, 2.75, 0.3, '#2c2d33', { seg: 12 })
  glow.cyl(x, 3.0, z, 2.45, 2.45, 0.2, '#ff8a1a', { seg: 12 })
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2
    b.box(x + Math.cos(a) * 2, 0.3, z + Math.sin(a) * 2, 0.6, 0.8, 0.6, '#1c1d22')
  }
  // Candles around the base.
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2
    b.cyl(x + Math.cos(a) * 4, 0.3, z + Math.sin(a) * 4, 0.15, 0.15, 0.6, '#efe6d2', { seg: 5 })
    glow.sphere(x + Math.cos(a) * 4, 0.72, z + Math.sin(a) * 4, 0.1, '#ffb347', { seg: 4, rings: 3 })
  }
  addCircleCollider(x, z, 3)
}

function gardenPlot(b, glow, p, index) {
  const h = PLOT_SIZE / 2
  // The gate's side (+1 south, -1 north): every gate faces the treadmill corridor.
  const dir = plotGateDir(index)
  const gz = p.z + dir * h
  const bz = p.z - dir * h
  // Soil bed in a timber frame, clearly above the plaza from any angle.
  b.box(p.x, 0.06, p.z, PLOT_SIZE - 0.4, 0.12, PLOT_SIZE - 0.4, '#3b3f48')
  const edge = '#5a4636'
  b.box(p.x, 0.11, bz + dir * 0.15, PLOT_SIZE, 0.22, 0.3, edge)
  b.box(p.x - h + 0.15, 0.11, p.z, 0.3, 0.22, PLOT_SIZE - 0.6, edge)
  b.box(p.x + h - 0.15, 0.11, p.z, 0.3, 0.22, PLOT_SIZE - 0.6, edge)
  b.box(p.x - (h + 2) / 2, 0.11, gz - dir * 0.15, h - 2, 0.22, 0.3, edge)
  b.box(p.x + (h + 2) / 2, 0.11, gz - dir * 0.15, h - 2, 0.22, 0.3, edge)
  // Stepping stones through the entrance.
  for (const dz of [-0.6, -2.2]) b.cyl(p.x, 0.1, gz + dir * dz, 0.75, 0.8, 0.2, '#8d97a8', { seg: 7 })
  // Low fence, open at the gate (on the corridor side).
  const opts = { height: 0.9, post: 2.2, collide: true, color: '#4a403a' }
  fence(b, p.x - h, bz, p.x + h, bz, opts)
  fence(b, p.x - h, p.z - h, p.x - h, p.z + h, opts)
  fence(b, p.x + h, p.z - h, p.x + h, p.z + h, opts)
  fence(b, p.x - h, gz, p.x - 2, gz, opts)
  fence(b, p.x + 2, gz, p.x + h, gz, opts)
  // Board posts (the board face itself is a textured plane).
  const board = PLOT_BOARDS[index]
  for (const sx of [-board.w / 2 + 0.3, board.w / 2 - 0.3]) {
    b.box(board.x + sx, board.y / 2, board.z - board.face * 0.12, 0.25, board.y + board.h / 2, 0.25, WOOD_DARK)
  }
  b.box(board.x, board.y, board.z - board.face * 0.12, board.w + 0.3, board.h + 0.3, 0.16, '#121318')
  // Corner glow stones, tinted per plot.
  const tint = PLOT_TINTS[index % PLOT_TINTS.length]
  glow.crystal(p.x + h - 0.6, 0.1, p.z + h - 0.6, 0.22, 0.9, tint)
  // The name sign over the entrance: two posts, a crossbeam, a snowy roof and lanterns.
  // (Its two faces are textured planes, see Boards.jsx.)
  const sign = PLOT_NAME_BOARDS[index]
  const top = sign.y + sign.h / 2
  for (const sx of [-1, 1]) {
    const px = sign.x + sx * (sign.w / 2 + 0.15)
    b.box(px, (top + 0.5) / 2, sign.z, 0.34, top + 0.5, 0.34, WOOD_DARK)
    b.box(px, 0.15, sign.z, 0.6, 0.3, 0.6, '#6b7280')
    glow.box(px, top + 0.72, sign.z, 0.3, 0.36, 0.3, '#ffd27a')
    b.box(px, top + 0.96, sign.z, 0.46, 0.1, 0.46, IRON)
  }
  b.box(sign.x, sign.y, sign.z, sign.w + 0.24, sign.h + 0.24, 0.12, '#2a2422')
  b.box(sign.x, top + 0.32, sign.z, sign.w + 1.0, 0.16, 0.6, WOOD)
  b.box(sign.x, top + 0.44, sign.z, sign.w + 0.9, 0.12, 0.66, SNOW)
  glow.box(sign.x, sign.y - sign.h / 2 - 0.08, sign.z, sign.w, 0.06, 0.16, tint)
  glow.crystal(p.x - h + 0.6, 0.1, p.z + h - 0.6, 0.22, 0.9, tint)
}

function leaderboard(b, board) {
  for (const sx of [-board.w / 2 + 0.6, board.w / 2 - 0.6]) {
    b.box(board.x + sx, board.y / 2, board.z - 0.3, 0.4, board.y + 1, 0.4, IRON)
  }
  b.box(board.x, board.y, board.z - 0.25, board.w + 0.5, board.h + 0.5, 0.35, '#0e0f14')
  addBoxCollider(board.x, board.z - 0.25, board.w / 2, 0.5)
}

function graveyard(b, rand) {
  const x0 = 84
  const z0 = -14
  const w = 26
  const d = 30
  const fenceOpts = { height: 1.4, post: 1.2, collide: false, color: IRON }
  fence(b, x0, z0, x0 + w, z0, fenceOpts)
  fence(b, x0, z0, x0, z0 + d, fenceOpts)
  fence(b, x0 + w, z0, x0 + w, z0 + d, fenceOpts)
  fence(b, x0 + 8, z0 + d, x0 + w, z0 + d, fenceOpts)
  b.box(x0 + w / 2, 0.03, z0 + d / 2, w, 0.06, d, '#5a5470')
  for (let i = 0; i < 10; i += 1) {
    const tx = x0 + 3 + (i % 5) * 4.6 + rand()
    const tz = z0 + 5 + Math.floor(i / 5) * 10 + rand() * 2
    b.box(tx, 0.8, tz, 1.2, 1.6, 0.35, '#8a8fa3', { ry: (rand() - 0.5) * 0.3, rz: (rand() - 0.5) * 0.15 })
    b.cyl(tx, 1.6, tz, 0.6, 0.6, 0.35, '#8a8fa3', { seg: 8, rx: Math.PI / 2 })
  }
  deadTree(b, x0 + w * 0.6, z0 + d * 0.5, 6, rand)
  pumpkin(b, x0 + 4, z0 + d + 1.5, 0.5, rand)
  pumpkin(b, x0 + 5.2, z0 + d + 2.2, 0.4, rand)
}

/** Rolling snowbanks around the plaza, so the horizon isn't a flat line. */
function snowbanks(b, rand) {
  for (let i = 0; i < 46; i += 1) {
    const a = (i / 46) * Math.PI * 2
    const r = 130 + rand() * 120
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r * 0.9 + 30
    if (z < -60 && Math.abs(x) < 220) continue // the mountain is there
    const s = 8 + rand() * 18
    b.ico(x, -s * 0.55, z, s, SNOW, { detail: 0, sy: 0.55, jitter: 0.08, seed: i })
  }
  // Drifts hugging the fence corners.
  for (const [x, z] of [[-74, -54], [74, -54], [-74, 52], [74, 52], [-20, 54], [22, 54]]) {
    b.ico(x, -1.2, z, 3.5, SNOW, { detail: 1, sy: 0.6, jitter: 0.05, seed: x })
  }
}

/**
 * @returns {{ solid: BufferGeometry, glow: BufferGeometry }}
 */
export function buildLobby() {
  clearColliders()
  const rand = mulberry32(42)
  const b = new GeoBuilder()
  const glow = new GeoBuilder()
  // Small dressing (bulbs, pumpkins, graves, trees, drifts) in meshes of its own, drawn
  // only while you're near the base: from up the mountain nobody can make it out.
  const detail = new GeoBuilder()
  const detailGlow = new GeoBuilder()
  const { minX, maxX, minZ, maxZ } = PLAZA

  // Perimeter fence: gate gap north, wide opening south.
  fence(b, minX, minZ, GATE.x - GATE.halfWidth - 1.4, minZ)
  fence(b, GATE.x + GATE.halfWidth + 1.4, minZ, maxX, minZ)
  fence(b, minX, minZ, minX, maxZ)
  fence(b, maxX, minZ, maxX, maxZ)
  fence(b, minX, maxZ, -10, maxZ)
  fence(b, 10, maxZ, maxX, maxZ)

  gate(b, glow)
  for (const s of STALLS) stall(b, glow, s)
  BOARDS.forEach((board) => leaderboard(b, board))
  PLOTS.forEach((p, i) => gardenPlot(b, glow, p, i))
  for (const t of TREADMILLS) treadmill(b, glow, t)
  cauldron(b, glow)

  for (const [x, z] of LAMPS) lampPost(b, glow, x, z)
  const strings = [
    [-70, -50, -46, -50], [-46, -50, -24, -50], [-24, -50, -9, -50], [9, -50, 30, -50], [30, -50, 52, -50],
    [52, -50, 70, -50], [-70, -50, -70, -20], [-70, -20, -70, 12], [-70, 12, -70, 48], [70, -50, 70, -20],
    [70, -20, 70, 12], [70, 12, 70, 48], [-70, 48, -40, 48], [-40, 48, -12, 48], [12, 48, 40, 48], [40, 48, 70, 48],
  ]
  for (const [x0, z0, x1, z1] of strings) stringLights(detail, detailGlow, x0, z0, x1, z1, rand)

  // Spawn pad.
  b.cyl(SPAWN.x, 0.08, SPAWN.z, 4.2, 4.4, 0.16, '#2a2e38', { seg: 6 })
  b.cyl(SPAWN.x, 0.18, SPAWN.z, 3.2, 3.2, 0.06, '#3d7bff', { seg: 6 })

  // Crystal statues: the centrepiece and a few giants outside the fence.
  crystalStatue(glow, b, -30, 2, 1.25, ['#c94dff', '#ff5ad1', '#7a5cff', '#ff9ce6'], rand)
  crystalStatue(glow, b, -56, 30, 0.8, ['#38e0ff', '#7fe6ff', '#2f6bff'], rand)
  crystalStatue(glow, b, 0, -2, 0.55, ['#8cf03c', '#2fd18a', '#c6ff7a'], rand)
  crystalStatue(glow, b, 46, -64, 1.6, ['#ff5a14', '#ffb020', '#ff3d6e'], rand)
  crystalStatue(glow, b, -48, -66, 1.4, ['#38ffd7', '#7a2cff', '#38e0ff'], rand)
  crystalStatue(glow, b, 92, 40, 1.2, ['#ff3d8b', '#ffd23a', '#9b4dff'], rand)

  // Halloween dressing.
  for (const [x, z, r] of [
    [-12, -26, 0.6], [-11, -24.8, 0.45], [6, -24, 0.7], [-62, -24, 0.55], [-66, 14, 0.7], [12, 44, 0.5],
    [-4, 40, 0.6], [64, -30, 0.65], [-30, 40, 0.5], [44, 44, 0.55],
  ]) {
    pumpkin(detail, x, z, r, rand)
  }
  for (const [x, z] of [[-14, -22], [8, -27], [-60, 40], [62, -36]]) {
    b.box(x, 0.45, z, 1.6, 0.9, 1, '#d9b45a', { ry: rand() })
    addBoxCollider(x, z, 0.8, 0.6)
  }
  for (const [x, z, h] of [[-90, 10, 7], [-100, -30, 9], [100, -40, 8], [-84, 60, 6], [80, 70, 7], [120, 10, 9]]) {
    deadTree(detail, x, z, h, rand)
  }
  graveyard(detail, rand)
  snowbanks(detail, rand)
  igloo(b, glow)
  snowman(b, -8, 42, Math.PI)
  snowman(b, -64, -40, Math.PI / 2)
  pond(b)

  return { solid: b.build(), glow: glow.build(), detail: detail.build(), detailGlow: detailGlow.build() }
}
