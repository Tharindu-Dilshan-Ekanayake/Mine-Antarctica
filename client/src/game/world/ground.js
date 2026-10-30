import { groundTop } from '../terrain/solid'

/**
 * Walkable ground and static collision for the player controller.
 *
 * The world floor is the flat snow plane at y = 0 plus the mountain wherever it rises
 * above it, minus everything players have dug (see terrain/solid for the 3D queries
 * tunnels need). No physics engine: column queries and a handful of 2D circles/boxes
 * are all a walking character needs, and that saves ~2 MB of WASM.
 */

/** Top of the ground at (x, z), craters included. For things that sit on the surface. */
export const groundHeight = groundTop

/** Static colliders, registered by the lobby builder. */
const boxes = []
const circles = []

export function addBoxCollider(x, z, halfW, halfD) {
  boxes.push({ x, z, hw: halfW, hd: halfD })
}

export function addCircleCollider(x, z, r) {
  circles.push({ x, z, r })
}

export function clearColliders() {
  boxes.length = 0
  circles.length = 0
  colliderVersion.n += 1
}

/** Garden crystals, when "Crystal Collisions" is on. Replaced wholesale on change. */
const dynamic = []
export function setDynamicCircles(list) {
  dynamic.length = 0
  for (const c of list) dynamic.push(c)
}

/**
 * Pushes a circle at (pos.x, pos.z) out of every static collider, in place.
 * @param {{x:number,z:number}} pos
 */
export function resolveCollisions(pos, radius) {
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i]
    const dx = pos.x - b.x
    const dz = pos.z - b.z
    if (Math.abs(dx) > b.hw + radius || Math.abs(dz) > b.hd + radius) continue
    const cx = Math.max(-b.hw, Math.min(b.hw, dx))
    const cz = Math.max(-b.hd, Math.min(b.hd, dz))
    const ox = dx - cx
    const oz = dz - cz
    const d2 = ox * ox + oz * oz
    if (d2 > radius * radius) continue
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2)
      pos.x += (ox / d) * (radius - d)
      pos.z += (oz / d) * (radius - d)
    } else {
      // Centre inside the box: leave by the nearest face.
      const px = b.hw - Math.abs(dx)
      const pz = b.hd - Math.abs(dz)
      if (px < pz) pos.x += Math.sign(dx || 1) * (px + radius)
      else pos.z += Math.sign(dz || 1) * (pz + radius)
    }
  }
  for (let i = 0; i < circles.length + dynamic.length; i += 1) {
    const c = i < circles.length ? circles[i] : dynamic[i - circles.length]
    const dx = pos.x - c.x
    const dz = pos.z - c.z
    const min = c.r + radius
    const d2 = dx * dx + dz * dz
    if (d2 >= min * min || d2 < 1e-8) continue
    const d = Math.sqrt(d2)
    pos.x += (dx / d) * (min - d)
    pos.z += (dz / d) * (min - d)
  }
}

/** Whether a body of radius `pad` at (x, z) would overlap a static collider. */
export function blockedAt(x, z, pad) {
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i]
    if (Math.abs(x - b.x) < b.hw + pad && Math.abs(z - b.z) < b.hd + pad) return true
  }
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i]
    const r = c.r + pad
    if ((x - c.x) ** 2 + (z - c.z) ** 2 < r * r) return true
  }
  return false
}

/** Bumped whenever the static colliders are rebuilt (the lobby was built). */
export const colliderVersion = { n: 0 }
