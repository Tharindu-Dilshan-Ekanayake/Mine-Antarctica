import { AdditiveBlending, DoubleSide, MeshLambertMaterial, MeshStandardMaterial, ShaderMaterial } from 'three'

import { addWorldPos, uTime } from '../world/materials'

/**
 * Crystal surface: faceted, self-lit, with a bright rim and a glint that sweeps up
 * each crystal on its own beat. All in the fragment shader: no per-frame CPU work.
 *
 * The rarer and bigger the crystal, the more it shows off (per-instance `aFx` =
 * rarity, size band): a brighter rim and quicker glints for everything above Common,
 * a slow heartbeat glow from Epic up, twinkling gold glitter on Legendary, and a
 * rainbow sheen drifting over Mythic.
 */
export function makeCrystalMaterial(lite = false) {
  // `lite` (LOW preset): Lambert instead of PBR, far cheaper per pixel on weak GPUs,
  // with the same rim and glint.
  const mat = lite
    ? new MeshLambertMaterial({ vertexColors: true, flatShading: true })
    : new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.28, metalness: 0.1 })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    addWorldPos(shader)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aFx;
varying vec2 vFx;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vFx = aFx;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
varying vec2 vFx;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  float rar = vFx.x;
  float big = vFx.y;
  float ph = dot(floor(vWPos * 0.6), vec3(1.7, 3.1, 2.3));
  float glint = pow(max(0.0, sin(uTime * (1.8 + rar * 0.45) + ph + vWPos.y * 3.0)), 14.0 - rar);
  float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
  vec3 body = vColor.rgb;
  // Mythic: a rainbow sheen drifting over the facets.
  if (rar > 4.5) {
    vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + dot(vWPos, vec3(0.16, 0.22, 0.12)) + uTime * 0.25));
    body = mix(body, rainbow, 0.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, rainbow, 0.35);
  }
  // Epic and up: a slow heartbeat glow from inside.
  float beat = rar > 2.5 ? (0.5 + 0.5 * sin(uTime * 2.4 + ph)) * 0.16 * (rar - 2.0) : 0.0;
  // Legendary and up: specks of glitter that twinkle on and off.
  float spark = 0.0;
  if (rar > 3.5) {
    vec3 cell = floor(vWPos * 7.0);
    float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    spark = step(0.84, h) * pow(max(0.0, sin(uTime * 4.0 + h * 40.0)), 8.0) * 2.2;
  }
  totalEmissiveRadiance += body * (0.24 + rar * 0.05 + rim * (0.55 + rar * 0.1 + big * 0.05) + glint * (0.8 + rar * 0.2) + beat)
    + vec3(1.0, 0.93, 0.75) * spark;`,
      )
  }
  mat.customProgramCacheKey = () => (lite ? 'crystalShimmerLite2' : 'crystalShimmer2')
  return mat
}

/**
 * Camera-facing glow sprites for rare crystals, billboarded in the vertex shader so
 * the CPU only writes a position + scale per instance. Additive, so overlapping
 * halos brighten instead of sorting.
 */
export function makeHaloMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vPulse;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz);
        float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
        vPulse = 0.7 + 0.3 * sin(uTime * 2.2 + phase);
        c.xy += position.xy * s * (0.92 + 0.08 * sin(uTime * 1.3 + phase));
        gl_Position = projectionMatrix * c;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vPulse;
      void main() {
        vec2 p = vUv - 0.5;
        float d = length(p) * 2.0;
        float glow = pow(max(0.0, 1.0 - d), 2.4);
        // Four-point star that slowly turns.
        float a = uTime * 0.4;
        vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
        float rays = max(0.0, 1.0 - abs(q.x * q.y) * 160.0) * max(0.0, 1.0 - d) * 0.7;
        gl_FragColor = vec4(vCol * (glow + rays) * vPulse * 0.85, 1.0);
      }
    `,
  })
}

/**
 * Loot beams: a soft pillar of light rising from a crystal waiting to be picked up,
 * in its rarity's colour - the rarer, the taller. One instanced, open cylinder; the
 * fade and the drifting bands are all in the shader.
 */
export function makeBeamMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vSeed;
      varying float vNear;
      varying float vEdge;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        vSeed = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        // Fades out as you walk up to it: a beacon from afar, never a wall of light.
        vNear = smoothstep(5.0, 18.0, -mv.z);
        // Brighter at the silhouette, see-through in the middle: a soft glowing tube.
        vec3 n = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
        vEdge = 0.35 + 0.65 * pow(1.0 - abs(n.z), 2.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vSeed;
      varying float vNear;
      varying float vEdge;
      void main() {
        float up = vUv.y;
        float fade = pow(1.0 - up, 1.6) * smoothstep(0.0, 0.06, up);
        float bands = 0.75 + 0.25 * sin(up * 26.0 - uTime * 5.0 + vSeed);
        float pulse = 0.8 + 0.2 * sin(uTime * 2.6 + vSeed * 3.0);
        gl_FragColor = vec4(vCol * fade * bands * pulse * vEdge * vNear * 0.6, 1.0);
      }
    `,
  })
}

/**
 * Sparkles circling Epic-and-up crystals: tiny star billboards on an orbit worked out
 * in the vertex shader from the crystal's centre (instance position), the orbit size
 * (instance scale) and a per-sparkle seed, so the CPU never moves them.
 */
export function makeSparkleMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aSeed;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vTw;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        float r = length(instanceMatrix[0].xyz);
        float a = uTime * (0.9 + fract(aSeed * 7.3) * 0.8) + aSeed * 6.2831;
        vec3 orbit = vec3(cos(a) * r, sin(uTime * 1.7 + aSeed * 9.0) * r * 0.7, sin(a) * r);
        vec4 c = modelViewMatrix * vec4(instanceMatrix[3].xyz + orbit, 1.0);
        vTw = 0.55 + 0.45 * sin(uTime * 6.0 + aSeed * 21.0);
        c.xy += position.xy * (0.16 + r * 0.05) * vTw;
        gl_Position = projectionMatrix * c;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vTw;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float star = max(0.0, 1.0 - abs(p.x * p.y) * 18.0) * max(0.0, 1.0 - length(p));
        float core = pow(max(0.0, 1.0 - length(p) * 1.6), 2.0);
        gl_FragColor = vec4(mix(vCol, vec3(1.0), 0.55) * (star + core) * vTw, 1.0);
      }
    `,
  })
}
