import { useEffect, useMemo } from 'react'
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, MeshLambertMaterial } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { STALLS } from '@shared/world.js'
import { useQuality } from '../../store/quality'
import { BODY_OFFSETS, buildMusclePart } from '../avatar/muscleBody'
import { GeoBuilder } from '../world/geoBuilder'
import { uTime } from '../world/materials'

/**
 * The stall keepers: Bloxity-style characters (the same rounded body the players
 * wear, at a puffy build that reads as a padded parka) dressed for the polar cold -
 * a fur-ruffed hood, a parka in their stall's colour with decorated trim bands, fur
 * cuffs and hem, mittens, fur trousers and mukluk boots. Every now and then each one
 * waves at you.
 *
 * All five are one merged, vertex-coloured mesh: one draw call. The wave and a slow
 * breath are done in the vertex shader, so they cost no CPU at all.
 */

/** The base avatar's part boxes in its bind pose (player.glb): [w, h, d, x, y]. */
const BOXES = {
  torso: [2.8, 2.4, 1.6, 0, 3.6],
  arm_L: [1.2, 2.4, 1.6, 2, 3.6],
  arm_R: [1.2, 2.4, 1.6, -2, 3.6],
  leg_L: [1.4, 2.4, 1.6, 0.7, 1.2],
  leg_R: [1.4, 2.4, 1.6, -0.7, 1.2],
}
/** How padded the parka looks (0 skinny .. 1 bodybuilder). */
const PUFF = 0.4
/** Rig units (6.4 tall) to metres: a keeper stands ~2.6 m, chest, arms and hood above the counter. */
const SCALE = 0.37

const FUR = '#f2e8d5'
const SKIN = '#e3a77c'
const PANTS = '#5b3b26'
const BOOT = '#c9a27a'
const MITTEN = '#6b4a35'

const _c = new Color()
const _trim = new Color()

/** The colour of a body vertex at height fraction t (0 bottom .. 1 top) of its part. */
function partColor(slot, t, angle, parka, trim, out) {
  if (slot === 'torso') {
    if (t < 0.1) return out.set(FUR) // fur hem
    // A decorated band: alternating trim / parka blocks around the body.
    if (t > 0.14 && t < 0.24) return Math.floor((angle + Math.PI) * 3) % 2 ? out.copy(trim) : out.set(parka)
    if (t > 0.86) return out.set(parka).multiplyScalar(0.85) // yoke
    return out.set(parka)
  }
  if (slot.startsWith('arm')) {
    if (t < 0.11) return out.set(MITTEN)
    if (t < 0.2) return out.set(FUR) // fur cuff
    if (t > 0.42 && t < 0.48) return out.copy(trim)
    return out.set(parka)
  }
  // Legs: mukluks with a fur top, then fur trousers.
  if (t < 0.26) return out.set(BOOT)
  if (t < 0.34) return out.set(FUR)
  return out.set(PANTS)
}

/** One keeper, in rig units with feet at y 0, facing +z. Returns a plain geometry. */
function buildKeeper(parkaHex, trimHex, phase) {
  _trim.set(trimHex)
  const pieces = []

  for (const [slot, [w, h, d, x, y]] of Object.entries(BOXES)) {
    const box = new BoxGeometry(w, h, d).translate(x, y, 0)
    const src = buildMusclePart(slot, box, (name) => (name.endsWith('1') ? 0 : 1))
    box.dispose()
    const pos = src.getAttribute('position')
    const nor = src.getAttribute('normal')
    const [dp] = src.morphAttributes.position
    const [dn] = src.morphAttributes.normal
    const side = slot.endsWith('_L') ? 1 : slot.endsWith('_R') ? -1 : 0
    const arm = slot.startsWith('arm')
    const { shoulder, hip } = BODY_OFFSETS
    const out = side * (arm ? shoulder[0] + (shoulder[1] - shoulder[0]) * PUFF : slot.startsWith('leg') ? hip[0] + (hip[1] - hip[0]) * PUFF : 0)
    const n = pos.count
    const positions = new Float32Array(n * 3)
    const normals = new Float32Array(n * 3)
    const colors = new Float32Array(n * 3)
    const wave = new Float32Array(n)
    const pivots = new Float32Array(n * 3)
    const y0 = y - h / 2
    // The right arm waves, turning about its shoulder.
    const waving = slot === 'arm_R'
    for (let i = 0; i < n; i += 1) {
      const px = pos.getX(i) + dp.getX(i) * PUFF + out
      const py = pos.getY(i) + dp.getY(i) * PUFF
      const pz = pos.getZ(i) + dp.getZ(i) * PUFF
      const nx = nor.getX(i) + dn.getX(i) * PUFF
      const ny = nor.getY(i) + dn.getY(i) * PUFF
      const nz = nor.getZ(i) + dn.getZ(i) * PUFF
      const l = Math.hypot(nx, ny, nz) || 1
      positions.set([px, py, pz], i * 3)
      normals.set([nx / l, ny / l, nz / l], i * 3)
      const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / h))
      partColor(slot, t, Math.atan2(pz, px - x - out), parkaHex, _trim, _c)
      colors.set([_c.r, _c.g, _c.b], i * 3)
      wave[i] = waving ? 1 : 0
      pivots.set([x + out, y + h / 2 - 0.15, 0], i * 3)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    g.setAttribute('normal', new BufferAttribute(normals, 3))
    g.setAttribute('color', new BufferAttribute(colors, 3))
    g.setAttribute('aWave', new BufferAttribute(wave, 1))
    g.setAttribute('aPivot', new BufferAttribute(pivots, 3))
    pieces.push(g)
  }

  // --- Head, face and the fur-ruffed hood ------------------------------------------
  const b = new GeoBuilder()
  const headY = 6.05
  b.box(0, headY, 0.05, 2, 2, 2, SKIN)
  for (const s of [-1, 1]) {
    b.box(s * 0.42, headY + 0.18, 1.06, 0.26, 0.36, 0.06, '#1b1b22') // eyes
    b.box(s * 0.36, headY + 0.28, 1.09, 0.09, 0.09, 0.04, '#ffffff') // eye shine
    b.box(s * 0.68, headY - 0.22, 1.06, 0.34, 0.2, 0.04, '#f08a8a') // rosy cheeks
  }
  b.box(0, headY - 0.42, 1.06, 0.62, 0.12, 0.05, '#7a2b2b') // smile
  b.box(-0.28, headY - 0.36, 1.06, 0.12, 0.12, 0.05, '#7a2b2b')
  b.box(0.28, headY - 0.36, 1.06, 0.12, 0.12, 0.05, '#7a2b2b')
  // Hood shell in the parka colour, open at the front.
  b.box(0, headY + 0.1, -0.55, 2.6, 2.6, 1.3, parkaHex, { jitter: 0.04 })
  b.box(0, headY + 1.28, 0.2, 2.6, 0.5, 2.3, parkaHex, { jitter: 0.04 })
  for (const s of [-1, 1]) b.box(s * 1.18, headY, 0.25, 0.4, 2.3, 2.1, parkaHex, { jitter: 0.04 })
  // The fur ruff framing the face.
  for (let k = 0; k < 16; k += 1) {
    const a = (k / 16) * Math.PI * 2
    b.ico(Math.cos(a) * 1.28, headY + 0.05 + Math.sin(a) * 1.32, 1.18, 0.42 + (k % 3) * 0.06, k % 2 ? FUR : '#e6dac3', { jitter: 0.08, seed: k })
  }
  // Chest toggles and a little pouch.
  for (let k = 0; k < 3; k += 1) b.box(0, 4.3 - k * 0.45, 0.95, 0.18, 0.1, 0.1, trimHex)
  b.box(0.75, 2.9, 0.9, 0.5, 0.4, 0.2, PANTS)
  const extras = b.build()
  const ec = extras.getAttribute('position').count
  extras.setAttribute('aWave', new BufferAttribute(new Float32Array(ec), 1))
  extras.setAttribute('aPivot', new BufferAttribute(new Float32Array(ec * 3), 3))
  pieces.push(extras)

  const keeper = mergeGeometries(pieces)
  pieces.forEach((p) => p.dispose())
  const count = keeper.getAttribute('position').count
  keeper.setAttribute('aPhase', new BufferAttribute(new Float32Array(count).fill(phase), 1))
  return keeper
}

/** Parka colours per stall, with a contrasting trim. */
const OUTFITS = {
  sell: ['#c8262d', '#ffd23a'],
  radars: ['#7a3dd8', '#7fe6ff'],
  upgrades: ['#249c3a', '#fff2a8'],
  pickaxes: ['#1f7fd6', '#ffffff'],
  bombs: ['#e2701a', '#2b211a'],
}

function buildAll() {
  const parts = STALLS.map((stall, i) => {
    const [parka, trim] = OUTFITS[stall.id] ?? ['#1f7fd6', '#ffffff']
    const g = buildKeeper(parka, trim, i * 1.7)
    g.scale(SCALE, SCALE, SCALE)
    // Behind the counter, facing the customers (+z).
    g.translate(stall.x, 0, stall.z + 0.15)
    // The wave pivots moved with the body.
    const piv = g.getAttribute('aPivot')
    for (let k = 0; k < piv.count; k += 1) {
      piv.setXYZ(k, piv.getX(k) * SCALE + stall.x, piv.getY(k) * SCALE, piv.getZ(k) * SCALE + stall.z + 0.15)
    }
    return g
  })
  const all = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  return all
}

function keeperMaterial() {
  const mat = new MeshLambertMaterial({ vertexColors: true })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
attribute float aWave;
attribute vec3 aPivot;
attribute float aPhase;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
  // Every ~7 s: raise the right arm out to the side and wave for a couple of seconds.
  float cyc = fract((uTime + aPhase) / 7.0);
  float raise = smoothstep(0.0, 0.07, cyc) * (1.0 - smoothstep(0.3, 0.37, cyc));
  float waveAng = -aWave * raise * (2.35 + sin(uTime * 10.0) * 0.3);
  float cA = cos(waveAng);
  float sA = sin(waveAng);
  objectNormal.xy = mat2(cA, sA, -sA, cA) * objectNormal.xy;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  vec3 rel = transformed - aPivot;
  rel.xy = mat2(cA, sA, -sA, cA) * rel.xy;
  transformed = mix(transformed, aPivot + rel, aWave);
  // A slow breath.
  transformed.y *= 1.0 + sin(uTime * 1.9 + aPhase) * 0.008;`,
      )
  }
  mat.customProgramCacheKey = () => 'shopkeepers'
  return mat
}

export default function Shopkeepers() {
  const shadows = useQuality((s) => s.settings.shadows)
  const geometry = useMemo(() => buildAll(), [])
  const material = useMemo(() => keeperMaterial(), [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  return <mesh geometry={geometry} material={material} castShadow={shadows} />
}
