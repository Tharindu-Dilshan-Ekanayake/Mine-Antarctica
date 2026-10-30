import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import {
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { localPlayer } from './localPlayer'
import { routeTo } from './pathfind'
import { floorBelow } from './terrain/solid'
import { aim, placement } from './localPlayer'
import { tutorialPath, tutorialTarget, useTutorial } from './tutorial'
import { groundHeight } from './world/ground'
import { uTime } from './world/materials'

/**
 * The tutorial's 3D arrow: a glowing yellow arrow bobbing over where to go, with a
 * pulsing ring on the ground under it. When that spot is off-screen, a DOM arrow at
 * the screen edge (`edgeArrow.el`, from the Tutorial UI) points the way instead.
 * Two draw calls, and only while the guide has a target.
 */

// Shared, built once: arrowhead pointing down on a short shaft.
const arrowGeo = (() => {
  const head = new ConeGeometry(0.75, 1.1, 12).rotateX(Math.PI).translate(0, 0.55, 0)
  const shaft = new CylinderGeometry(0.28, 0.28, 1.2, 10).translate(0, 1.7, 0)
  const merged = mergeGeometries([head, shaft])
  head.dispose()
  shaft.dispose()
  return merged
})()
const ringGeo = new RingGeometry(1.1, 1.5, 32).rotateX(-Math.PI / 2)
// Drawn through walls and hills, like a waypoint: the guide must always be seen.
const arrowMat = new MeshBasicMaterial({ color: '#ffd23a', depthTest: false, depthWrite: false, toneMapped: false })
const ringMat = new MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false })

// --- The trail: glowing chevrons on the ground, from you to where you're going -----------
const TRAIL_MAX = 72
const TRAIL_STEP = 2.1
/** A flat chevron pointing along +z, lying on the ground. */
const chevronGeo = (() => {
  const shape = new Shape()
  shape.moveTo(0, 0.6)
  shape.lineTo(0.8, -0.2)
  shape.lineTo(0.8, -0.6)
  shape.lineTo(0, 0.2)
  shape.lineTo(-0.8, -0.6)
  shape.lineTo(-0.8, -0.2)
  shape.closePath()
  const g = new ShapeGeometry(shape).rotateX(-Math.PI / 2).rotateY(Math.PI)
  const idx = new Float32Array(TRAIL_MAX)
  for (let i = 0; i < TRAIL_MAX; i += 1) idx[i] = i
  g.setAttribute('aIdx', new InstancedBufferAttribute(idx, 1))
  return g
})()
/** A wave of light runs along the chevrons towards the goal. */
const chevronMat = new ShaderMaterial({
  uniforms: { uTime },
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  vertexShader: /* glsl */ `
    attribute float aIdx;
    varying float vWave;
    uniform float uTime;
    void main() {
      vWave = 0.5 + 0.5 * sin(uTime * 6.0 - aIdx * 0.9);
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vWave;
    void main() {
      vec3 col = mix(vec3(1.0, 0.62, 0.05), vec3(1.0, 0.96, 0.55), vWave);
      gl_FragColor = vec4(col, 0.6 + 0.4 * vWave);
    }
  `,
})
const _o = new Object3D()
const TRAIL_EVERY = 0.1

/** Ground height under a trail point: the tunnel floor when you're underground. */
function trailY(x, z) {
  const top = groundHeight(x, z)
  if (top > localPlayer.y + 3) return floorBelow(x, localPlayer.y + 1.5, z)
  return top
}

/** The current walking route ([x, z] points, player first), refreshed as you move. */
let route = []
let routeKey = ''
let routeAt = 0
const ROUTE_EVERY = 0.45

/** Recomputes the route to the guide's goal when it changed or you've moved on. */
function updateRoute(now) {
  const n = tutorialPath.n
  if (!n) {
    route = []
    routeKey = ''
    return
  }
  const gx = tutorialPath.x[n - 1]
  const gz = tutorialPath.z[n - 1]
  const key = `${gx.toFixed(1)},${gz.toFixed(1)}`
  if (key === routeKey && now - routeAt < ROUTE_EVERY) return
  routeKey = key
  routeAt = now
  route = routeTo(localPlayer.x, localPlayer.z, gx, gz)
}

/**
 * Lays the chevrons along the route, all the way to the goal: spaced TRAIL_STEP apart,
 * or wider on a long walk so the trail always reaches the end. Returns how many.
 */
function layTrail(mesh) {
  if (route.length < 2) return 0
  // Start the route at where you are now (it was computed a moment ago).
  route[0][0] = localPlayer.x
  route[0][1] = localPlayer.z
  let total = 0
  for (let i = 1; i < route.length; i += 1) total += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1])
  const usable = total - 1.8 - 1.4
  if (usable <= 0) return 0
  const step = Math.max(TRAIL_STEP, usable / (TRAIL_MAX - 1))
  let count = 0
  let walked = 0
  let next = 1.8
  for (let i = 1; i < route.length && count < TRAIL_MAX; i += 1) {
    const [ax, az] = route[i - 1]
    const [bx, bz] = route[i]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 1e-3) continue
    const ux = (bx - ax) / len
    const uz = (bz - az) / len
    const ry = Math.atan2(ux, uz)
    while (next <= walked + len && next <= total - 1.4 && count < TRAIL_MAX) {
      const t = next - walked
      const x = ax + ux * t
      const z = az + uz * t
      _o.position.set(x, trailY(x, z) + 0.17, z)
      _o.rotation.set(0, ry, 0)
      _o.updateMatrix()
      mesh.setMatrixAt(count, _o.matrix)
      count += 1
      next += step
    }
    walked += len
  }
  return count
}

/** The edge-of-screen arrow element, registered by the Tutorial UI. */
export const edgeArrow = { el: null }
/** The "click here" over the spot your pickaxe will hit, registered by the Tutorial UI. */
export const aimPointer = { el: null }

const _v = new Vector3()
const EDGE = 56
/** The edge arrow stays below the top band (the guide's line, the depth readout). */
const TOP_CLEAR = 140

export default function TutorialArrow() {
  const arrowRef = useRef(null)
  const ringRef = useRef(null)
  const trailRef = useRef(null)
  const trailTimer = useRef(0)
  const size = useThree((s) => s.size)

  useFrame(({ camera, clock }, delta) => {
    // "Click here": on the very spot the next swing will dig.
    const ap = aimPointer.el
    if (ap) {
      const tut = useTutorial.getState()
      const onAim = tut.pointAim && aim.valid && !aim.problem
      const onPlace = tut.pointPlace && placement.active && placement.valid
      if (onAim || onPlace) {
        if (onAim) _v.set(aim.hx, aim.hy, aim.hz)
        else _v.set(placement.x, groundHeight(placement.x, placement.z) + 0.6, placement.z)
        _v.project(camera)
        if (_v.z < 1) {
          ap.style.transform = `translate(${(_v.x * 0.5 + 0.5) * size.width}px, ${(-_v.y * 0.5 + 0.5) * size.height}px)`
          if (ap.style.opacity !== '1') ap.style.opacity = '1'
        } else if (ap.style.opacity !== '0') ap.style.opacity = '0'
      } else if (ap.style.opacity !== '0') ap.style.opacity = '0'
    }
    // The trail moves with you, but 10 times a second is plenty.
    const trail = trailRef.current
    if (trail) {
      trailTimer.current -= delta
      if (trailTimer.current <= 0) {
        trailTimer.current = TRAIL_EVERY
        updateRoute(clock.elapsedTime)
        const count = tutorialPath.n ? layTrail(trail) : 0
        trail.count = count
        trail.visible = count > 0
        trail.instanceMatrix.needsUpdate = true
      }
    }
    const arrow = arrowRef.current
    const ring = ringRef.current
    if (!arrow || !ring) return
    const on = tutorialTarget.active
    arrow.visible = on
    ring.visible = on
    const el = edgeArrow.el
    if (!on) {
      if (el && el.style.opacity !== '0') el.style.opacity = '0'
      return
    }
    const t = clock.elapsedTime
    const { x, y, z } = tutorialTarget
    // Grows with distance so it stays readable from across the base.
    const s = Math.min(5, Math.max(1, camera.position.distanceTo(_v.set(x, y, z)) / 16))
    arrow.scale.setScalar(s)
    arrow.position.set(x, y + (2.4 + Math.sin(t * 4) * 0.35) * s, z)
    arrow.rotation.y = t * 1.6
    ring.position.set(x, y + 0.08, z)
    const pulse = 1 + (t % 1) * 0.6
    ring.scale.set(pulse, 1, pulse)
    ringMat.opacity = 0.75 * (1 - (t % 1))

    // Off-screen (or behind the camera): an arrow on the screen edge points the way.
    if (!el) return
    _v.set(x, y + 1.5, z).project(camera)
    const behind = _v.z > 1
    const onScreen = !behind && Math.abs(_v.x) < 0.9 && Math.abs(_v.y) < 0.85
    if (onScreen) {
      if (el.style.opacity !== '0') el.style.opacity = '0'
      return
    }
    let dx = behind ? -_v.x : _v.x
    let dy = behind ? -_v.y : _v.y
    if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = -1
    const k = 1 / Math.max(Math.abs(dx), Math.abs(dy))
    dx *= k
    dy *= k
    const hw = size.width / 2 - EDGE
    const hh = size.height / 2 - EDGE
    const px = size.width / 2 + dx * hw
    // Never up among the guide's line at the top of the screen.
    const py = Math.max(TOP_CLEAR, size.height / 2 - dy * hh)
    const angle = Math.atan2(-dy, dx)
    el.style.opacity = '1'
    el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%) rotate(${angle}rad)`
  })

  return (
    <>
      <mesh ref={arrowRef} geometry={arrowGeo} material={arrowMat} visible={false} renderOrder={20} />
      <mesh ref={ringRef} geometry={ringGeo} material={ringMat} visible={false} />
      <instancedMesh
        ref={(m) => {
          trailRef.current = m
          if (m) {
            m.instanceMatrix.setUsage(DynamicDrawUsage)
            m.count = 0
          }
        }}
        args={[chevronGeo, chevronMat, TRAIL_MAX]}
        frustumCulled={false}
        visible={false}
        renderOrder={3}
      />
    </>
  )
}
