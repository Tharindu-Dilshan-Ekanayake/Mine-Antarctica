import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, DynamicDrawUsage, InstancedBufferAttribute, Object3D } from 'three'

import { kg } from '@shared/format.js'
import { makeCrystalMaterial } from '../crystals/crystalMaterials'
import { canvasTexture, makeCanvas, outlinedText } from '../lobby/canvasText'
import { GeoBuilder } from '../world/geoBuilder'
import { solidMaterial } from '../world/materials'

/**
 * The miner's backpack, worn on the back: it grows with the capacity you've bought,
 * crystals poke out of the top as it fills (in the colours of what you're carrying),
 * it bounces when something goes in, and the local player's has a load tag.
 *
 * `bagRef.current` = { kg, cap, colors: string[], version, bump } kept up to date by the
 * owner (bump `version` whenever kg or colors change).
 * Lives in the avatar's space (feet at 0, facing +z), hung under the shoulders.
 */

const SHARDS = 6
const _dummy = new Object3D()
const _color = new Color()

let bagGeometry = null
function backpackGeometry() {
  if (bagGeometry) return bagGeometry
  const b = new GeoBuilder()
  const CANVAS = '#7a5a3a'
  const DARK = '#4e3826'
  const STRAP = '#2b211a'
  const BRASS = '#d9b45a'
  // Main sack, slightly bulging, and the lid flap over the top.
  b.box(0, 0, 0, 0.46, 0.56, 0.24, CANVAS, { jitter: 0.08 })
  b.box(0, -0.02, -0.02, 0.5, 0.5, 0.22, CANVAS, { jitter: 0.06 })
  b.box(0, 0.25, -0.03, 0.48, 0.1, 0.27, DARK, { rx: -0.12 })
  // Big outer pocket with a flap and buckle (faces the camera when you walk away).
  b.box(0, -0.1, -0.14, 0.34, 0.26, 0.08, CANVAS, { jitter: 0.08 })
  b.box(0, 0.02, -0.18, 0.36, 0.06, 0.04, DARK)
  b.box(0, -0.02, -0.2, 0.06, 0.06, 0.02, BRASS)
  // Side pockets.
  for (const s of [-1, 1]) b.box(s * 0.26, -0.08, 0, 0.08, 0.24, 0.18, DARK, { jitter: 0.06 })
  // Straps running over the shoulders.
  for (const s of [-1, 1]) {
    b.box(s * 0.13, 0.12, 0.13, 0.06, 0.5, 0.04, STRAP)
    b.box(s * 0.13, 0.33, 0.06, 0.06, 0.04, 0.2, STRAP)
  }
  // Rolled sleeping mat strapped under the lid.
  b.cyl(0, 0.33, 0.01, 0.07, 0.07, 0.5, '#3d6b8a', { rz: Math.PI / 2, seg: 8 })
  for (const s of [-1, 1]) b.cyl(s * 0.16, 0.33, 0.01, 0.075, 0.075, 0.03, STRAP, { rz: Math.PI / 2, seg: 8 })
  // Hanging lantern clip and a tiny pickaxe charm.
  b.box(0.2, -0.24, -0.12, 0.04, 0.04, 0.04, BRASS)
  bagGeometry = b.build()
  return bagGeometry
}

let shardGeometry = null
function crystalShard() {
  if (shardGeometry) return shardGeometry
  const b = new GeoBuilder()
  b.crystal(0, 0, 0, 0.045, 0.2, '#ffffff', { jitter: 0.15 })
  shardGeometry = b.build()
  return shardGeometry
}
const shardMaterial = makeCrystalMaterial(true)

/** How big the pack looks for a capacity: bigger bags for bigger loads. */
const bagScale = (cap) => 1 + Math.min(3, Math.max(0, Math.log10(Math.max(cap, 1) / 22))) * 0.22

/** Positions for the shards: a fan along the top opening. */
const SHARD_SPOTS = [
  [-0.14, 0.04, -0.25],
  [0.12, 0.02, 0.2],
  [-0.03, 0.02, -0.05],
  [0.07, 0.03, 0.35],
  [-0.09, 0.0, 0.1],
  [0.16, 0.0, -0.3],
]

/** "4.0 kg / 22 kg" on a canvas: one small texture, redrawn only when it changes. */
function LoadTag({ bagRef }) {
  const canvas = useMemo(() => makeCanvas(256, 72), [])
  const texture = useMemo(() => canvasTexture(canvas), [canvas])
  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => {
    let last = ''
    const draw = () => {
      const { kg: load, cap } = bagRef.current
      const text = `${kg(load).replace(' ', '')} / ${kg(cap).replace(' ', '')}`
      const full = load >= cap * 0.97
      const key = `${text}${full}`
      if (key === last) return
      last = key
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, 256, 72)
      ctx.fillStyle = full ? 'rgba(150,20,20,0.92)' : 'rgba(18,20,28,0.88)'
      ctx.beginPath()
      ctx.roundRect(4, 6, 248, 60, 14)
      ctx.fill()
      // A fill bar along the bottom of the tag.
      ctx.fillStyle = full ? '#ff6a6a' : '#5cd65c'
      ctx.fillRect(14, 54, 228 * Math.min(1, cap ? load / cap : 0), 6)
      outlinedText(ctx, text, 128, 30, { size: 34, color: full ? '#ffe0e0' : '#ffffff', maxWidth: 230 })
      texture.needsUpdate = true
    }
    draw()
    const id = setInterval(draw, 250)
    return () => clearInterval(id)
  }, [bagRef, canvas, texture])
  return (
    <mesh position={[0, -0.02, -0.235]} rotation={[0, Math.PI, 0]} renderOrder={3}>
      <planeGeometry args={[0.36, 0.1]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  )
}

export default function Backpack({ bagRef, shoulderRef, showTag = false, castShadow = false }) {
  const groupRef = useRef(null)
  const shardsRef = useRef(null)
  const geometry = backpackGeometry()
  const shard = crystalShard()
  const shown = useRef({ count: -1, version: -1 })

  useFrame((_s, delta) => {
    const g = groupRef.current
    const bag = bagRef.current
    if (!g || !bag) return
    // Hang under the shoulders, following the run bob.
    const sy = shoulderRef?.current?.live ? shoulderRef.current.y : 1.43
    const bump = bag.bump > 0 ? Math.sin((1 - bag.bump) * Math.PI) * 0.12 : 0
    if (bag.bump > 0) bag.bump = Math.max(0, bag.bump - delta * 4)
    const s = bagScale(bag.cap) * (1 + bump)
    g.position.set(0, sy - 0.3 * s, -0.3 - 0.1 * (s - 1))
    g.scale.set(s, s * (1 - bump * 0.4), s)

    // Crystals poking out of the top, one per sixth of the load.
    const mesh = shardsRef.current
    if (!mesh) return
    const fill = bag.cap ? Math.min(1, bag.kg / bag.cap) : 0
    const count = bag.kg > 0 ? Math.max(1, Math.ceil(fill * SHARDS)) : 0
    if (count === shown.current.count && bag.version === shown.current.version) return
    shown.current.count = count
    shown.current.version = bag.version
    for (let i = 0; i < count; i += 1) {
      const [x, z, tilt] = SHARD_SPOTS[i]
      _dummy.position.set(x, 0.3, z * 0.2)
      _dummy.rotation.set(tilt, i * 1.3, tilt * 0.5)
      _dummy.scale.setScalar(0.9 + (i % 3) * 0.25)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
      mesh.setColorAt(i, _color.set(bag.colors[i % Math.max(1, bag.colors.length)] ?? '#7fe6ff'))
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry} material={solidMaterial} castShadow={castShadow} />
      <instancedMesh
        ref={(m) => {
          shardsRef.current = m
          if (m && !m.instanceColor) {
            m.instanceColor = new InstancedBufferAttribute(new Float32Array(SHARDS * 3).fill(1), 3)
            m.instanceMatrix.setUsage(DynamicDrawUsage)
            m.count = 0
          }
        }}
        args={[shard, shardMaterial, SHARDS]}
        frustumCulled={false}
      />
      {showTag && <LoadTag bagRef={bagRef} />}
    </group>
  )
}
