import { useEffect, useMemo } from 'react'
import { BufferAttribute, DoubleSide, MeshBasicMaterial, PlaneGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { CAULDRON, GATE, PLOTS, STALLS } from '@shared/world.js'
import { useQuality } from '../../store/quality'
import { uTime } from '../world/materials'
import { STALL_SIGN_Y } from './buildLobby'
import { canvasTexture, fontsReady, makeCanvas, outlinedText } from './canvasText'

/**
 * Every big floating word in the base (SELL, PICKAXES, ...) from one canvas atlas:
 * 8 rows of 8:1 text, one merged mesh, one draw call.
 */
const SIGNS = [
  ...STALLS.map((s) => ({ text: s.label, color: s.colors[0], x: s.x, y: STALL_SIGN_Y, z: s.z + 0.4, h: 1.9 })),
  { text: 'MOUNTAIN', color: '#7fe6ff', x: GATE.x, y: 11.6, z: GATE.z + 0.2, h: 2.2 },
  { text: 'CANDY CAULDRON', color: '#ffb52e', x: CAULDRON.x, y: 6.4, z: CAULDRON.z, h: 1.4 },
  { text: 'CRYSTAL GARDEN', color: '#8cf03c', x: (PLOTS[0].x + PLOTS[3].x) / 2, y: 8.5, z: PLOTS[0].z - 12, h: 2.2 },
]
const ROWS = 8

function drawAtlas(canvas) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const rowH = canvas.height / ROWS
  ctx.clearRect(0, 0, w, canvas.height)
  SIGNS.forEach((s, i) => {
    outlinedText(ctx, s.text, w / 2, rowH * (i + 0.5), {
      size: rowH * 0.78,
      color: s.color,
      maxWidth: w * 0.96,
    })
  })
}

function buildGeometry() {
  const parts = SIGNS.map((s, i) => {
    const geo = new PlaneGeometry(s.h * ROWS, s.h)
    const uv = geo.getAttribute('uv')
    const bottom = 1 - (i + 1) / ROWS
    for (let k = 0; k < uv.count; k += 1) uv.setY(k, bottom + uv.getY(k) / ROWS)
    geo.translate(s.x, s.y, s.z)
    // Row index per vertex, so each sign bobs as one piece.
    geo.setAttribute('aRow', new BufferAttribute(new Float32Array(uv.count).fill(i), 1))
    return geo
  })
  const merged = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  return merged
}

/** Sign material whose rows each bob on their own beat (vertex shader, no CPU). */
function signMaterial(map) {
  const mat = new MeshBasicMaterial({ map, transparent: true, alphaTest: 0.25, side: DoubleSide, toneMapped: false })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
attribute float aRow;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  float row = aRow;
  transformed.y += sin(uTime * 1.7 + row * 1.9) * 0.14;
  transformed.x += sin(uTime * 0.9 + row) * 0.04 * (uv.x - 0.5);`,
      )
  }
  mat.customProgramCacheKey = () => 'signBob'
  return mat
}

export default function Signs() {
  const size = useQuality((s) => s.settings.texSize)
  const canvas = useMemo(() => makeCanvas(size, size), [size])
  const texture = useMemo(() => canvasTexture(canvas), [canvas])
  const geometry = useMemo(() => buildGeometry(), [])

  useEffect(() => {
    let alive = true
    drawAtlas(canvas)
    texture.needsUpdate = true
    // Redraw once the cartoon font has arrived.
    fontsReady().then(() => {
      if (!alive) return
      drawAtlas(canvas)
      texture.needsUpdate = true
    })
    return () => {
      alive = false
    }
  }, [canvas, texture])

  const material = useMemo(() => signMaterial(texture), [texture])
  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} material={material} renderOrder={2} />
  )
}
