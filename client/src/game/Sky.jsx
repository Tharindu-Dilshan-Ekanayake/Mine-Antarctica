import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BackSide, BufferAttribute, Color, ConeGeometry, IcosahedronGeometry, Triangle, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { mulberry32 } from '@shared/rng.js'
import { useNet } from '../net/net'
import { useQuality } from '../store/quality'
import { localPlayer } from './localPlayer'
import { CLOUDS, LIGHTS, SKY, WEATHER_LOOK } from './sceneStyle'

const SKY_RADIUS = 900

const skyVertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const skyFragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform float exponent;
  uniform vec3 sunDir;
  uniform float sunAmount;
  varying vec3 vDirection;
  void main() {
    vec3 dir = normalize(vDirection);
    float h = dir.y;
    vec3 color = mix(horizonColor, topColor, pow(max(h, 0.0), exponent));
    // Sun disc, tight halo and a wide warm bloom.
    float d = max(dot(dir, sunDir), 0.0);
    color += vec3(1.0, 0.95, 0.82) * (pow(d, 900.0) * 2.2 + pow(d, 60.0) * 0.35) * sunAmount;
    color += vec3(1.0, 0.86, 0.66) * pow(d, 6.0) * 0.12 * sunAmount;
    // Brighter band right at the horizon.
    color += vec3(0.12, 0.14, 0.16) * pow(1.0 - abs(h), 12.0);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

/** Shared, live sky tint: the fog and lights read it too. */
export const skyTint = {
  top: new Color(SKY.top),
  horizon: new Color(SKY.horizon),
  light: 1,
}
const _targetTop = new Color()
const _targetHorizon = new Color()

/**
 * Gradient dome that follows the camera, tinted towards the active weather.
 */
function SkyDome() {
  const ref = useRef(null)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const weather = useNet((s) => s.world.weather)
  const uniforms = useMemo(
    () => ({
      topColor: { value: skyTint.top },
      horizonColor: { value: skyTint.horizon },
      exponent: { value: SKY.exponent },
      sunDir: { value: new Vector3(...LIGHTS.sunDirection).normalize() },
      sunAmount: { value: 1 },
    }),
    [],
  )

  const far = useQuality((s) => s.settings.far)
  const domeScale = Math.min(1, (far * 0.92) / SKY_RADIUS)

  useFrame((_s, delta) => {
    const look = WEATHER_LOOK[weather] ?? WEATHER_LOOK['']
    _targetTop.set(look.top)
    _targetHorizon.set(look.horizon)
    const k = 1 - Math.pow(0.3, delta)
    skyTint.top.lerp(_targetTop, k)
    skyTint.horizon.lerp(_targetHorizon, k)
    skyTint.light += (look.light - skyTint.light) * k
    // The sun fades behind storm clouds.
    uniforms.sunAmount.value = Math.max(0, Math.min(1, (skyTint.light - 0.6) / 0.4))
    if (scene.fog) scene.fog.color.copy(skyTint.horizon)
    ref.current?.position.copy(camera.position)
  })

  return (
    <mesh ref={ref} renderOrder={-1} frustumCulled={false} scale={domeScale}>
      <sphereGeometry args={[SKY_RADIUS, 24, 12]} />
      <shaderMaterial
        side={BackSide}
        depthWrite={false}
        fog={false}
        uniforms={uniforms}
        vertexShader={skyVertexShader}
        fragmentShader={skyFragmentShader}
      />
    </mesh>
  )
}

/** One faceted puff with sun-baked vertex colours. */
function puffGeometry() {
  const geometry = new IcosahedronGeometry(1, 1)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const top = new Color(CLOUDS.top)
  const bottom = new Color(CLOUDS.bottom)
  const sun = new Vector3(...LIGHTS.sunDirection).normalize()
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const n = new Vector3()
  const col = new Color()
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    Triangle.getNormal(a, b, c, n)
    if (n.dot(a) < 0) n.negate()
    col.copy(bottom).lerp(top, Math.min(1, (n.y * 0.5 + 0.5) * 0.85 + Math.max(n.dot(sun), 0) * 0.35))
    for (let v = 0; v < 3; v += 1) col.toArray(colors, (i + v) * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.deleteAttribute('uv')
  return geometry
}

/** All clouds merged into one mesh: one draw call however many puffs. */
function buildClouds(count) {
  const rand = mulberry32(7)
  const puff = puffGeometry()
  const parts = []
  for (let i = 0; i < count; i += 1) {
    const size = 14 + rand() * 12
    const cx = (rand() * 2 - 1) * 520
    const cz = (rand() * 2 - 1) * 520
    const cy = 150 + rand() * 90
    const ry = rand() * Math.PI
    const n = 3 + Math.floor(rand() * 3)
    for (let p = 0; p <= n; p += 1) {
      const top = p === n
      const along = top ? (rand() - 0.5) * size : (p - (n - 1) / 2) * size * 0.9
      const s = top ? size * 0.75 : size * (0.75 + rand() * 0.35) * (1 - Math.abs(along) / (size * n * 0.6))
      const g = puff.clone()
      g.scale(s, s * 0.7, s * 0.85)
      g.translate(along, top ? size * 0.5 : (rand() - 0.3) * size * 0.4, (rand() - 0.5) * size * 0.6)
      g.rotateY(ry)
      g.translate(cx, cy, cz)
      parts.push(g)
    }
  }
  const merged = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  puff.dispose()
  return merged
}

function Clouds() {
  const ref = useRef(null)
  const count = useQuality((s) => s.settings.clouds)
  const geometry = useMemo(() => buildClouds(count), [count])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((_s, delta) => {
    const g = ref.current
    if (!g) return
    g.rotation.y += delta * 0.003
    // Centre the cloud field on the player so it never runs out.
    g.position.x = localPlayer.x
    g.position.z = localPlayer.z
  })

  return (
    <mesh ref={ref} geometry={geometry} frustumCulled={false}>
      <meshBasicMaterial vertexColors fog={false} />
    </mesh>
  )
}

/**
 * Rings of snowy peaks on the horizon, with haze baked into the vertex colours
 * (they sit beyond the fog). One mesh, a few hundred triangles.
 */
function buildRanges(radius) {
  const rand = mulberry32(21)
  const parts = []
  const snow = new Color('#f4f8fd')
  const rock = new Color('#7d8fa8')
  const haze = new Color(SKY.horizon)
  const col = new Color()
  for (let ring = 0; ring < 2; ring += 1) {
    const count = ring === 0 ? 34 : 26
    const r0 = radius * (ring === 0 ? 1 : 0.86)
    const hazeAmount = ring === 0 ? 0.55 : 0.35
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.12 + ring * 0.07
      const h = (ring === 0 ? 70 : 45) + rand() * (ring === 0 ? 120 : 70)
      const w = h * (0.9 + rand() * 0.7)
      const g = new ConeGeometry(w, h, 5 + Math.floor(rand() * 3), 2)
      g.deleteAttribute('uv')
      const nonIndexed = g.toNonIndexed()
      g.dispose()
      const pos = nonIndexed.getAttribute('position')
      // Jitter the middle ring so peaks aren't perfect cones.
      for (let v = 0; v < pos.count; v += 1) {
        const y = pos.getY(v)
        if (Math.abs(y) < h * 0.45) {
          pos.setX(v, pos.getX(v) * (0.8 + rand() * 0.4))
          pos.setZ(v, pos.getZ(v) * (0.8 + rand() * 0.4))
        }
      }
      const colors = new Float32Array(pos.count * 3)
      for (let v = 0; v < pos.count; v += 1) {
        const t = pos.getY(v) / h + 0.5
        col.copy(rock).lerp(snow, Math.min(1, Math.max(0, (t - 0.35) * 2.2))).lerp(haze, hazeAmount + (1 - t) * 0.25)
        col.toArray(colors, v * 3)
      }
      nonIndexed.setAttribute('color', new BufferAttribute(colors, 3))
      nonIndexed.computeVertexNormals()
      nonIndexed.translate(Math.cos(a) * r0, h / 2 - 12, Math.sin(a) * r0)
      parts.push(nonIndexed)
    }
  }
  const merged = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  return merged
}

function Ranges() {
  const ref = useRef(null)
  const far = useQuality((s) => s.settings.far)
  const geometry = useMemo(() => buildRanges(Math.min(far * 0.78, 620)), [far])
  useEffect(() => () => geometry.dispose(), [geometry])
  // Centred on the player, like the clouds, so they always sit inside the view distance.
  useFrame(() => {
    ref.current?.position.set(localPlayer.x, 0, localPlayer.z)
  })
  return (
    <mesh ref={ref} geometry={geometry} frustumCulled={false} renderOrder={-1}>
      <meshBasicMaterial vertexColors fog={false} />
    </mesh>
  )
}

export default function Sky() {
  return (
    <>
      <SkyDome />
      <Ranges />
      <Clouds />
    </>
  )
}
