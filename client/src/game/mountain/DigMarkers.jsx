import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, DynamicDrawUsage, InstancedBufferAttribute, Object3D, PlaneGeometry, ShaderMaterial } from 'three'

import { net } from '../../net/net'
import { quality } from '../../store/quality'
import { getDigCount } from '../terrain/heightGrid'
import { sby, sr, sx, sy, sz } from '../terrain/digStore'
import { surfaceAt } from '../terrain/solid'
import { uTime } from '../world/materials'

/**
 * Where the mountain has been dug, visible from far away.
 *
 * Holes only get real geometry near you (that's what keeps low-end devices smooth), so
 * from a distance a mined mountain looks untouched. These markers fix that: every area
 * with digs gets a soft glowing light - warm gold for YOUR digs, cool ice-blue for
 * other players' - that grows with distance so it stays easy to spot, fades away as you
 * walk up (the real hole takes over), and gets brighter where more was dug.
 *
 * Dug balls are grouped into 11 m cells, rebuilt only when the digs change. One
 * instanced mesh = one draw call, the same on every graphics level (LOW just caps how
 * many lights are drawn).
 */
const CELL = 11
const CAPACITY = 420

const MINE = new Color('#ffa01a')
const THEIRS = new Color('#1a7dff')
const _dummy = new Object3D()
const _color = new Color()

const geometry = new PlaneGeometry(1, 1)

function makeMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aPower;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vFade;
      varying float vPower;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        vPower = aPower;
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float dist = -centre.z;
        // Gone up close (the real hole is there), clearly there from afar.
        vFade = smoothstep(22.0, 70.0, dist);
        // Size: the dug area's own size, but never smaller than a readable dot.
        float base = length(instanceMatrix[0].xyz);
        float size = max(base, dist * 0.04 * (0.8 + aPower * 0.5));
        float phase = instanceMatrix[3].x * 0.3 + instanceMatrix[3].z * 0.2;
        size *= 0.94 + 0.06 * sin(uTime * 1.6 + phase);
        // Sit the ring on its hole: lifted by half its size, its bottom edge at the ground.
        centre.y += size * 0.42;
        centre.xy += position.xy * size;
        gl_Position = projectionMatrix * centre;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vFade;
      varying float vPower;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float d = length(p);
        if (d > 1.0 || vFade < 0.01) discard;
        // A bold coloured ring with a soft halo outside it, and a dark pit in the middle:
        // reads as "a hole, dug here" on bright snow as well as on rock.
        float ring = smoothstep(0.5, 0.64, d) * (1.0 - smoothstep(0.74, 0.9, d));
        float halo = pow(1.0 - d, 2.2) * 0.5;
        float pit = (1.0 - smoothstep(0.0, 0.5, d)) * 0.5;
        float strength = 0.7 + vPower * 0.3;
        vec3 col = mix(vCol * 1.08, vec3(0.13, 0.09, 0.07), pit * (1.0 - ring));
        float a = clamp(ring * 0.95 + halo + pit * 0.8, 0.0, 1.0) * vFade * strength;
        gl_FragColor = vec4(col, a);
      }
    `,
  })
}

/** Groups every dug ball into cells: position, size, strength and whose they are. */
function buildCells() {
  const cells = new Map()
  const mine = net.mineId
  for (let i = 0; i < sx.length; i += 1) {
    const k = Math.floor(sx[i] / CELL) * 100003 + Math.floor(sz[i] / CELL)
    let c = cells.get(k)
    if (!c) {
      c = { x: 0, z: 0, n: 0, r: 0, mine: 0, ymin: Infinity }
      cells.set(k, c)
    }
    c.x += sx[i]
    c.z += sz[i]
    c.n += 1
    c.r = Math.max(c.r, sr[i])
    if (sby[i] && sby[i] === mine) c.mine += 1
    if (sy[i] < c.ymin) c.ymin = sy[i]
  }
  return [...cells.values()].map((c) => ({ x: c.x / c.n, z: c.z / c.n, n: c.n, r: c.r, mine: c.mine > 0 }))
}

export default function DigMarkers() {
  const meshRef = useRef(null)
  const material = useMemo(() => makeMaterial(), [])
  const seen = useRef({ count: -1, cap: 0, at: 0 })
  const power = useMemo(() => new InstancedBufferAttribute(new Float32Array(CAPACITY), 1), [])
  useEffect(() => () => material.dispose(), [material])

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const count = getDigCount()
    const cap = quality().digMarkers
    const t = clock.elapsedTime
    // Rebuilt when the digs (or the graphics level) change - at most twice a second
    // while someone is mining.
    if ((count === seen.current.count && cap === seen.current.cap) || t < seen.current.at) return
    seen.current.count = count
    seen.current.cap = cap
    seen.current.at = t + 0.5
    const cells = buildCells()
    // Yours first (always shown), then the biggest dug areas.
    cells.sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || b.n - a.n)
    const n = Math.min(cells.length, cap, CAPACITY)
    for (let i = 0; i < n; i += 1) {
      const c = cells[i]
      // Just above the surface, ringing the opening painted into the ground below.
      const y = surfaceAt(c.x, c.z) + 0.9
      _dummy.position.set(c.x, y, c.z)
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.setScalar(Math.max(CELL * 0.9, c.r * 2 + 2))
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
      mesh.setColorAt(i, _color.copy(c.mine ? MINE : THEIRS))
      power.setX(i, Math.min(1, 0.25 + Math.log2(1 + c.n) / 5))
    }
    mesh.count = n
    mesh.visible = n > 0
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    power.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={(m) => {
        meshRef.current = m
        if (m && !m.instanceColor) {
          m.instanceColor = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3)
          m.instanceMatrix.setUsage(DynamicDrawUsage)
          m.geometry = geometry.clone()
          m.geometry.setAttribute('aPower', power)
          m.count = 0
        }
      }}
      args={[geometry, material, CAPACITY]}
      frustumCulled={false}
      renderOrder={4}
      visible={false}
    />
  )
}

