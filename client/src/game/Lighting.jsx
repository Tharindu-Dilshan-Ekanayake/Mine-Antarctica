import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { useNet } from '../net/net'
import { useQuality } from '../store/quality'
import { localPlayer } from './localPlayer'
import { LIGHTS, WEATHER_LOOK } from './sceneStyle'
import { skyTint } from './Sky'

const SUN_DIRECTION = new Vector3(...LIGHTS.sunDirection).normalize()
const SUN_DISTANCE = 80
const SHADOW_EXTENT = 30

/**
 * Hemisphere fill + sun. The sun (and its shadow box) follows the player, so
 * shadows exist wherever you are. No shadow casting on LOW.
 * Thunder weather adds lightning flashes by pulsing the fill.
 */
export default function Lighting() {
  const sunRef = useRef(null)
  const hemiRef = useRef(null)
  const scene = useThree((s) => s.scene)
  const shadows = useQuality((s) => s.settings.shadows)
  const mapSize = useQuality((s) => s.settings.shadowMapSize)
  const weather = useNet((s) => s.world.weather)
  const flash = useRef({ t: 0, next: 3 })

  useLayoutEffect(() => {
    const sun = sunRef.current
    if (!sun) return undefined
    const cam = sun.shadow.camera
    cam.left = -SHADOW_EXTENT
    cam.right = SHADOW_EXTENT
    cam.top = SHADOW_EXTENT
    cam.bottom = -SHADOW_EXTENT
    cam.near = 1
    cam.far = SUN_DISTANCE * 2.5
    cam.updateProjectionMatrix()
    scene.add(sun.target)
    return () => {
      scene.remove(sun.target)
    }
  }, [scene, shadows, mapSize])

  useFrame((_s, delta) => {
    const sun = sunRef.current
    if (!sun) return
    sun.target.position.set(localPlayer.x, localPlayer.y, localPlayer.z)
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIRECTION, SUN_DISTANCE)

    let bolt = 0
    if (WEATHER_LOOK[weather]?.flashes) {
      const f = flash.current
      f.next -= delta
      if (f.next <= 0) {
        f.t = 0.25
        f.next = 2 + Math.random() * 6
      }
      if (f.t > 0) {
        f.t -= delta
        bolt = f.t > 0.15 || (f.t > 0 && f.t < 0.08) ? 2.5 : 0
      }
    }
    sun.intensity = LIGHTS.sunIntensity * skyTint.light
    if (hemiRef.current) hemiRef.current.intensity = LIGHTS.hemiIntensity * skyTint.light + bolt
  })

  return (
    <>
      <hemisphereLight ref={hemiRef} args={[LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemiIntensity]} />
      <directionalLight
        key={mapSize}
        ref={sunRef}
        castShadow={shadows}
        color={LIGHTS.sunColor}
        intensity={LIGHTS.sunIntensity}
        shadow-mapSize={[mapSize || 512, mapSize || 512]}
        shadow-intensity={LIGHTS.shadowIntensity}
        shadow-bias={-0.0006}
        shadow-normalBias={0.04}
      />
    </>
  )
}
