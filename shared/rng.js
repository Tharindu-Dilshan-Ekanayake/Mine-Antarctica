/**
 * Deterministic helpers shared by the client and the server.
 *
 * Both sides must produce bit-identical terrain from the same seed, so nothing in
 * here may touch Math.random() or any platform-specific maths.
 */

/** Small seeded PRNG. Returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer hash of a 2D lattice point, mixed with a seed. */
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = (t) => t * t * (3 - 2 * t)

/** Value noise in [0, 1). */
export function valueNoise(x, z, seed) {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = smooth(x - ix)
  const fz = smooth(z - iz)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
}

/** Fractal value noise in roughly [-1, 1]. */
export function fbm(x, z, seed, octaves = 3) {
  let sum = 0
  let amp = 1
  let norm = 0
  let f = 1
  for (let i = 0; i < octaves; i += 1) {
    sum += (valueNoise(x * f, z * f, seed + i * 101) * 2 - 1) * amp
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}

/** Picks an index from a weights array using a [0,1) roll. */
export function pickWeighted(weights, roll) {
  let total = 0
  for (const w of weights) total += w
  let r = roll * total
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i]
    if (r < 0) return i
  }
  return weights.length - 1
}
