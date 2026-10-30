import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  Color,
  DoubleSide,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { mulberry32 } from '@shared/rng.js'
import { baseHeight, MOUNTAIN, ZONES } from '@shared/world.js'
import { useNet } from '../../net/net'
import { useQuality } from '../../store/quality'
import { getDigCount, getSeed } from '../terrain/heightGrid'
import { groundTopPeek } from '../terrain/solid'
import { GeoBuilder } from '../world/geoBuilder'
import { makeGlowMaterial, solidMaterial, uTime } from '../world/materials'

/**
 * Dressing for the mountain: snow-capped boulders and glowing ice spires (instanced),
 * a ring of flags at every rarity-zone boundary, a crystal crown on the summit and a
 * slow ring of cloud around the peak. Six draw calls in total.
 *
 * Layout is seeded from the mountain seed, so every player sees the same mountain,
 * and it re-lays itself when the Mountain RNG rerolls.
 */
const _dummy = new Object3D()
const _color = new Color()
const ICE_TINTS = ['#9fe8ff', '#7fc8ff', '#b9a7ff', '#7fffe0', '#d8f4ff']

function boulderGeometry() {
  const b = new GeoBuilder()
  b.dodeca(0, 0.35, 0, 0.7, '#6c7584', { jitter: 0.18, sy: 0.75 })
  b.dodeca(0.05, 0.72, 0, 0.55, '#f4f8fd', { jitter: 0.05, sy: 0.35 })
  return b.build()
}

function spireGeometry() {
  const b = new GeoBuilder()
  b.crystal(0, 0, 0, 0.32, 2.4, '#ffffff', { jitter: 0.15 })
  b.crystal(0.35, 0, 0.1, 0.2, 1.4, '#e6f6ff', { rz: -0.45, jitter: 0.15 })
  b.crystal(-0.3, 0, -0.15, 0.18, 1.1, '#e6f6ff', { rz: 0.5, rx: 0.2, jitter: 0.15 })
  b.dodeca(0, 0.05, 0, 0.45, '#cfdce8', { sy: 0.35 })
  return b.build()
}

/** Distance from the summit at which the untouched slope reaches `alt` along `angle`. */
function radiusAtAltitude(alt, angle, seed) {
  let lo = 0
  let hi = MOUNTAIN.radius
  const cx = MOUNTAIN.cx
  const cz = MOUNTAIN.cz
  for (let k = 0; k < 22; k += 1) {
    const mid = (lo + hi) / 2
    const h = baseHeight(cx + Math.cos(angle) * mid, cz + Math.sin(angle) * mid, seed)
    if (h > alt) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Flag poles at zone boundaries + summit cairn (solid), crowns (glow), cloths (sway). */
function buildStatic(seed) {
  const solid = new GeoBuilder()
  const glow = new GeoBuilder()
  const cloths = []
  const rand = mulberry32(seed * 7 + 3)
  const addFlag = (x, y, z, ry, color, w, h, pole) => {
    solid.cyl(x, y + pole / 2, z, 0.07, 0.1, pole, '#2b2f3a', { seg: 5 })
    solid.sphere(x, y + pole + 0.05, z, 0.14, '#ffd23a', { seg: 5, rings: 4 })
    const cloth = new PlaneGeometry(w, h, 6, 1)
    cloth.translate(w / 2, 0, 0)
    // uv.x = 0 at the pole, 1 at the free edge: the shader sways by it.
    cloth.rotateY(ry)
    cloth.translate(x, y + pole - h / 2 - 0.1, z)
    const n = cloth.getAttribute('position').count
    const colors = new Float32Array(n * 3)
    _color.set(color)
    for (let v = 0; v < n; v += 1) _color.toArray(colors, v * 3)
    cloth.setAttribute('color', new BufferAttribute(colors, 3))
    cloths.push(cloth)
  }

  for (let zi = 1; zi < ZONES.length; zi += 1) {
    const alt = ZONES[zi].min
    const count = 10
    for (let k = 0; k < count; k += 1) {
      const angle = (k / count) * Math.PI * 2 + zi * 0.31
      const r = radiusAtAltitude(alt, angle, seed)
      const x = MOUNTAIN.cx + Math.cos(angle) * r
      const z = MOUNTAIN.cz + Math.sin(angle) * r
      const y = baseHeight(x, z, seed)
      addFlag(x, y - 0.3, z, -angle + (rand() - 0.5) * 0.6, ZONES[zi].color, 1.6, 1, 3.6)
    }
  }

  // Summit: a cairn, a crown of crystals and a big flag.
  const top = baseHeight(MOUNTAIN.cx, MOUNTAIN.cz, seed)
  solid.dodeca(MOUNTAIN.cx, top - 0.6, MOUNTAIN.cz, 2.4, '#5d6675', { sy: 0.6, jitter: 0.2 })
  const palette = ['#ff5ad1', '#7fe6ff', '#ffd23a', '#b45cff', '#5cff8a']
  for (let k = 0; k < 9; k += 1) {
    const a = (k / 9) * Math.PI * 2
    glow.crystal(MOUNTAIN.cx + Math.cos(a) * 2.2, top - 0.4, MOUNTAIN.cz + Math.sin(a) * 2.2, 0.5, 3 + (k % 3) * 1.4, palette[k % 5], {
      rx: Math.sin(a) * 0.4,
      rz: -Math.cos(a) * 0.4,
    })
  }
  glow.crystal(MOUNTAIN.cx, top - 0.5, MOUNTAIN.cz, 0.9, 7, '#ffffff')
  addFlag(MOUNTAIN.cx + 3.5, top - 0.5, MOUNTAIN.cz + 1.5, 0.4, '#ff3d8b', 3.6, 2.2, 8)

  const clothGeo = mergeGeometries(cloths)
  cloths.forEach((c) => c.dispose())
  return { solid: solid.build(), glow: glow.build(), cloth: clothGeo }
}

function clothMaterial() {
  const mat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  float w = uv.x;
  float ph = uTime * 5.0 + position.x * 0.7 + position.z * 0.5 - uv.x * 4.0;
  transformed.y += sin(ph) * 0.16 * w;
  transformed.x += cos(ph * 0.8) * 0.12 * w;
  transformed.z += sin(ph * 1.1) * 0.12 * w;`,
      )
  }
  mat.customProgramCacheKey = () => 'flagCloth'
  return mat
}

/** A lumpy cloud ring circling the peak. */
function buildCloudRing(count, seed) {
  const rand = mulberry32(seed + 99)
  const parts = []
  const top = new Color('#ffffff')
  const bottom = new Color('#c7d6ea')
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.2
    const r = 70 + rand() * 50
    const y = 115 + rand() * 40
    const s = 9 + rand() * 9
    const g = new IcosahedronGeometry(1, 1)
    g.deleteAttribute('uv')
    const pos = g.getAttribute('position')
    const colors = new Float32Array(pos.count * 3)
    for (let v = 0; v < pos.count; v += 1) {
      _color.copy(bottom).lerp(top, pos.getY(v) * 0.5 + 0.5)
      _color.toArray(colors, v * 3)
    }
    g.setAttribute('color', new BufferAttribute(colors, 3))
    g.scale(s * 1.6, s * 0.6, s)
    g.rotateY(-a)
    g.translate(Math.cos(a) * r, y, Math.sin(a) * r)
    parts.push(g)
  }
  const merged = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  return merged
}

const spireMaterial = makeGlowMaterial(0.45)
const cloudMaterial = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false })

export default function MountainDecor() {
  const preset = useQuality((s) => s.preset)
  const shadows = useQuality((s) => s.settings.shadows)
  const counts = { LOW: [50, 22, 10], MEDIUM: [110, 45, 20], HIGH: [150, 60, 28] }[preset]
  const [boulderCount, spireCount, cloudCount] = counts

  const boulderGeo = useMemo(() => boulderGeometry(), [])
  const spireGeo = useMemo(() => spireGeometry(), [])
  const cloth = useMemo(() => clothMaterial(), [])
  const boulders = useRef(null)
  const spires = useRef(null)
  const cloudRef = useRef(null)
  const layout = useRef({ digs: -1, items: [] })
  // The mountain seed; heightGrid has already switched to it when this changes.
  const seed = useNet((s) => s.world.seed)
  const staticRef = useRef({ solid: null, glow: null, cloth: null, clouds: null })
  const meshRefs = useRef({})

  useEffect(
    () => () => {
      boulderGeo.dispose()
      spireGeo.dispose()
      cloth.dispose()
      for (const g of Object.values(staticRef.current)) g?.dispose()
    },
    [boulderGeo, spireGeo, cloth],
  )
  /** Scatter decorations for this mountain seed. Runs on reroll, never per frame. */
  useEffect(() => {
    const seed = getSeed()
    const rand = mulberry32(seed * 31 + 5)
    const items = []
    const total = boulderCount + spireCount
    let guard = 0
    while (items.length < total && guard < total * 20) {
      guard += 1
      const a = rand() * Math.PI * 2
      const r = Math.sqrt(rand()) * MOUNTAIN.radius * 0.93
      const x = MOUNTAIN.cx + Math.cos(a) * r
      const z = MOUNTAIN.cz + Math.sin(a) * r
      if (z > -72 || baseHeight(x, z, seed) < 3) continue
      const spire = items.length >= boulderCount
      items.push({ x, z, rot: rand() * Math.PI * 2, s: spire ? 0.9 + rand() * 1.4 : 0.7 + rand() * 2.2, tint: Math.floor(rand() * ICE_TINTS.length), spire })
    }
    layout.current.items = items

    const built = buildStatic(seed)
    const old = staticRef.current
    for (const g of Object.values(old)) g?.dispose()
    staticRef.current = { ...built, clouds: buildCloudRing(cloudCount, seed) }
    const m = meshRefs.current
    if (m.solid) m.solid.geometry = staticRef.current.solid
    if (m.glow) m.glow.geometry = staticRef.current.glow
    if (m.cloth) m.cloth.geometry = staticRef.current.cloth
    if (m.clouds) m.clouds.geometry = staticRef.current.clouds

    if (spires.current) {
      let k = 0
      for (const it of items) {
        if (!it.spire) continue
        spires.current.setColorAt(k, _color.set(ICE_TINTS[it.tint]))
        k += 1
      }
      if (spires.current.instanceColor) spires.current.instanceColor.needsUpdate = true
    }
    layout.current.digs = -1
  }, [seed, boulderCount, spireCount, cloudCount])

  /** Re-seat every decoration on the (possibly dug) surface. */
  const reseat = () => {
    let b = 0
    let s = 0
    for (const it of layout.current.items) {
      const y = groundTopPeek(it.x, it.z)
      _dummy.position.set(it.x, y - (it.spire ? 0.2 : 0.35 * it.s), it.z)
      _dummy.rotation.set(0, it.rot, 0)
      _dummy.scale.setScalar(it.s)
      _dummy.updateMatrix()
      if (it.spire && spires.current) spires.current.setMatrixAt(s++, _dummy.matrix)
      else if (!it.spire && boulders.current) boulders.current.setMatrixAt(b++, _dummy.matrix)
    }
    if (boulders.current) {
      boulders.current.count = b
      boulders.current.instanceMatrix.needsUpdate = true
    }
    if (spires.current) {
      spires.current.count = s
      spires.current.instanceMatrix.needsUpdate = true
    }
  }

  useFrame((_s, delta) => {
    const l = layout.current
    const digs = getDigCount()
    if (digs !== l.digs) {
      l.digs = digs
      reseat()
    }
    if (cloudRef.current) cloudRef.current.rotation.y += delta * 0.01
  })

  const setRef = (key) => (m) => {
    meshRefs.current[key] = m
    if (m && staticRef.current[key]) m.geometry = staticRef.current[key]
  }

  return (
    <>
      <instancedMesh
        key={`b${boulderCount}`}
        ref={boulders}
        args={[boulderGeo, solidMaterial, boulderCount]}
        castShadow={shadows}
        receiveShadow={shadows}
        frustumCulled={false}
      />
      <instancedMesh
        key={`s${spireCount}`}
        ref={(m) => {
          spires.current = m
          if (m && !m.instanceColor) {
            m.instanceColor = new InstancedBufferAttribute(new Float32Array(spireCount * 3).fill(1), 3)
          }
        }}
        args={[spireGeo, spireMaterial, spireCount]}
        frustumCulled={false}
      />
      <mesh ref={setRef('solid')} material={solidMaterial} castShadow={shadows} frustumCulled={false} />
      <mesh ref={setRef('glow')} material={spireMaterial} frustumCulled={false} />
      <mesh ref={setRef('cloth')} material={cloth} frustumCulled={false} />
      <group position={[MOUNTAIN.cx, 0, MOUNTAIN.cz]}>
        <mesh
          ref={(m) => {
            cloudRef.current = m
            setRef('clouds')(m)
          }}
          material={cloudMaterial}
          frustumCulled={false}
        />
      </group>
    </>
  )
}
