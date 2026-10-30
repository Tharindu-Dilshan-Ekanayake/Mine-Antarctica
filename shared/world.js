import { fbm } from './rng.js'

/**
 * World layout, shared by client and server.
 *
 * 1 world unit = 1 metre. +Y is up. The lobby (base) sits around the origin and the
 * mountain rises to the north (-Z). Altitude shown in the HUD is simply world Y.
 */

export const MAX_PLAYERS = 8

export const SPAWN = { x: 0, z: 26, ry: Math.PI }

/** The plaza: packed-snow ground with a fence around it and a gate facing the mountain. */
export const PLAZA = { minX: -72, maxX: 72, minZ: -52, maxZ: 50 }
export const GATE = { x: 0, z: PLAZA.minZ, halfWidth: 7 }

export const MOUNTAIN = {
  cx: 0,
  cz: -300,
  /** Footprint radius; the slope reaches the plaza fence. */
  radius: 236,
  peak: 320,
  /** Half-size of the square heightfield that contains the whole mountain (a multiple of 16). */
  half: 240,
  /** Height-grid spacing in metres. */
  cell: 0.5,
  /** Chunk size used for streaming and dig bookkeeping. */
  chunk: 32,
  /** Digging is refused where the mountain's base is lower than this: right from its foot. */
  minDigBase: 0.4,
  /** How far below the original surface a tunnel may go. */
  maxDigDepth: 40,
  /**
   * Nothing is carved below this height. Well under the plain, so you can sink shafts
   * at the very foot of the mountain and tunnel underneath it.
   */
  bedrock: -36,
  /** Dug ground is meshed volumetrically in columns of this size (m). */
  volumeColumn: 8,
}

/**
 * Where the mountain's surface meets the plain (its foot), as a radius from its centre.
 * The snow plain isn't drawn inside this circle, so holes dug below the plain show.
 */
export const MOUNTAIN_FOOT = MOUNTAIN.radius * 0.955

/**
 * Electric treadmills down the middle between the two rows of gardens: one carries you
 * out to the far gardens (+x), the other back towards the base (-x). `z` is the lane's
 * centre line, `w` its width.
 */
export const TREADMILLS = [
  { x0: 3, x1: 69, z: 14, w: 2.2, dir: 1 },
  { x0: 3, x1: 69, z: 18, w: 2.2, dir: -1 },
]
/** The middle of the corridor between the two rows of gardens. */
export const GARDEN_LANE_Z = 16

/**
 * Which side a garden's gate is on: +1 its south (+z) edge, -1 its north edge. Every
 * gate faces the middle corridor, where the treadmills run - front row and back row
 * open towards each other.
 */
export const plotGateDir = (index) => (PLOTS[index].z < GARDEN_LANE_Z ? 1 : -1)

/** How fast a treadmill carries you (m/s), on top of your own walking. */
export const TREADMILL_SPEED = 9

/** The treadmill lane at (x, z), or null. */
export function treadmillAt(x, z) {
  for (const t of TREADMILLS) {
    if (x >= t.x0 && x <= t.x1 && Math.abs(z - t.z) <= t.w / 2) return t
  }
  return null
}

/** Height-grid dimensions, derived. */
export const GRID = {
  originX: MOUNTAIN.cx - MOUNTAIN.half,
  originZ: MOUNTAIN.cz - MOUNTAIN.half,
  size: MOUNTAIN.half * 2,
  verts: (MOUNTAIN.half * 2) / MOUNTAIN.cell + 1,
}

/**
 * Rarity zones by altitude. `min` is in metres of world Y.
 * Index doubles as the zone id the server uses for drop tables.
 */
export const ZONES = [
  { name: 'COMMON', min: -Infinity, color: '#e8d9a8' },
  { name: 'UNCOMMON', min: 40, color: '#5ee05e' },
  { name: 'RARE', min: 90, color: '#4aa8ff' },
  { name: 'EPIC', min: 145, color: '#c06bff' },
  { name: 'LEGENDARY', min: 200, color: '#ffb52e' },
  { name: 'MYTHIC', min: 245, color: '#ff4f9a' },
]

export function zoneIndexAt(altitude) {
  let z = 0
  for (let i = 0; i < ZONES.length; i += 1) if (altitude >= ZONES[i].min) z = i
  return z
}

/**
 * Untouched mountain surface at (x, z) for a given mountain seed.
 * Concave profile (steep summit, gentle foot) plus ridges and bumps. Sinks slightly
 * below y=0 at the rim so it tucks under the flat snow plane without z-fighting.
 */
export function baseHeight(x, z, seed) {
  const dx = x - MOUNTAIN.cx
  const dz = z - MOUNTAIN.cz
  const r = Math.sqrt(dx * dx + dz * dz)
  const t = r / MOUNTAIN.radius
  if (t >= 1) return -0.8

  const s = 1 - t
  // Ridges radiating from the summit; the seed rotates them every mountain reroll.
  const angle = Math.atan2(dz, dx)
  const ridge = Math.sin(angle * 7 + seed * 1.7 + fbm(x * 0.012, z * 0.012, seed, 2) * 3)
  const profile = MOUNTAIN.peak * Math.pow(s, 1.75)
  const bumps = fbm(x * 0.035, z * 0.035, seed + 7, 3) * 7 * s
  const ridges = ridge * 9 * s * (1 - s * 0.6)
  // Fade the detail at the rim so the edge meets y=0 cleanly.
  const rim = Math.min(1, s * 8)
  return (profile + (bumps + ridges) * rim) * rim - 0.8
}

/** True when (x, z) lies on the diggable part of the mountain. */
export function isDiggable(x, z, seed) {
  return baseHeight(x, z, seed) >= MOUNTAIN.minDigBase
}

/**
 * Radius (m) of the ball of ground one swing removes. A starter pick opens a hole
 * you can just walk into after two swings; the best picks bore big tunnels.
 */
export function digRadius(pickaxe) {
  return 0.75 + Math.sqrt(pickaxe.mineSize) * 0.11
}

/** Clear height of a tunnel bite above your feet: room to walk in without ducking. */
export const TUNNEL_HEIGHT = 2.35

/**
 * The balls one swing removes. A swing roughly level with you, at the wall in front of
 * you, is a tunnel bite: two balls stacked from your feet up past your head, so every
 * swing opens a passage you can walk straight into - tunnelling never means chipping
 * at the floor and the ceiling separately. Any other swing (down a shaft, up into a
 * ceiling, a far-off face) removes the one ball you aimed at. Shared by the server,
 * which carves them, and the client, which previews them.
 *
 * @returns {{ x: number, y: number, z: number, r: number }[]}
 */
export function digBalls(x, y, z, dy, r, feetY) {
  const level = Math.abs(dy) < 0.55
  const atWall = y > feetY - 0.4 && y < feetY + TUNNEL_HEIGHT + 0.3
  if (!level || !atWall || r * 2 >= TUNNEL_HEIGHT) return [{ x, y, z, r }]
  // Floor flush with your feet, top a little over your head.
  const low = feetY + r
  const high = feetY + TUNNEL_HEIGHT - r
  return [
    { x, y: low, z, r },
    { x, y: high, z, r },
  ]
}

/**
 * Whether a dig ball at (x, y, z) is allowed: on the mountain, not through bedrock,
 * not deeper than the tunnel limit, and not floating in the air above the slope.
 * Shared so the client can explain a refusal before the server makes it.
 * @returns {'' | 'offMountain' | 'bedrock' | 'tooDeep' | 'air'}
 */
export function digProblem(x, y, z, r, seed) {
  const h = baseHeight(x, z, seed)
  if (h < MOUNTAIN.minDigBase) return 'offMountain'
  if (y < MOUNTAIN.bedrock + r * 0.35) return 'bedrock'
  if (h - y > MOUNTAIN.maxDigDepth) return 'tooDeep'
  if (y - h > r + 1.5) return 'air'
  return ''
}

/** The garden plots: one square per player slot, 4 x 2 inside the plaza fence. */
export const PLOT_SIZE = 15
export const PLOTS = [
  { x: 13, z: 4 },
  { x: 29.5, z: 4 },
  { x: 46, z: 4 },
  { x: 62.5, z: 4 },
  { x: 13, z: 28 },
  { x: 29.5, z: 28 },
  { x: 46, z: 28 },
  { x: 62.5, z: 28 },
]

export function plotContains(index, x, z, margin = 0.6) {
  const p = PLOTS[index]
  if (!p) return false
  const h = PLOT_SIZE / 2 - margin
  return Math.abs(x - p.x) <= h && Math.abs(z - p.z) <= h
}

/** Shop stalls along the north side of the plaza, facing south (+Z). */
export const STALLS = [
  { id: 'sell', label: 'SELL', x: -56, z: -34, colors: ['#e0262b', '#1d1f2b'] },
  { id: 'radars', label: 'RADARS', x: -44, z: -34, colors: ['#8b3dff', '#1d1f2b'] },
  { id: 'upgrades', label: 'UPGRADES', x: -32, z: -34, colors: ['#2ec43c', '#1d1f2b'] },
  { id: 'pickaxes', label: 'PICKAXES', x: -20, z: -34, colors: ['#1aa3ff', '#1d1f2b'] },
  { id: 'bombs', label: 'BOMBS', x: -8, z: -34, colors: ['#ff8a1a', '#1d1f2b'] },
]
/** Distance in front of a stall's counter that opens it. */
export const STALL_REACH = 4.2

export const CAULDRON = { x: -40, z: 22 }

/** How far a player may reach with a pickaxe, centre to target (m). */
export const REACH = 7.5
