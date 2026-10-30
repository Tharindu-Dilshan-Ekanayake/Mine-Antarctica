import { useEffect, useMemo } from 'react'
import { BufferAttribute, PlaneGeometry, ShaderMaterial } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { TREADMILL_SPEED, TREADMILLS } from '@shared/world.js'
import { uTime } from '../world/materials'

/**
 * The moving belts of the garden treadmills: dark rubber with glowing chevrons that
 * stream the way the lane runs, at the speed it carries you. Both lanes are one
 * merged mesh with the motion in the shader: one draw call, no CPU work per frame.
 */
function buildBelts() {
  const parts = TREADMILLS.map((t) => {
    const len = t.x1 - t.x0
    const g = new PlaneGeometry(len, t.w).rotateX(-Math.PI / 2).translate((t.x0 + t.x1) / 2, 0.1, t.z)
    const n = g.getAttribute('position').count
    // Metres along the lane (u), across it (v), and which way it runs.
    const uv = g.getAttribute('uv')
    for (let i = 0; i < n; i += 1) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * t.w)
    g.setAttribute('aDir', new BufferAttribute(new Float32Array(n).fill(t.dir), 1))
    return g
  })
  const merged = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  return merged
}

function makeBeltMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime, uSpeed: { value: TREADMILL_SPEED } },
    vertexShader: /* glsl */ `
      attribute float aDir;
      varying vec2 vUv;
      varying float vDir;
      void main() {
        vUv = uv;
        vDir = aDir;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSpeed;
      varying vec2 vUv;
      varying float vDir;
      void main() {
        // Belt slats moving with the lane.
        float u = vUv.x - uTime * uSpeed * vDir;
        float slat = smoothstep(0.42, 0.5, abs(fract(u * 1.6) - 0.5));
        vec3 rubber = mix(vec3(0.13, 0.14, 0.17), vec3(0.08, 0.085, 0.1), slat);
        // Chevrons pointing the way it runs, every 3 m.
        float across = abs(vUv.y - 1.1);
        float c = fract((u * vDir) / 3.0) * 3.0;
        float chevron = 1.0 - smoothstep(0.08, 0.2, abs(c - 1.2 + across * 0.9));
        chevron *= step(across, 0.75);
        vec3 glow = vDir > 0.0 ? vec3(0.24, 0.94, 1.0) : vec3(1.0, 0.82, 0.23);
        gl_FragColor = vec4(rubber + glow * chevron * 0.9, 1.0);
      }
    `,
  })
}

export default function Treadmills() {
  const geometry = useMemo(() => buildBelts(), [])
  const material = useMemo(() => makeBeltMaterial(), [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  return <mesh geometry={geometry} material={material} />
}
