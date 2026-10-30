/**
 * Particle spawn requests, written by gameplay code and drained by <DebrisParticles>
 * in its frame loop. A fixed ring buffer: no allocation, no unbounded growth.
 */

export const MAX_DEBRIS = 96

export const debris = {
  px: new Float32Array(MAX_DEBRIS),
  py: new Float32Array(MAX_DEBRIS),
  pz: new Float32Array(MAX_DEBRIS),
  vx: new Float32Array(MAX_DEBRIS),
  vy: new Float32Array(MAX_DEBRIS),
  vz: new Float32Array(MAX_DEBRIS),
  life: new Float32Array(MAX_DEBRIS),
  size: new Float32Array(MAX_DEBRIS),
  r: new Float32Array(MAX_DEBRIS),
  g: new Float32Array(MAX_DEBRIS),
  b: new Float32Array(MAX_DEBRIS),
  next: 0,
  /** Set when any particle was spawned since the renderer last uploaded colours. */
  colorsDirty: false,
}

/**
 * Throws `count` chunks out of (x, y, z). `color` is [r, g, b] in 0..1 (linear).
 * @param {number} power scales speed and size (bombs use ~3)
 */
export function spawnDebris(x, y, z, color, count = 8, power = 1) {
  for (let n = 0; n < count; n += 1) {
    const i = debris.next
    debris.next = (debris.next + 1) % MAX_DEBRIS
    const a = Math.random() * Math.PI * 2
    const sp = (1.5 + Math.random() * 3) * power
    debris.px[i] = x
    debris.py[i] = y
    debris.pz[i] = z
    debris.vx[i] = Math.cos(a) * sp
    debris.vz[i] = Math.sin(a) * sp
    debris.vy[i] = (3 + Math.random() * 4) * Math.sqrt(power)
    debris.life[i] = 0.7 + Math.random() * 0.6
    debris.size[i] = (0.12 + Math.random() * 0.16) * Math.min(2.2, power)
    const k = 0.85 + Math.random() * 0.3
    debris.r[i] = color[0] * k
    debris.g[i] = color[1] * k
    debris.b[i] = color[2] * k
  }
  debris.colorsDirty = true
}

/** One-shot flashes (bomb explosions), drained by <Flashes>. */
export const flashes = { list: [] }
export function spawnFlash(x, y, z, radius, color) {
  if (flashes.list.length > 6) flashes.list.shift()
  flashes.list.push({ x, y, z, radius, color, t: 0 })
}

/** Light pillars rising from freshly freed rare crystals. Fixed pool. */
export const MAX_BEAMS = 6
export const beams = {
  x: new Float32Array(MAX_BEAMS),
  z: new Float32Array(MAX_BEAMS),
  /** Age in seconds; < 0 means free. */
  t: new Float32Array(MAX_BEAMS).fill(-1),
  r: new Float32Array(MAX_BEAMS),
  g: new Float32Array(MAX_BEAMS),
  b: new Float32Array(MAX_BEAMS),
  h: new Float32Array(MAX_BEAMS),
  next: 0,
}
export const BEAM_LIFE = 4.5

export function spawnBeam(x, z, color, height = 30) {
  const i = beams.next
  beams.next = (beams.next + 1) % MAX_BEAMS
  beams.x[i] = x
  beams.z[i] = z
  beams.t[i] = 0
  beams.r[i] = color[0]
  beams.g[i] = color[1]
  beams.b[i] = color[2]
  beams.h[i] = height
}

/** Floating world text ("-25", "+$120"), drawn as DOM by <FloatTextDriver>. */
export const MAX_FLOATS = 12
export const floats = Array.from({ length: MAX_FLOATS }, () => ({ x: 0, y: 0, z: 0, t: -1, text: '', color: '#fff', big: false }))
let nextFloat = 0
export const FLOAT_LIFE = 1.1

export function spawnFloat(x, y, z, text, color = '#ffffff', big = false) {
  const f = floats[nextFloat]
  nextFloat = (nextFloat + 1) % MAX_FLOATS
  f.x = x + (Math.random() - 0.5) * 0.6
  f.y = y
  f.z = z + (Math.random() - 0.5) * 0.6
  f.t = 0
  f.text = text
  f.color = color
  f.big = big
  f.dirty = true
}

/** Crystals flying from where they lay into the local player's backpack. Fixed pool. */
export const MAX_FLYERS = 8
export const flyers = {
  sx: new Float32Array(MAX_FLYERS),
  sy: new Float32Array(MAX_FLYERS),
  sz: new Float32Array(MAX_FLYERS),
  /** Progress 0..1; < 0 means free. */
  t: new Float32Array(MAX_FLYERS).fill(-1),
  r: new Float32Array(MAX_FLYERS),
  g: new Float32Array(MAX_FLYERS),
  b: new Float32Array(MAX_FLYERS),
  size: new Float32Array(MAX_FLYERS),
  next: 0,
  colorsDirty: false,
}
export const FLY_TIME = 0.45

export function spawnFlyer(x, y, z, color, size = 0.35) {
  const i = flyers.next
  flyers.next = (flyers.next + 1) % MAX_FLYERS
  flyers.sx[i] = x
  flyers.sy[i] = y
  flyers.sz[i] = z
  flyers.t[i] = 0
  flyers.r[i] = color[0]
  flyers.g[i] = color[1]
  flyers.b[i] = color[2]
  flyers.size[i] = size
  flyers.colorsDirty = true
}
