import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, MeshLambertMaterial, NoColorSpace, RepeatWrapping } from 'three'

import { canvasTexture, makeCanvas } from '../lobby/canvasText'

/**
 * Shared, module-level materials and procedural textures. Created once, reused by
 * every mesh that needs them.
 */

/** Matte vertex-coloured material for merged static props. */
export const solidMaterial = new MeshLambertMaterial({ vertexColors: true })

/**
 * Seconds since start, shared by every animated shader (twinkle, sway, shimmer).
 * Written once per frame by <TimeDriver>; materials hold a reference to it.
 */
export const uTime = { value: 0 }

/** Adds `vWPos` (world position, instancing-aware) to a vertex/fragment shader pair. */
export function addWorldPos(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
varying vec3 vWPos;`)
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  vWPos = (modelMatrix * wp).xyz;`,
    )
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWPos;`)
}

/**
 * Vertex-coloured material that also emits its own colour, so crystals and bulbs
 * read as glowing without real lights. Each spot twinkles on its own rhythm,
 * keyed off its world position.
 */
export function makeGlowMaterial(strength = 0.55, options = {}) {
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, ...options })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    addWorldPos(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  float seed = dot(floor(vWPos * 1.7), vec3(12.9898, 78.233, 37.719));
  float tw = 0.78 + 0.22 * sin(uTime * (1.5 + fract(sin(seed) * 43758.5) * 2.5) + seed);
  totalEmissiveRadiance += vColor.rgb * ${strength.toFixed(2)} * tw;`,
      )
  }
  // Distinct program cache key per strength.
  mat.customProgramCacheKey = () => `glow${strength}`
  return mat
}

export const glowMaterial = makeGlowMaterial(0.55)

function noiseCanvas(size, paint) {
  const canvas = makeCanvas(size, size)
  const ctx = canvas.getContext('2d')
  paint(ctx, size)
  const tex = canvasTexture(canvas)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  return tex
}

/** Seeded so the speckle pattern is the same every load. */
function rng(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

/** Bright wind-swept snow. */
export function makeSnowTexture(size) {
  return noiseCanvas(size, (ctx, n) => {
    const r = rng(7)
    ctx.fillStyle = '#eef3f9'
    ctx.fillRect(0, 0, n, n)
    // Soft wind ripples.
    for (let i = 0; i < 70; i += 1) {
      const y = r() * n
      ctx.strokeStyle = `rgba(150,175,205,${0.05 + r() * 0.08})`
      ctx.lineWidth = 1 + r() * 3
      ctx.beginPath()
      ctx.moveTo(0, y)
      for (let x = 0; x <= n; x += n / 8) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 4)
      ctx.stroke()
    }
    for (let i = 0; i < n * 3; i += 1) {
      ctx.fillStyle = `rgba(160,185,215,${r() * 0.18})`
      ctx.fillRect(r() * n, r() * n, 2, 2)
    }
  })
}

/** Dark trampled snow over rock: the plaza floor. */
export function makePlazaTexture(size) {
  return noiseCanvas(size, (ctx, n) => {
    const r = rng(11)
    ctx.fillStyle = '#4b5463'
    ctx.fillRect(0, 0, n, n)
    for (let i = 0; i < n * 6; i += 1) {
      const v = r()
      ctx.fillStyle = v > 0.6 ? `rgba(220,230,245,${r() * 0.35})` : `rgba(20,25,35,${r() * 0.25})`
      ctx.fillRect(r() * n, r() * n, 1 + r() * 3, 1 + r() * 3)
    }
    for (let i = 0; i < 26; i += 1) {
      ctx.fillStyle = `rgba(230,238,248,${0.05 + r() * 0.12})`
      ctx.beginPath()
      ctx.ellipse(r() * n, r() * n, 8 + r() * 30, 4 + r() * 14, r() * 3, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

/** Grey detail noise multiplied over the mountain's vertex colours. */
export function makeDetailTexture(size) {
  return noiseCanvas(size, (ctx, n) => {
    const r = rng(23)
    ctx.fillStyle = '#e8e8e8'
    ctx.fillRect(0, 0, n, n)
    for (let i = 0; i < n * 4; i += 1) {
      const g = 185 + Math.floor(r() * 70)
      ctx.fillStyle = `rgba(${g},${g},${g},0.35)`
      ctx.beginPath()
      ctx.arc(r() * n, r() * n, 0.6 + r() * 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

/**
 * Tileable rock: one grey-scale texture - lumpy fractal noise with a network of cracks -
 * used for the walls of dug tunnels. Sampled from three directions (triplanar) so it
 * never stretches on steep or overhanging walls, and read both as colour variation and as
 * a height map for the bumpy lighting. Built in code: zero download.
 */
export function makeRockTexture(size) {
  const canvas = makeCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(size, size)
  const r = rng(91)
  // Periodic value-noise lattices, one per octave: [cells, weight]. Three independent
  // sets, one per colour channel: R = lumpy rocky relief (the height map), G and B
  // = two other noises the shader uses for patches of stone, moss and thin sandy veins -
  // so one texture read gives three unrelated values.
  const OCTAVES = [
    [4, 0.3],
    [8, 0.26],
    [16, 0.2],
    [32, 0.15],
    [64, 0.09],
  ]
  const grids = [0, 1, 2].map(() => OCTAVES.map(([n]) => Float32Array.from({ length: n * n }, () => r())))
  const sample = (g, n, u, v) => {
    const x = u * n
    const y = v * n
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const xa = x0 % n
    const xb = (x0 + 1) % n
    const ya = (y0 % n) * n
    const yb = ((y0 + 1) % n) * n
    const a = g[ya + xa]
    const b = g[ya + xb]
    const c = g[yb + xa]
    const d = g[yb + xb]
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }
  const fractal = (set, u, v) => {
    let h = 0
    for (let o = 0; o < OCTAVES.length; o += 1) h += sample(set[o], OCTAVES[o][0], u, v) * OCTAVES[o][1]
    return h
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size
      const v = y / size
      // Lumpy relief with deep crevices (the low values); no contour-line "cracks": those
      // close into loops and look like a maze.
      const relief = Math.min(1, Math.max(0, (fractal(grids[0], u, v) - 0.5) * 1.5 + 0.5))
      const i = (y * size + x) * 4
      img.data[i] = Math.round(relief * 255)
      img.data[i + 1] = Math.round(Math.min(1, fractal(grids[1], u, v) * 1.1) * 255)
      img.data[i + 2] = Math.round(Math.min(1, fractal(grids[2], u, v) * 1.1) * 255)
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = NoColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.minFilter = LinearMipmapLinearFilter
  tex.magFilter = LinearFilter
  tex.anisotropy = 2
  return tex
}
