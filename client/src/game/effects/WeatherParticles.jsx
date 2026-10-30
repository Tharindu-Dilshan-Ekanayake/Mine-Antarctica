import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { DynamicDrawUsage, MeshBasicMaterial, Object3D, PlaneGeometry } from 'three'

import { mulberry32 } from '@shared/rng.js'
import { useNet } from '../../net/net'
import { useQuality } from '../../store/quality'
import { localPlayer } from '../localPlayer'
import { WEATHER_LOOK } from '../sceneStyle'

/**
 * Rain, snow, embers, sparkles... one instanced mesh of camera-facing quads in a box
 * that travels with the player. Fixed pool, wrap-around: nothing is ever spawned.
 * Off entirely on LOW (the sky tint still shows the weather).
 */
const BOX = 36
const HEIGHT = 26
const _dummy = new Object3D()

export default function WeatherParticles() {
  const fx = useQuality((s) => s.settings.weatherFx)
  const count = useQuality((s) => (s.preset === 'HIGH' ? 700 : 380))
  const weather = useNet((s) => s.world.weather)
  const look = WEATHER_LOOK[weather]?.particle ?? null
  const ref = useRef(null)
  const geometry = useMemo(() => new PlaneGeometry(1, 1), [])
  const material = useMemo(
    () => new MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }),
    [],
  )
  const seeds = useMemo(() => {
    const rand = mulberry32(99)
    const a = new Float32Array(count * 3)
    for (let i = 0; i < a.length; i += 1) a[i] = rand()
    return a
  }, [count])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  useEffect(() => {
    if (look) material.color.set(look.color)
  }, [look, material])

  // Lighter weather (the clear-day flurry) draws only part of the pool.
  const active = Math.round(count * (look?.density ?? 1))

  useFrame(({ clock, camera }) => {
    const mesh = ref.current
    if (!mesh || !look) return
    const t = clock.elapsedTime
    const [w, h] = look.size
    mesh.count = active
    for (let i = 0; i < active; i += 1) {
      const sx = seeds[i * 3]
      const sy = seeds[i * 3 + 1]
      const sz = seeds[i * 3 + 2]
      // Each particle falls through the box and wraps; drift adds a sideways wobble.
      let y = (sy * HEIGHT - t * look.fall * (0.7 + sx * 0.6)) % HEIGHT
      if (y < 0) y += HEIGHT
      const x = ((sx * BOX + Math.sin(t * 0.7 + sz * 30) * look.drift - localPlayer.x) % BOX + BOX) % BOX
      const z = ((sz * BOX + Math.cos(t * 0.5 + sx * 30) * look.drift * 0.5 - localPlayer.z) % BOX + BOX) % BOX
      _dummy.position.set(localPlayer.x - BOX / 2 + x, localPlayer.y - 4 + y, localPlayer.z - BOX / 2 + z)
      _dummy.quaternion.copy(camera.quaternion)
      _dummy.scale.set(w, h, 1)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  if (!fx || !look) return null
  return (
    <instancedMesh
      key={count}
      ref={(m) => {
        ref.current = m
        m?.instanceMatrix.setUsage(DynamicDrawUsage)
      }}
      args={[geometry, material, count]}
      frustumCulled={false}
    />
  )
}
