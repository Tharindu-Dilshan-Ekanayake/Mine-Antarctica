import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
} from 'three'

import { BOMB_BY_ID } from '@shared/catalog.js'
import { onNetEvent } from '../../net/net'
import { useQuality } from '../../store/quality'
import { sfx } from '../audio'
import { floorBelow } from '../terrain/solid'
import { groundHeight } from '../world/ground'
import { cameraState, localPlayer } from '../localPlayer'
import { BEAM_LIFE, beams, debris, flashes, FLY_TIME, flyers, MAX_BEAMS, MAX_DEBRIS, MAX_FLYERS, spawnDebris, spawnFlash } from './fxBus'

const _dummy = new Object3D()
const _color = new Color()
const GRAVITY = 22

/** Chunks of snow/rock/crystal thrown out by digs and blasts. Pooled, fixed size. */
function DebrisParticles() {
  const ref = useRef(null)
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new MeshLambertMaterial(), [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((_s, rawDelta) => {
    const mesh = ref.current
    if (!mesh) return
    const dt = Math.min(rawDelta, 0.05)
    let alive = 0
    for (let i = 0; i < MAX_DEBRIS; i += 1) {
      if (debris.life[i] <= 0) {
        _dummy.scale.setScalar(0)
      } else {
        debris.life[i] -= dt
        debris.vy[i] -= GRAVITY * dt
        debris.px[i] += debris.vx[i] * dt
        debris.py[i] += debris.vy[i] * dt
        debris.pz[i] += debris.vz[i] * dt
        // The floor under the chunk itself: inside a tunnel that's the tunnel floor.
        const floor = floorBelow(debris.px[i], debris.py[i] + 0.3, debris.pz[i]) + debris.size[i] * 0.5
        if (debris.py[i] < floor) {
          debris.py[i] = floor
          debris.vy[i] *= -0.25
          debris.vx[i] *= 0.6
          debris.vz[i] *= 0.6
        }
        _dummy.position.set(debris.px[i], debris.py[i], debris.pz[i])
        _dummy.rotation.set(debris.life[i] * 7, debris.life[i] * 5, 0)
        _dummy.scale.setScalar(debris.size[i] * Math.min(1, debris.life[i] * 3))
        alive += 1
      }
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }
    if (debris.colorsDirty) {
      debris.colorsDirty = false
      for (let i = 0; i < MAX_DEBRIS; i += 1) {
        _color.setRGB(debris.r[i], debris.g[i], debris.b[i])
        mesh.setColorAt(i, _color)
      }
      mesh.instanceColor.needsUpdate = true
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.visible = alive > 0
  })

  return (
    <instancedMesh
      ref={(m) => {
        ref.current = m
        if (m && !m.instanceColor) {
          m.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_DEBRIS * 3).fill(1), 3)
          m.instanceMatrix.setUsage(DynamicDrawUsage)
        }
      }}
      args={[geometry, material, MAX_DEBRIS]}
      frustumCulled={false}
    />
  )
}

const FLASH_POOL = 6
const flashGeo = new SphereGeometry(1, 12, 8)

/** Expanding fireballs for bomb blasts. */
function Flashes() {
  const refs = useRef([])
  const materials = useMemo(
    () =>
      Array.from(
        { length: FLASH_POOL },
        () => new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
      ),
    [],
  )
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  useFrame((_s, delta) => {
    for (let i = 0; i < FLASH_POOL; i += 1) {
      const m = refs.current[i]
      if (!m) continue
      const f = flashes.list[i]
      if (!f) {
        m.visible = false
        continue
      }
      f.t += delta
      const k = f.t / 0.7
      if (k >= 1) {
        m.visible = false
        continue
      }
      m.visible = true
      m.position.set(f.x, f.y, f.z)
      m.scale.setScalar(f.radius * (0.3 + k * 1.1))
      materials[i].color.set(f.color)
      materials[i].opacity = 1 - k
    }
    // Drop finished flashes from the front.
    while (flashes.list.length && flashes.list[0].t >= 0.7) flashes.list.shift()
  })

  return materials.map((mat, i) => (
    <mesh
      key={i}
      ref={(m) => {
        refs.current[i] = m
      }}
      geometry={flashGeo}
      material={mat}
      visible={false}
    />
  ))
}

const BOMB_POOL = 4
const bombGeo = new SphereGeometry(0.45, 10, 8)
const fuseGeo = new CylinderGeometry(0.05, 0.05, 0.4, 5)
const bombMats = Array.from({ length: BOMB_POOL }, () => new MeshLambertMaterial())
const fuseMat = new MeshBasicMaterial({ color: '#ffcc33' })

/** Lit bombs sitting on the mountain until the server says boom. */
function Bombs() {
  const slots = useRef(Array.from({ length: BOMB_POOL }, () => ({ active: false, x: 0, y: 0, z: 0, t: 0, fuse: 1.6, color: '#222' })))
  const refs = useRef([])

  useEffect(() => {
    const offBomb = onNetEvent('bomb', ({ x, y, z, id, fuse }) => {
      const slot = slots.current.find((s) => !s.active) ?? slots.current[0]
      // The bomb rests on the ground below where it was thrown (could be in a tunnel).
      const by = floorBelow(x, (y ?? groundHeight(x, z)) + 0.5, z)
      Object.assign(slot, { active: true, x, y: by, z, t: 0, fuse: fuse / 1000, color: BOMB_BY_ID[id]?.color ?? '#222' })
      bombMats[slots.current.indexOf(slot)].color.set(slot.color)
    })
    const offBoom = onNetEvent('boom', ({ x, y: by, z, id, r }) => {
      for (const s of slots.current) if (s.active && Math.hypot(s.x - x, s.z - z) < 0.5) s.active = false
      const y = by ?? groundHeight(x, z)
      const bomb = BOMB_BY_ID[id]
      spawnFlash(x, y + 1, z, r, id === 'ice' || id === 'snowflake' ? '#9fe8ff' : '#ffb347')
      _color.set(bomb?.mutation === 'Molten' ? '#ff6a1a' : '#e8eef6')
      spawnDebris(x, y + 0.5, z, [_color.r, _color.g, _color.b], 24, 3)
      cameraState.shake = 0.9
      sfx.boom()
    })
    return () => {
      offBomb()
      offBoom()
    }
  }, [])

  useFrame(({ clock }, delta) => {
    for (let i = 0; i < BOMB_POOL; i += 1) {
      const s = slots.current[i]
      const g = refs.current[i]
      if (!g) continue
      g.visible = s.active
      if (!s.active) continue
      s.t += delta
      if (s.t > s.fuse + 2) s.active = false
      const y = s.y
      g.position.set(s.x, y + 0.45, s.z)
      const blink = Math.sin(clock.elapsedTime * (8 + s.t * 12)) > 0
      g.scale.setScalar(blink ? 1.12 : 1)
    }
  })

  return slots.current.map((_, i) => (
    <group
      key={i}
      ref={(g) => {
        refs.current[i] = g
      }}
      visible={false}
    >
      <mesh geometry={bombGeo} material={bombMats[i]} />
      <mesh geometry={fuseGeo} material={fuseMat} position={[0, 0.55, 0]} />
    </group>
  ))
}

const BEACONS = 6
const beaconGeo = new CylinderGeometry(0.35, 0.35, 40, 8, 1, true)
const beaconMat = new MeshBasicMaterial({
  color: '#ff5ad1',
  transparent: true,
  opacity: 0.35,
  blending: AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
})

/** Light pillars over crystals your radar found. */
function RadarBeacons() {
  const slots = useRef(Array.from({ length: BEACONS }, () => ({ until: 0, x: 0, z: 0 })))
  const refs = useRef([])

  useEffect(
    () =>
      onNetEvent('radar', ({ points }) => {
        const now = performance.now()
        points.slice(0, BEACONS).forEach((p, i) => {
          Object.assign(slots.current[i], { until: now + 45000, x: p.x, z: p.z })
        })
        sfx.find()
      }),
    [],
  )

  useFrame(() => {
    const now = performance.now()
    for (let i = 0; i < BEACONS; i += 1) {
      const m = refs.current[i]
      const s = slots.current[i]
      if (!m) continue
      m.visible = s.until > now
      if (m.visible) m.position.set(s.x, groundHeight(s.x, s.z) + 20, s.z)
    }
  })

  return slots.current.map((_, i) => (
    <mesh
      key={i}
      ref={(m) => {
        refs.current[i] = m
      }}
      geometry={beaconGeo}
      material={beaconMat}
      visible={false}
    />
  ))
}

const beamGeo = new CylinderGeometry(0.5, 1.1, 1, 10, 1, true)
beamGeo.translate(0, 0.5, 0)

/** Pillars of light over freshly freed rare crystals: grow, hold, fade. */
function Beams() {
  const refs = useRef([])
  const materials = useMemo(
    () =>
      Array.from(
        { length: MAX_BEAMS },
        () =>
          new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: 2 }),
      ),
    [],
  )
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  useFrame((_s, delta) => {
    for (let i = 0; i < MAX_BEAMS; i += 1) {
      const m = refs.current[i]
      if (!m) continue
      if (beams.t[i] < 0) {
        m.visible = false
        continue
      }
      beams.t[i] += delta
      const k = beams.t[i] / BEAM_LIFE
      if (k >= 1) {
        beams.t[i] = -1
        m.visible = false
        continue
      }
      m.visible = true
      const grow = Math.min(1, beams.t[i] * 3)
      m.position.set(beams.x[i], groundHeight(beams.x[i], beams.z[i]), beams.z[i])
      m.scale.set(1 + k * 0.6, beams.h[i] * grow, 1 + k * 0.6)
      m.rotation.y += delta * 2
      materials[i].color.setRGB(beams.r[i], beams.g[i], beams.b[i])
      materials[i].opacity = 0.55 * (1 - k * k)
    }
  })

  return materials.map((mat, i) => (
    <mesh
      key={i}
      ref={(m) => {
        refs.current[i] = m
      }}
      geometry={beamGeo}
      material={mat}
      visible={false}
    />
  ))
}

const flyerGeo = new OctahedronGeometry(1, 0)
const flyerMat = new MeshBasicMaterial({ toneMapped: false })

/**
 * Picked-up crystals arcing into your backpack: up and over, shrinking as they go in,
 * with a little sparkle burst when they land.
 */
function Flyers() {
  const ref = useRef(null)
  useFrame((_s, delta) => {
    const mesh = ref.current
    if (!mesh) return
    // The bag sits behind the shoulders.
    const bx = localPlayer.x - Math.sin(localPlayer.ry) * 0.35
    const by = localPlayer.y + 1.2
    const bz = localPlayer.z - Math.cos(localPlayer.ry) * 0.35
    let alive = 0
    for (let i = 0; i < MAX_FLYERS; i += 1) {
      if (flyers.t[i] < 0) {
        _dummy.scale.setScalar(0)
      } else {
        flyers.t[i] += delta / FLY_TIME
        const t = Math.min(1, flyers.t[i])
        const e = t * t * (3 - 2 * t)
        _dummy.position.set(
          flyers.sx[i] + (bx - flyers.sx[i]) * e,
          flyers.sy[i] + (by - flyers.sy[i]) * e + Math.sin(t * Math.PI) * 1.6,
          flyers.sz[i] + (bz - flyers.sz[i]) * e,
        )
        _dummy.rotation.set(t * 9, t * 12, 0)
        _dummy.scale.setScalar(flyers.size[i] * (1 - t * 0.7))
        if (flyers.t[i] >= 1) {
          flyers.t[i] = -1
          _color.setRGB(flyers.r[i], flyers.g[i], flyers.b[i])
          spawnDebris(bx, by + 0.2, bz, [_color.r, _color.g, _color.b], 6, 0.4)
        }
        alive += 1
      }
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }
    if (flyers.colorsDirty) {
      flyers.colorsDirty = false
      for (let i = 0; i < MAX_FLYERS; i += 1) mesh.setColorAt(i, _color.setRGB(flyers.r[i], flyers.g[i], flyers.b[i]))
      mesh.instanceColor.needsUpdate = true
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.visible = alive > 0
  })
  return (
    <instancedMesh
      ref={(m) => {
        ref.current = m
        if (m && !m.instanceColor) {
          m.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_FLYERS * 3).fill(1), 3)
          m.instanceMatrix.setUsage(DynamicDrawUsage)
        }
      }}
      args={[flyerGeo, flyerMat, MAX_FLYERS]}
      frustumCulled={false}
      visible={false}
      renderOrder={7}
    />
  )
}

export default function Effects() {
  const particles = useQuality((s) => s.settings.particles)
  return (
    <>
      {particles && <DebrisParticles />}
      {particles && <Flashes />}
      {particles && <Beams />}
      <Flyers />
      <Bombs />
      <RadarBeacons />
    </>
  )
}
