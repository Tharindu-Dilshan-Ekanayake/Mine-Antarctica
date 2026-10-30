import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, CylinderGeometry, DynamicDrawUsage, InstancedBufferAttribute, MeshLambertMaterial, Object3D, PlaneGeometry } from 'three'

import { CRYSTAL_BY_ID, crystalScale, MUTATIONS, RARITIES, SHAPES, SIZES } from '@shared/catalog.js'
import { kg, money } from '@shared/format.js'
import { net, useNet } from '../../net/net'
import { useQuality } from '../../store/quality'
import { cameraState, placement } from '../localPlayer'
import { getDigCount } from '../terrain/heightGrid'
import { useUI } from '../../store/ui'
import { groundHeight, setDynamicCircles } from '../world/ground'
import { sfx } from '../audio'
import { spawnBeam, spawnDebris, spawnFloat, spawnFlyer } from '../effects/fxBus'
import { pendingPickups } from '../interaction'
import { localPlayer } from '../localPlayer'
import { crystalBaseY } from './crystalMath'
import { makeBeamMaterial, makeCrystalMaterial, makeHaloMaterial, makeSparkleMaterial } from './crystalMaterials'
import { shapeGeometry } from './shapes'

/**
 * Every crystal in the world — buried, loose and in every garden — drawn with one
 * InstancedMesh per shape (11 draw calls total, however many crystals exist).
 *
 * Instances are rebuilt only when the crystal/garden set or the terrain changes;
 * per frame only the loose ones (bobbing, spinning) are touched.
 */
const CAPACITY = 192
const MAX_LOOSE = 96

const _dummy = new Object3D()
const _color = new Color()
const _mut = new Color()
const _counts = new Uint16Array(SHAPES.length)
const GHOST_OK = new Color('#5cff8a')
const GHOST_BAD = new Color('#ff4a4a')

/** Body colour of a crystal type with its mutation tint, written into `out`. */
export function crystalColor(typeId, mutation, out, hidden) {
  out.set(CRYSTAL_BY_ID[typeId]?.color ?? '#ffffff')
  const m = mutation && !hidden?.includes(mutation) && MUTATIONS[mutation]
  if (m) out.lerp(_mut.set(m.color), 0.45)
  return out
}

const HALO_CAPACITY = 128
const haloGeometry = new PlaneGeometry(1, 1)

/** Rare crystals (and any mutated one) get a glow halo. */
const hasHalo = (typeId, mutation) => (CRYSTAL_BY_ID[typeId]?.rarity ?? 0) >= 2 || !!mutation

/** Loot beams over loose Rare+ crystals (and Legendary+ ones in gardens). */
const BEAM_CAPACITY = 48
/** An open cylinder 1 tall, base at y 0, stretched per crystal. */
const beamGeometry = new CylinderGeometry(0.5, 0.5, 1, 12, 1, true).translate(0, 0.5, 0)
/** Sparkles circling Epic+ crystals: this many per crystal. */
const SPARKLES_PER = 6
const SPARKLE_CAPACITY = 240
const sparkleGeometry = (() => {
  const g = new PlaneGeometry(1, 1)
  const seeds = new Float32Array(SPARKLE_CAPACITY)
  for (let i = 0; i < SPARKLE_CAPACITY; i += 1) seeds[i] = (i * 0.618034) % 1
  g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1))
  return g
})()
/** A size band index from a weight (for crystals saved without one). */
const sizeOf = (size, weight) => {
  if (Number.isInteger(size) && size >= 0) return size
  const i = SIZES.findIndex((b) => weight < b.w[1])
  return i < 0 ? SIZES.length - 1 : i
}

const _burst = [1, 1, 1]

/**
 * The fun moments: a crystal popping free of the ice (burst, beam for rare ones)
 * and a fresh find appearing at your feet.
 */
function celebrate(before, c, me, y, s) {
  const type = CRYSTAL_BY_ID[c.type]
  if (!type) return
  _color.set(type.color)
  _burst[0] = _color.r
  _burst[1] = _color.g
  _burst[2] = _color.b
  const near = (c.x - localPlayer.x) ** 2 + (c.z - localPlayer.z) ** 2 < 900
  if (!near) return
  if (before && before.state === 0 && c.state === 1) {
    const big = sizeOf(c.size, c.weight) >= 4
    spawnDebris(c.x, y + s * 0.6, c.z, _burst, 14 + type.rarity * 3, 1.3 + type.rarity * 0.15)
    if (type.rarity >= 2) spawnBeam(c.x, c.z, _burst, 24 + type.rarity * 8)
    // Legendary, Mythic and the giants: the whole screen feels it.
    if (type.rarity >= 4 || big) {
      spawnDebris(c.x, y + s, c.z, [1, 0.95, 0.8], 18, 1.9)
      cameraState.shake = Math.max(cameraState.shake, 0.22)
    }
    spawnFloat(c.x, y + s + 1, c.z, 'FREED!', RARITIES[type.rarity].color, true)
    sfx.shatter()
  } else if (!before && c.owner === me) {
    spawnDebris(c.x, y + s, c.z, _burst, 8, 0.8)
    spawnFloat(c.x, y + s + 1.4, c.z, `${RARITIES[type.rarity].name}!`, RARITIES[type.rarity].color, type.rarity >= 2)
    if (type.rarity >= 3) spawnBeam(c.x, c.z, _burst, 40)
  }
}

export default function CrystalField() {
  const meshes = useRef([])
  const beamMaterial = useMemo(() => makeBeamMaterial(), [])
  const sparkleMaterial = useMemo(() => makeSparkleMaterial(), [])
  const beamRef = useRef(null)
  const sparkleRef = useRef(null)
  useEffect(
    () => () => {
      beamMaterial.dispose()
      sparkleMaterial.dispose()
    },
    [beamMaterial, sparkleMaterial],
  )
  const shadows = useQuality((s) => s.settings.shadows)
  const lite = useQuality((s) => s.preset === 'LOW')
  const material = useMemo(() => makeCrystalMaterial(lite), [lite])
  const haloMaterial = useMemo(() => makeHaloMaterial(), [])
  const halosOn = useQuality((s) => s.settings.particles)
  const haloRef = useRef(null)
  /** Last seen crystals, to animate the moment one is freed or picked up. */
  const prev = useRef(new Map())
  const geometries = useMemo(() => SHAPES.map((s) => shapeGeometry(s)), [])
  const state = useRef({ dirty: true, digs: -1 })
  /** Loose-instance bookkeeping in flat typed arrays (no per-frame objects). */
  const loose = useMemo(
    () => ({
      n: 0,
      shape: new Uint8Array(MAX_LOOSE),
      index: new Uint16Array(MAX_LOOSE),
      x: new Float32Array(MAX_LOOSE),
      y: new Float32Array(MAX_LOOSE),
      z: new Float32Array(MAX_LOOSE),
      s: new Float32Array(MAX_LOOSE),
      phase: new Float32Array(MAX_LOOSE),
      halo: new Int16Array(MAX_LOOSE),
    }),
    [],
  )

  useEffect(() => {
    const offNet = useNet.subscribe((s, prev) => {
      if (s.worldVersion !== prev.worldVersion) state.current.dirty = true
    })
    const offUI = useUI.subscribe((s, prev) => {
      if (s.hiddenMutations !== prev.hiddenMutations || s.crystalCollisions !== prev.crystalCollisions) {
        state.current.dirty = true
      }
    })
    return () => {
      offNet()
      offUI()
    }
  }, [])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => haloMaterial.dispose(), [haloMaterial])

  const rebuild = () => {
    const counts = _counts
    counts.fill(0)
    loose.n = 0
    const room = net.room
    const { hiddenMutations, crystalCollisions } = useUI.getState()
    const solids = []
    const halo = haloRef.current
    let halos = 0
    const beam = beamRef.current
    let beams = 0
    const sparkle = sparkleRef.current
    let sparkles = 0
    /** A loot beam at (x, y, z), its height and width set by rarity and size. */
    const putBeam = (rarity, size, x, y, z) => {
      if (!beam || beams >= BEAM_CAPACITY) return
      _dummy.position.set(x, y, z)
      _dummy.rotation.set(0, 0, 0)
      const w = 0.7 + size * 0.18 + rarity * 0.1
      _dummy.scale.set(w, 9 + rarity * 7, w)
      _dummy.updateMatrix()
      beam.setMatrixAt(beams, _dummy.matrix)
      beam.setColorAt(beams, _color.set(RARITIES[rarity].color))
      beams += 1
    }
    /** Sparkles circling an Epic+ crystal centred at (x, y, z). */
    const putSparkles = (typeId, mutation, x, y, z, s) => {
      if (!sparkle) return
      crystalColor(typeId, mutation, _color, null)
      for (let k = 0; k < SPARKLES_PER && sparkles < SPARKLE_CAPACITY; k += 1) {
        _dummy.position.set(x, y, z)
        _dummy.rotation.set(0, 0, 0)
        _dummy.scale.setScalar(s * 0.75 + 0.5)
        _dummy.updateMatrix()
        sparkle.setMatrixAt(sparkles, _dummy.matrix)
        sparkle.setColorAt(sparkles, _color)
        sparkles += 1
      }
    }
    const putHalo = (typeId, mutation, x, y, z, s) => {
      if (!halo || halos >= HALO_CAPACITY || !hasHalo(typeId, mutation)) return -1
      const rarity = CRYSTAL_BY_ID[typeId]?.rarity ?? 0
      _dummy.position.set(x, y, z)
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.setScalar(s * (2 + rarity * 0.35))
      _dummy.updateMatrix()
      halo.setMatrixAt(halos, _dummy.matrix)
      halo.setColorAt(halos, crystalColor(typeId, mutation, _color, hiddenMutations))
      return halos++
    }
    const put = (typeId, mutation, x, y, z, s, rot, size = 0) => {
      const type = CRYSTAL_BY_ID[typeId]
      const shapeIdx = Math.max(0, SHAPES.indexOf(type?.shape ?? 'cluster'))
      const mesh = meshes.current[shapeIdx]
      const i = counts[shapeIdx]
      if (!mesh || i >= CAPACITY) return -1
      counts[shapeIdx] = i + 1
      // Rarity and size band, for the shader's show-off effects.
      mesh.geometry.getAttribute('aFx')?.setXY(i, type?.rarity ?? 0, size)
      _dummy.position.set(x, y, z)
      _dummy.rotation.set(0, rot, 0)
      _dummy.scale.setScalar(s)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
      mesh.setColorAt(i, crystalColor(typeId, mutation, _color, hiddenMutations))
      return shapeIdx * 1000 + i
    }

    const seen = new Map()
    // Right after joining, the state's collections may not all be decoded yet.
    if (room?.state?.crystals && room.state.players) {
      const me = room.sessionId
      room.state.crystals.forEach((c, id) => {
        const s = crystalScale(c.weight)
        const y = crystalBaseY(c)
        const size = sizeOf(c.size, c.weight)
        const rarity = CRYSTAL_BY_ID[c.type]?.rarity ?? 0
        const slot = put(c.type, c.mutation, c.x, y, c.z, s, c.rot, size)
        const h = putHalo(c.type, c.mutation, c.x, y + s * 0.5, c.z, s)
        // Waiting to be picked up: Rare and up shine a beam you can spot from afar.
        if (c.state === 1 && rarity >= 2) putBeam(rarity, size, c.x, y, c.z)
        if (rarity >= 3) putSparkles(c.type, c.mutation, c.x, y + s * 0.55, c.z, s)
        celebrate(prev.current.get(id), c, me, y, s)
        seen.set(id, { state: c.state, x: c.x, y, z: c.z, value: c.value, weight: c.weight, type: c.type })
        if (c.state === 1 && slot >= 0 && loose.n < MAX_LOOSE) {
          const k = loose.n++
          loose.shape[k] = Math.floor(slot / 1000)
          loose.index[k] = slot % 1000
          loose.x[k] = c.x
          loose.y[k] = y
          loose.z[k] = c.z
          loose.s[k] = s
          loose.phase[k] = c.rot
          loose.halo[k] = h
        }
      })
      room.state.players.forEach((p) => {
        p.garden?.forEach((it) => {
          const s = crystalScale(it.weight)
          const gy = groundHeight(it.x, it.z) + 0.08
          const size = sizeOf(it.size, it.weight)
          const rarity = CRYSTAL_BY_ID[it.type]?.rarity ?? 0
          put(it.type, it.mutation, it.x, gy, it.z, s, it.rot, size)
          putHalo(it.type, it.mutation, it.x, gy + s * 0.5, it.z, s)
          // Garden trophies: Legendary and Mythic show off with a beam of their own.
          if (rarity >= 4) putBeam(rarity, size, it.x, gy, it.z)
          if (rarity >= 3) putSparkles(it.type, it.mutation, it.x, gy + s * 0.55, it.z, s)
          if (crystalCollisions) solids.push({ x: it.x, z: it.z, r: s * 0.38 })
        })
      })
    }

    // Crystals that vanished near us were picked up: they fly into the backpack.
    for (const [id, p] of prev.current) {
      if (seen.has(id) || !pendingPickups.delete(id)) continue
      const dx = p.x - localPlayer.x
      const dz = p.z - localPlayer.z
      if (dx * dx + dz * dz < 64) {
        _color.set(CRYSTAL_BY_ID[p.type]?.color ?? '#ffffff')
        spawnFlyer(p.x, p.y + 0.3, p.z, [_color.r, _color.g, _color.b], Math.min(0.6, 0.18 + p.weight * 0.02))
        spawnFloat(p.x, p.y + 1.2, p.z, `+${kg(p.weight)}  ${money(p.value)}`, '#ffd84a', true)
      }
    }
    prev.current = seen

    setDynamicCircles(solids)
    for (const [mesh, n] of [[beam, beams], [sparkle, sparkles]]) {
      if (!mesh) continue
      mesh.count = n
      mesh.visible = n > 0
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    if (halo) {
      halo.count = halos
      halo.visible = halos > 0
      halo.instanceMatrix.needsUpdate = true
      if (halo.instanceColor) halo.instanceColor.needsUpdate = true
    }

    meshes.current.forEach((mesh, i) => {
      if (!mesh) return
      mesh.count = counts[i]
      mesh.visible = counts[i] > 0
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      const fx = mesh.geometry.getAttribute('aFx')
      if (fx) fx.needsUpdate = true
    })
  }

  useFrame(({ clock }) => {
    const st = state.current
    const digs = getDigCount()
    if (st.dirty || digs !== st.digs) {
      st.dirty = false
      st.digs = digs
      rebuild()
    }
    if (!loose.n) return
    const t = clock.elapsedTime
    for (let k = 0; k < loose.n; k += 1) {
      const mesh = meshes.current[loose.shape[k]]
      _dummy.position.set(loose.x[k], loose.y[k] + 0.25 + Math.sin(t * 2 + loose.phase[k]) * 0.12, loose.z[k])
      _dummy.rotation.set(0, loose.phase[k] + t * 0.8, 0)
      _dummy.scale.setScalar(loose.s[k])
      _dummy.updateMatrix()
      mesh.setMatrixAt(loose.index[k], _dummy.matrix)
      mesh.instanceMatrix.needsUpdate = true
      const h = loose.halo[k]
      if (h >= 0 && haloRef.current) {
        _dummy.position.y += loose.s[k] * 0.5
        _dummy.rotation.set(0, 0, 0)
        _dummy.scale.setScalar(loose.s[k] * 2.6)
        _dummy.updateMatrix()
        haloRef.current.setMatrixAt(h, _dummy.matrix)
        haloRef.current.instanceMatrix.needsUpdate = true
      }
    }
  })

  return (
    <>
      {geometries.map((geo, i) => (
        <instancedMesh
          key={SHAPES[i]}
          ref={(m) => {
            meshes.current[i] = m
            // Give every mesh its colour buffer before the first render, so the
            // shader is compiled with per-instance colour from the start.
            if (m && !m.instanceColor) {
              m.instanceColor = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3)
              m.instanceMatrix.setUsage(DynamicDrawUsage)
              m.count = 0
            }
            // Per-instance rarity and size for the crystal shader.
            if (m && !m.geometry.getAttribute('aFx')) {
              m.geometry.setAttribute('aFx', new InstancedBufferAttribute(new Float32Array(CAPACITY * 2), 2))
            }
          }}
          args={[geo, material, CAPACITY]}
          frustumCulled={false}
          castShadow={shadows}
          receiveShadow={false}
        />
      ))}
      {halosOn && (
        <instancedMesh
          ref={(m) => {
            haloRef.current = m
            if (m && !m.instanceColor) {
              m.instanceColor = new InstancedBufferAttribute(new Float32Array(HALO_CAPACITY * 3), 3)
              m.instanceMatrix.setUsage(DynamicDrawUsage)
              m.count = 0
              state.current.dirty = true
            }
          }}
          args={[haloGeometry, haloMaterial, HALO_CAPACITY]}
          frustumCulled={false}
          renderOrder={4}
        />
      )}
      {/* Loot beams: always on (one cheap draw call, and they help you find your loot). */}
      <instancedMesh
        ref={(m) => {
          beamRef.current = m
          if (m && !m.instanceColor) {
            m.instanceColor = new InstancedBufferAttribute(new Float32Array(BEAM_CAPACITY * 3), 3)
            m.instanceMatrix.setUsage(DynamicDrawUsage)
            m.count = 0
            state.current.dirty = true
          }
        }}
        args={[beamGeometry, beamMaterial, BEAM_CAPACITY]}
        frustumCulled={false}
        renderOrder={4}
      />
      {halosOn && (
        <instancedMesh
          ref={(m) => {
            sparkleRef.current = m
            if (m && !m.instanceColor) {
              m.instanceColor = new InstancedBufferAttribute(new Float32Array(SPARKLE_CAPACITY * 3), 3)
              m.instanceMatrix.setUsage(DynamicDrawUsage)
              m.count = 0
              state.current.dirty = true
            }
          }}
          args={[sparkleGeometry, sparkleMaterial, SPARKLE_CAPACITY]}
          frustumCulled={false}
          renderOrder={5}
        />
      )}
      <PlacementGhost />
    </>
  )
}

const ghostMaterial = new MeshLambertMaterial({ transparent: true, opacity: 0.55, depthWrite: false })

/** Translucent preview of the crystal being placed in the garden. */
function PlacementGhost() {
  const ref = useRef(null)
  const shapeRef = useRef('')
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    m.visible = placement.active
    if (!placement.active) return
    const shape = CRYSTAL_BY_ID[placement.type]?.shape ?? 'cluster'
    if (shapeRef.current !== shape) {
      shapeRef.current = shape
      m.geometry = shapeGeometry(shape)
    }
    m.position.set(placement.x, groundHeight(placement.x, placement.z) + 0.08, placement.z)
    m.rotation.y = placement.rot
    m.scale.setScalar(crystalScale(placement.weight) * (1 + Math.sin(clock.elapsedTime * 5) * 0.03))
    ghostMaterial.color.copy(placement.valid ? GHOST_OK : GHOST_BAD)
  })
  return <mesh ref={ref} material={ghostMaterial} visible={false} renderOrder={3} />
}
