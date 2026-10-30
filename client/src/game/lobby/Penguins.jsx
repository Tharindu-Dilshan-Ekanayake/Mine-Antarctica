import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Object3D } from 'three'

import { mulberry32 } from '@shared/rng.js'
import { useQuality } from '../../store/quality'
import { GeoBuilder } from '../world/geoBuilder'
import { solidMaterial } from '../world/materials'
import { IGLOO, POND } from './buildLobby'

/**
 * Penguins wandering the base: they waddle between spots, pause to look around, and
 * belly-slide whenever their path crosses the frozen pond. One instanced mesh.
 */
const _dummy = new Object3D()

function penguinGeometry() {
  const b = new GeoBuilder()
  const BLACK = '#1d2230'
  b.sphere(0, 0.45, 0, 0.32, BLACK, { sy: 1.35, seg: 8, rings: 6 })
  b.sphere(0, 0.42, 0.12, 0.25, '#f5f7fb', { sy: 1.25, sz: 0.8, seg: 8, rings: 6 })
  b.sphere(0, 0.98, 0.02, 0.2, BLACK, { seg: 8, rings: 6 })
  b.cone(0, 0.95, 0.26, 0.06, 0.16, '#ff9a1a', { rx: Math.PI / 2, seg: 4 })
  for (const s of [-1, 1]) {
    b.sphere(s * 0.08, 1.03, 0.17, 0.045, '#ffffff', { seg: 4, rings: 3 })
    b.sphere(s * 0.085, 1.035, 0.205, 0.022, '#000000', { seg: 4, rings: 3 })
    b.box(s * 0.3, 0.5, 0, 0.06, 0.42, 0.18, BLACK, { rz: s * 0.25 })
    b.box(s * 0.11, 0.03, 0.09, 0.13, 0.05, 0.2, '#ff9a1a')
  }
  // Yellow cheek patches: emperor-penguin style.
  for (const s of [-1, 1]) b.sphere(s * 0.15, 0.92, 0.06, 0.06, '#ffc93d', { seg: 4, rings: 3 })
  return b.build()
}

/** Where each penguin likes to hang out. */
const HAUNTS = [
  { x: POND.x, z: POND.z, r: POND.r + 4 },
  { x: POND.x, z: POND.z, r: POND.r + 4 },
  { x: POND.x, z: POND.z, r: POND.r + 4 },
  { x: IGLOO.x, z: IGLOO.z + 6, r: 7 },
  { x: IGLOO.x, z: IGLOO.z + 6, r: 7 },
  { x: 2, z: 12, r: 10 },
  { x: -10, z: -10, r: 9 },
  { x: 45, z: 40, r: 8 },
  { x: -60, z: -8, r: 6 },
]

export default function Penguins() {
  const count = useQuality((s) => (s.preset === 'LOW' ? 5 : HAUNTS.length))
  const ref = useRef(null)
  const geometry = useMemo(() => penguinGeometry(), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  const birds = useMemo(() => {
    const rand = mulberry32(77)
    return Array.from({ length: HAUNTS.length }, (_, i) => {
      const h = HAUNTS[i]
      const a = rand() * Math.PI * 2
      return {
        haunt: h,
        x: h.x + Math.cos(a) * h.r * 0.5,
        z: h.z + Math.sin(a) * h.r * 0.5,
        tx: h.x,
        tz: h.z,
        ry: rand() * Math.PI * 2,
        wait: rand() * 3,
        phase: rand() * 10,
        scale: 0.85 + rand() * 0.45,
        rand: mulberry32(100 + i),
        slide: 0,
      }
    })
  }, [])

  useFrame(({ clock }, rawDelta) => {
    const mesh = ref.current
    if (!mesh) return
    const dt = Math.min(rawDelta, 0.05)
    const t = clock.elapsedTime
    for (let i = 0; i < count; i += 1) {
      const p = birds[i]
      const dx = p.tx - p.x
      const dz = p.tz - p.z
      const dist = Math.hypot(dx, dz)
      const onIce = Math.hypot(p.x - POND.x, p.z - POND.z) < POND.r - 0.5
      let moving = false
      if (p.wait > 0) {
        p.wait -= dt
      } else if (dist < 0.3) {
        // Arrived: pick the next spot and idle a moment.
        const a = p.rand() * Math.PI * 2
        const r = Math.sqrt(p.rand()) * p.haunt.r
        p.tx = p.haunt.x + Math.cos(a) * r
        p.tz = p.haunt.z + Math.sin(a) * r
        p.wait = 0.5 + p.rand() * 3
      } else {
        moving = true
        const speed = onIce ? 3.2 : 1.1
        const step = Math.min(dist, speed * dt)
        p.x += (dx / dist) * step
        p.z += (dz / dist) * step
        const target = Math.atan2(dx, dz)
        let d = target - p.ry
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        p.ry += d * Math.min(1, dt * 6)
      }
      // Ease into / out of the belly slide.
      p.slide += ((moving && onIce ? 1 : 0) - p.slide) * Math.min(1, dt * 5)

      const w = t * 9 + p.phase
      const waddle = moving ? Math.sin(w) * 0.16 * (1 - p.slide) : Math.sin(t * 1.3 + p.phase) * 0.03
      const hop = moving ? Math.abs(Math.sin(w)) * 0.06 * (1 - p.slide) : 0
      // Up on the ice slab (and its snow bank) when they're on the pond.
      const fromPond = Math.hypot(p.x - POND.x, p.z - POND.z)
      const lift = fromPond < POND.r ? POND.ice : Math.max(0, 1 - (fromPond - POND.r) / 1.5) * POND.ice
      _dummy.position.set(p.x, lift + 0.06 + hop + p.slide * 0.18, p.z)
      _dummy.rotation.set(p.slide * 1.35, p.ry, waddle, 'YXZ')
      _dummy.scale.setScalar(p.scale)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, solidMaterial, HAUNTS.length]} frustumCulled={false} />
}
