import { BufferAttribute, BufferGeometry } from 'three'

/**
 * Ported from +1 Muscle to Push Boulder: smooth, rounded arms, legs and torso in place
 * of the avatar's boxes. Here every miner wears a mid-level bodybuilder build
 * (see MINER_BULK in avatarRig) - the same shapes, at a fixed morph influence.
 *
 * Each part is built from its box in player.glb: every face becomes a grid, and every
 * grid point is pushed out from the box onto a rounded tube whose radius changes along
 * the part (hand to shoulder, foot to hip, waist to chest), with domed ends. The grid
 * keeps the box face's texture mapping, so the avatar's clothes and skin land where
 * they always did. It's built twice - skinny and bodybuilder - and the bodybuilder is a
 * morph target: how built someone is is one morph influence, done on the GPU.
 *
 * Profiles are keyframes up the part, from its bottom (t 0) to its top (t 1):
 * [t, half-width, half-depth, out (away from the body's middle), forward], in the
 * rig's bind-pose units (the whole avatar is 6.4 tall, its parts' boxes 2.4).
 */

const SHAPES = {
  torso: {
    bones: 1,
    around: [6, 4],
    along: 10,
    skinny: {
      keys: [
        [0, 0.72, 0.42, 0, 0],
        [0.25, 0.66, 0.4, 0, 0.01],
        [0.55, 0.64, 0.38, 0, 0.01],
        [0.8, 0.8, 0.43, 0, 0.02],
        [0.94, 0.78, 0.42, 0, 0],
        [1, 0.62, 0.38, 0, 0],
      ],
      top: 0.12,
      bottom: 0.08,
    },
    // A V: a narrow waist and stomach under a broad chest that juts forward, and traps.
    buff: {
      keys: [
        [0, 1.05, 0.72, 0, 0],
        [0.22, 1.08, 0.8, 0, 0.06],
        [0.45, 1.25, 0.86, 0, 0.08],
        [0.7, 1.7, 1.05, 0, 0.14],
        [0.88, 1.85, 1.05, 0, 0.1],
        [1, 1.35, 0.85, 0, 0.02],
      ],
      top: 0.4,
      bottom: 0.15,
    },
  },
  arm: {
    bones: 2,
    around: [3, 3],
    along: 14,
    // Hand, wrist, forearm, elbow, upper arm, shoulder.
    skinny: {
      keys: [
        [0, 0.26, 0.28, 0, 0.02],
        [0.1, 0.21, 0.22, 0, 0],
        [0.32, 0.25, 0.26, 0, 0],
        [0.5, 0.22, 0.23, 0, 0],
        [0.72, 0.26, 0.27, 0, 0.01],
        [0.92, 0.32, 0.32, 0, 0],
        [1, 0.28, 0.28, 0, 0],
      ],
      top: 0.14,
      bottom: 0.12,
    },
    // Big fists, huge forearms, biceps bulging forward and a round ball of a deltoid.
    buff: {
      keys: [
        [0, 0.72, 0.78, 0, 0.04],
        [0.1, 0.62, 0.66, 0, 0],
        [0.3, 0.95, 0.92, 0.04, 0.02],
        [0.5, 0.8, 0.82, 0, 0],
        [0.68, 1.08, 1.12, 0.02, 0.12],
        [0.86, 1.3, 1.25, 0.08, 0.02],
        [1, 1.05, 1.02, 0.05, 0],
      ],
      top: 0.45,
      bottom: 0.3,
    },
  },
  leg: {
    bones: 2,
    around: [3, 3],
    along: 12,
    // Foot, ankle, calf, knee, thigh, hip.
    skinny: {
      keys: [
        [0, 0.3, 0.36, 0, 0.1],
        [0.08, 0.22, 0.24, 0, 0.02],
        [0.3, 0.27, 0.29, 0, -0.03],
        [0.5, 0.24, 0.25, 0, 0],
        [0.78, 0.3, 0.31, 0, 0.01],
        [1, 0.36, 0.38, 0, 0],
      ],
      top: 0.1,
      bottom: 0,
    },
    // Calves bulging back, big quads forward.
    buff: {
      keys: [
        [0, 0.55, 0.66, 0, 0.14],
        [0.08, 0.45, 0.5, 0, 0.03],
        [0.3, 0.64, 0.7, 0, -0.08],
        [0.5, 0.52, 0.56, 0, 0],
        [0.76, 0.76, 0.84, 0.02, 0.06],
        [1, 0.75, 0.74, 0, 0],
      ],
      top: 0.15,
      bottom: 0,
    },
  },
}

/** Each body part: its shape, which way is out (+X is the avatar's left), its bones top first. */
const PARTS = {
  torso: { shape: 'torso', side: 0, bones: ['Spine1'] },
  arm_L: { shape: 'arm', side: 1, bones: ['ArmL1', 'ArmL2'] },
  arm_R: { shape: 'arm', side: -1, bones: ['ArmR1', 'ArmR2'] },
  leg_L: { shape: 'leg', side: 1, bones: ['LegL1', 'LegL2'] },
  leg_R: { shape: 'leg', side: -1, bones: ['LegR1', 'LegR2'] },
}
export const MUSCLE_SLOTS = Object.keys(PARTS)

/**
 * How far the arms' roots (shoulders) and legs' (hips) move out from the avatar's own,
 * so the limbs stay at the sides of the body however broad it is, and how tall it
 * stands: [skinny, bodybuilder], blended like the morph.
 */
export const BODY_OFFSETS = { shoulder: [-0.84, 0.55], hip: [-0.32, 0.05], tall: [0.95, 1.12] }

/**
 * How much of each box face's texture the rounded part shows, from the face's middle:
 * a hair less than all of it, so its edges never pick up the neighbouring face's pixels
 * (seen as dark lines along a smooth arm, where a box hid them in its corners).
 */
const UV_INSET = 0.97

/** Catmull-Rom through the keys' column `c` at t. */
function profile(keys, t, c) {
  let i = 0
  while (i < keys.length - 2 && t > keys[i + 1][0]) i += 1
  const a = keys[Math.max(0, i - 1)][c]
  const b = keys[i][c]
  const d = keys[i + 1][c]
  const e = keys[Math.min(keys.length - 1, i + 2)][c]
  const u = Math.min(1, Math.max(0, (t - keys[i][0]) / (keys[i + 1][0] - keys[i][0])))
  return b + 0.5 * u * (d - a + u * (2 * a - 5 * b + 4 * d - e + u * (3 * (b - d) + e - a)))
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** The box faces: which axis they face along, which way, and their in-plane axes [a, b]. */
const FACES = [
  { axis: 'z', dir: 1, a: 'x', b: 'y' },
  { axis: 'z', dir: -1, a: 'x', b: 'y' },
  { axis: 'x', dir: 1, a: 'z', b: 'y' },
  { axis: 'x', dir: -1, a: 'z', b: 'y' },
  { axis: 'y', dir: 1, a: 'x', b: 'z' },
  { axis: 'y', dir: -1, a: 'x', b: 'z' },
]

/**
 * Each box face's texture mapping, as an affine map from its in-plane coordinates to
 * uv - fitted to the face's vertices, so any layout the part's UVs use carries over.
 */
function faceMaps(geometry) {
  const pos = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  return FACES.map((face) => {
    const rows = []
    for (let i = 0; i < pos.count; i += 1) {
      const n = { x: normal.getX(i), y: normal.getY(i), z: normal.getZ(i) }
      if (n[face.axis] * face.dir < 0.9) continue
      const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) }
      rows.push([p[face.a], p[face.b], uv.getX(i), uv.getY(i)])
    }
    return [fitAffine(rows, 2), fitAffine(rows, 3)]
  })
}

/** Least-squares c0 + c1*a + c2*b through rows [a, b, ...values] for column `col`. */
function fitAffine(rows, col) {
  if (rows.length < 3) return [rows[0]?.[col] ?? 0, 0, 0]
  // Normal equations, 3x3, solved by Cramer's rule.
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, sv = 0, sav = 0, sbv = 0
  for (const r of rows) {
    const [a, b] = r
    const v = r[col]
    n += 1
    sa += a
    sb += b
    saa += a * a
    sbb += b * b
    sab += a * b
    sv += v
    sav += a * v
    sbv += b * v
  }
  const det3 = (m) =>
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  const m = [n, sa, sb, sa, saa, sab, sb, sab, sbb]
  const d = det3(m)
  if (Math.abs(d) < 1e-9) return [sv / n, 0, 0]
  const c0 = det3([sv, sa, sb, sav, saa, sab, sbv, sab, sbb]) / d
  const c1 = det3([n, sv, sb, sa, sav, sab, sb, sbv, sbb]) / d
  const c2 = det3([n, sa, sv, sa, saa, sav, sb, sab, sbv]) / d
  return [c0, c1, c2]
}

/**
 * Built parts, by slot, bones and box: every avatar is a copy of the same player.glb,
 * so each part is built once a session and shared (callers clone what they keep).
 */
const built = new Map()

/**
 * Body part `slot` (a key of PARTS) for its box geometry `source`: a smooth,
 * non-indexed, skinned geometry - skinny, with the bodybuilder as its one (relative)
 * morph target - in the same space as the box. `boneIndex(name)` gives a bone's skin
 * index. Shared: clone it to keep it. Returns null for a slot that isn't a body part.
 */
export function buildMusclePart(slot, source, boneIndex) {
  const part = PARTS[slot]
  if (!part) return null
  source.computeBoundingBox()
  const { min, max } = source.boundingBox
  const bones = part.bones.map(boneIndex)
  const key = [slot, ...bones, ...min.toArray(), ...max.toArray()].join('|')
  if (!built.has(key)) built.set(key, buildPart(part, source, bones))
  return built.get(key)
}

function buildPart(part, source, bones) {
  const shape = SHAPES[part.shape]
  const { min, max } = source.boundingBox
  const cx = (min.x + max.x) / 2
  const cz = (min.z + max.z) / 2
  const hx = (max.x - min.x) / 2
  const hz = (max.z - min.z) / 2
  const y0 = min.y
  const y1 = max.y
  const maps = faceMaps(source)

  const builds = [shape.skinny, shape.buff]
  const positions = [[], []]
  const uvs = []
  const skinIndex = []
  const skinWeight = []
  const index = []
  const p = { x: 0, y: 0, z: 0 }

  FACES.forEach((face, f) => {
    // Grid resolution: across the face (its in-plane a axis) and along b.
    const nA = face.a === 'x' ? shape.around[0] : shape.around[1]
    const nB = face.b === 'y' ? shape.along : shape.around[1]
    const lo = { x: min.x, y: min.y, z: min.z }
    const hi = { x: max.x, y: max.y, z: max.z }
    const first = uvs.length / 2
    for (let j = 0; j <= nB; j += 1) {
      for (let i = 0; i <= nA; i += 1) {
        p[face.axis] = face.dir > 0 ? hi[face.axis] : lo[face.axis]
        p[face.a] = lo[face.a] + ((hi[face.a] - lo[face.a]) * i) / nA
        p[face.b] = lo[face.b] + ((hi[face.b] - lo[face.b]) * j) / nB
        const [mu, mv] = maps[f]
        const midA = (lo[face.a] + hi[face.a]) / 2
        const midB = (lo[face.b] + hi[face.b]) / 2
        const a = midA + (p[face.a] - midA) * UV_INSET
        const b = midB + (p[face.b] - midB) * UV_INSET
        uvs.push(mu[0] + mu[1] * a + mu[2] * b, mv[0] + mv[1] * a + mv[2] * b)

        // Onto the rounded tube: the box point's angle round the part, and how far out.
        const u = (p.x - cx) / hx
        const v = (p.z - cz) / hz
        const rho = Math.max(Math.abs(u), Math.abs(v))
        const theta = Math.atan2(v, u)
        const t = Math.min(1, Math.max(0, (p.y - y0) / (y1 - y0)))
        const cap = face.axis === 'y' ? face.dir : 0
        builds.forEach((build, k) => {
          const rx = profile(build.keys, t, 1)
          const rz = profile(build.keys, t, 2)
          const dome = cap > 0 ? build.top : cap < 0 ? -build.bottom : 0
          positions[k].push(
            cx + part.side * profile(build.keys, t, 3) + rho * rx * Math.cos(theta),
            p.y + dome * (1 - rho * rho),
            cz + profile(build.keys, t, 4) + rho * rz * Math.sin(theta),
          )
        })

        // A limb bends between its two bones round the middle (elbow, knee).
        const upper = bones.length > 1 ? smoothstep(0.4, 0.6, t) : 1
        skinIndex.push(bones[0], bones[1] ?? bones[0], 0, 0)
        skinWeight.push(upper, 1 - upper, 0, 0)
      }
    }
    // Two triangles a cell, wound to face out of the box: a cell's a x b points along
    // +z on a z face, but along -x on an x face and -y on a y face.
    const row = nA + 1
    const flip = face.axis === 'z' ? face.dir < 0 : face.dir > 0
    for (let j = 0; j < nB; j += 1) {
      for (let i = 0; i < nA; i += 1) {
        const q = first + j * row + i
        if (flip) index.push(q, q + row, q + 1, q + 1, q + row, q + row + 1)
        else index.push(q, q + 1, q + row, q + 1, q + row + 1, q + row)
      }
    }
  })

  const skinny = smoothGeometry(positions[0], index)
  const buff = smoothGeometry(positions[1], index)
  const count = positions[0].length / 3
  const geometry = new BufferGeometry()
  geometry.setIndex(index)
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions[0]), 3))
  geometry.setAttribute('normal', new BufferAttribute(skinny, 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setAttribute('skinIndex', new BufferAttribute(new Float32Array(skinIndex), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(skinWeight), 4))
  const dp = new Float32Array(count * 3)
  const dn = new Float32Array(count * 3)
  for (let i = 0; i < count * 3; i += 1) {
    dp[i] = positions[1][i] - positions[0][i]
    dn[i] = buff[i] - skinny[i]
  }
  geometry.morphAttributes.position = [new BufferAttribute(dp, 3)]
  geometry.morphAttributes.normal = [new BufferAttribute(dn, 3)]
  geometry.morphTargetsRelative = true
  const flat = geometry.toNonIndexed()
  geometry.dispose()
  return flat
}

/** Smooth vertex normals for `positions` and triangles `index`, shared across the faces' seams. */
function smoothGeometry(positions, index) {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [index[i] * 3, index[i + 1] * 3, index[i + 2] * 3]
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const k of [a, b, c]) {
      normals[k] += nx
      normals[k + 1] += ny
      normals[k + 2] += nz
    }
  }
  // Vertices at the same spot (where faces meet) share one normal: no creases. The
  // spot's key is its position to a thousandth, packed into one exact number.
  const spot = (k) =>
    ((Math.round(positions[k] * 1000) + 20000) * 40001 + Math.round(positions[k + 1] * 1000) + 20000) * 40001 +
    Math.round(positions[k + 2] * 1000) +
    20000
  const shared = new Map()
  for (let k = 0; k < positions.length; k += 3) {
    const key = spot(k)
    const sum = shared.get(key) ?? [0, 0, 0]
    sum[0] += normals[k]
    sum[1] += normals[k + 1]
    sum[2] += normals[k + 2]
    shared.set(key, sum)
  }
  for (let k = 0; k < positions.length; k += 3) {
    const [x, y, z] = shared.get(spot(k))
    const l = Math.hypot(x, y, z) || 1
    normals[k] = x / l
    normals[k + 1] = y / l
    normals[k + 2] = z / l
  }
  return normals
}
