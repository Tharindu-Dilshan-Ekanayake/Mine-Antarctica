import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MeshLambertMaterial } from 'three'

import { useNet } from '../net/net'
import { useUI } from '../store/ui'
import { makeToolMaterial } from './avatar/Avatar'
import { HAND, toolGeometry } from './avatar/toolGeometry'
import { cameraState, localPlayer } from './localPlayer'
import { GeoBuilder } from './world/geoBuilder'
import { makeGlowMaterial } from './world/materials'

/**
 * First person: your hands and your pickaxe, at the bottom right of the screen - a
 * gloved fist round the grip, the other glove further down, parka sleeves running back
 * out of view. It all sways as you walk, bobs as you breathe, and chops down hard when
 * you swing, with a little kick when the blow lands. Drawn over everything else, so it
 * never sinks into the tunnel wall in front of you. Only mounted in first person.
 */
const toolMat = makeToolMaterial(true)
const glowMat = (() => {
  const m = makeGlowMaterial(1.1)
  m.depthTest = false
  m.depthWrite = false
  return m
})()
const armMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, depthTest: false, depthWrite: false })

/** The arms, in the tool's own space (grip at y = -HAND, handle along +z). */
const armsGeometry = (() => {
  const b = new GeoBuilder()
  const GLOVE = '#6b4a35'
  const CUFF = '#f2e8d5'
  const SLEEVE = '#2a5fa3'
  const SLEEVE_DARK = '#1f4a82'
  // The fist round the grip, knuckles forward.
  b.box(0, -HAND, 0.02, 0.2, 0.22, 0.22, GLOVE)
  b.box(0, -HAND + 0.02, 0.13, 0.17, 0.16, 0.06, '#5a3c2b')
  // The other hand, lower down the handle.
  b.box(0, -HAND - 0.04, -0.3, 0.19, 0.2, 0.2, GLOVE)
  // Fur cuffs, then the padded parka sleeves back towards you.
  b.box(0, -HAND + 0.08, -0.13, 0.26, 0.26, 0.1, CUFF)
  b.box(0, -HAND + 0.05, -0.43, 0.25, 0.25, 0.08, CUFF)
  b.box(0, -HAND + 0.2, -0.45, 0.3, 0.3, 0.6, SLEEVE)
  b.box(0, -HAND + 0.12, -0.8, 0.3, 0.28, 0.5, SLEEVE_DARK)
  return b.build()
})()

const FOV_FIRST = 72

function HeldTool() {
  const rigRef = useRef(null)
  const toolRef = useRef(null)
  const lastSwing = useRef(-1)
  const kick = useRef(0)
  const pickaxe = useNet((s) => s.me?.pickaxe ?? 'rusted')
  const tool = useMemo(() => toolGeometry(pickaxe), [pickaxe])

  useFrame(({ camera, size }, delta) => {
    const rig = rigRef.current
    const t = toolRef.current
    if (!rig || !t) return
    rig.visible = cameraState.eyes
    if (!rig.visible) return
    // A slightly wider view in first person: more of the tunnel round you.
    const fov = cameraState.mode === 'first' ? FOV_FIRST : 66
    if (camera.fov !== fov) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    // The rig rides with the camera; the tool sits in it, low and to the right.
    rig.position.copy(camera.position)
    rig.quaternion.copy(camera.quaternion)
    const p = localPlayer
    const walk = p.grounded ? Math.min(1, p.speed / 7) : 0
    const sway = Math.sin(p.time * 5.5) * 0.025 * walk
    const lift = Math.abs(Math.cos(p.time * 5.5)) * 0.02 * walk + Math.sin(p.time * 1.6) * 0.004
    // A chop: raised back, then down hard, then recovering.
    const s = p.swing
    const chop = s < 0 ? 0 : s < 0.35 ? -(s / 0.35) * 0.7 : s < 0.55 ? -0.7 + ((s - 0.35) / 0.2) * 2.1 : 1.4 * (1 - (s - 0.55) / 0.45)
    // The moment the blow lands: a little jolt back up the arms.
    if (lastSwing.current < 0.55 && s >= 0.55) kick.current = 1
    lastSwing.current = s
    kick.current = Math.max(0, kick.current - delta * 6)
    const jolt = kick.current * kick.current * 0.05
    // Narrow (portrait) screens see less to the sides: the tool shrinks in and down to fit.
    const narrow = Math.min(1, size.width / size.height / 1.5)
    t.scale.setScalar(0.36 * (0.32 + 0.68 * narrow))
    t.position.set((0.34 + sway) * (0.45 + 0.55 * narrow), -0.27 + lift + jolt - Math.max(0, chop) * 0.06, -0.62 + jolt)
    t.rotation.set(0.25 + chop, Math.PI + 0.5, -0.3)
  })


  return (
    <group ref={rigRef}>
      <group ref={toolRef}>
        <mesh geometry={armsGeometry} material={armMat} renderOrder={999} />
        <mesh geometry={tool.solid} material={toolMat} renderOrder={1000} />
        {tool.glow && <mesh geometry={tool.glow} material={glowMat} renderOrder={1001} />}
      </group>
    </group>
  )
}

/** Always mounted (hidden when unused): the view moves to your eyes in tunnels too. */
export default function FirstPersonTool() {
  useUI((s) => s.cameraMode)
  return <HeldTool />
}
