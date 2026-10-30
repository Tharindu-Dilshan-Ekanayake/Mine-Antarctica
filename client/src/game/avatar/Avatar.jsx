import { useFrame } from '@react-three/fiber'
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdditiveBlending, BoxGeometry, DoubleSide, MeshBasicMaterial, MeshLambertMaterial, Vector3 } from 'three'

import { useQuality } from '../../store/quality'
import { addWorldPos, makeGlowMaterial, uTime } from '../world/materials'
import { toolArmAngle } from './avatarRig'
import Backpack from './Backpack'
import BloxityAvatar from './BloxityAvatar'
import { SHOULDER, toolGeometry, trailGeometry } from './toolGeometry'

/** Glowing pickaxe parts: brighter than the scenery glow, still twinkling. */
const toolGlowMaterial = makeGlowMaterial(1.1)

/**
 * Pickaxe surface: polished. A bright rim catches the light, and every couple of
 * seconds a glint sweeps across the head - strongest on bright metal and gems, barely
 * there on a wooden handle. One shared material, all in the shader.
 */
export function makeToolMaterial(overlay = false) {
  // `overlay`: drawn on top of everything (the first-person pickaxe in your hands).
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, depthTest: !overlay, depthWrite: !overlay })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    addWorldPos(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  float lum = dot(vColor.rgb, vec3(0.299, 0.587, 0.114));
  float shiny = smoothstep(0.25, 0.75, lum);
  float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.5);
  float sweep = smoothstep(0.9, 1.0, sin((vWPos.x + vWPos.y * 1.3 + vWPos.z) * 2.2 - uTime * 3.2));
  totalEmissiveRadiance += vColor.rgb * rim * (0.25 + shiny * 0.4) + vec3(1.0, 0.98, 0.92) * sweep * shiny * 0.65;`,
      )
  }
  mat.customProgramCacheKey = () => (overlay ? 'toolShineOverlay' : 'toolShine')
  return mat
}
const toolMaterial = makeToolMaterial()

/**
 * A character: the Bloxity avatar (or a blocky stand-in while it loads / if the CDN
 * is unreachable) plus the pickaxe in its right hand.
 *
 * Model space: feet at y = 0, facing +Z. The parent group handles world placement.
 */

// Shared by every blocky stand-in.
const limbGeo = new BoxGeometry(0.36, 0.72, 0.36)
const torsoGeo = new BoxGeometry(0.74, 0.74, 0.38)
const headGeo = new BoxGeometry(0.46, 0.46, 0.46)
const skinMat = new MeshLambertMaterial({ color: '#f2c79a' })
const shirtMat = new MeshLambertMaterial({ color: '#2b2f3a' })
const pantsMat = new MeshLambertMaterial({ color: '#3a4c6b' })

/** Roblox-style block character, animated with the same motion data. */
function BlockyAvatar({ motionRef, shirt }) {
  const legL = useRef(null)
  const legR = useRef(null)
  const armL = useRef(null)

  useFrame(() => {
    const m = motionRef.current
    if (!m || !legL.current) return
    const ratio = Math.min(1, m.speed / Math.max(m.maxSpeed, 0.001))
    const cycle = m.grounded ? Math.sin(m.time * (5 + ratio * 5)) * 0.8 * ratio : 0.5
    legL.current.rotation.x = cycle
    legR.current.rotation.x = -cycle
    armL.current.rotation.x = m.grounded ? -cycle : -2.1
  })

  return (
    <group>
      <group ref={legL} position={[0.19, 0.72, 0]}>
        <mesh geometry={limbGeo} material={pantsMat} position={[0, -0.36, 0]} />
      </group>
      <group ref={legR} position={[-0.19, 0.72, 0]}>
        <mesh geometry={limbGeo} material={pantsMat} position={[0, -0.36, 0]} />
      </group>
      <mesh geometry={torsoGeo} material={shirt ?? shirtMat} position={[0, 1.09, 0]} />
      <group ref={armL} position={[0.56, 1.42, 0]}>
        <mesh geometry={limbGeo} material={skinMat} position={[0, -0.34, 0]} />
      </group>
      <mesh geometry={headGeo} material={skinMat} position={[0, 1.7, 0]} />
    </group>
  )
}

/** The right arm of the blocky stand-in rides with the tool pivot. */
function BlockyRightArm() {
  return <mesh geometry={limbGeo} material={skinMat} position={[0, -0.34, 0]} />
}

class AvatarBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err) {
    console.warn('[avatar] Bloxity avatar unavailable, using blocky stand-in', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * @param {{ equipped?: object|null, proportions?: object, motionRef: React.RefObject,
 *           pickaxe: string, castShadow?: boolean, onReady?: () => void }} props
 *   motionRef.current: { time, speed, maxSpeed, grounded, swing }
 */
export default function Avatar({ equipped, proportions, motionRef, pickaxe, castShadow = false, onReady, bagRef, showTag = false }) {
  const toolRef = useRef(null)
  const fullRef = useRef(null)
  const trailRef = useRef(null)
  const rootRef = useRef(null)
  /** The real right shoulder, in this group's space, once the Bloxity body is up. */
  const shoulderRef = useRef(null)
  if (!shoulderRef.current) shoulderRef.current = Object.assign(new Vector3(SHOULDER.x, SHOULDER.y, SHOULDER.z), { live: false })
  const tool = toolGeometry(pickaxe)
  const trails = useQuality((s) => s.settings.particles)
  // Additive swoosh in the pickaxe's colour; per avatar so each fades on its own.
  const trailMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: tool.style.glow ?? tool.style.edge,
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
        opacity: 0,
      }),
    [tool],
  )
  useEffect(() => () => trailMaterial.dispose(), [trailMaterial])
  // The blocky stand-in shows until the real avatar has assembled (or forever, if
  // the Bloxity CDN can't be reached); its right arm lives on the tool pivot.
  const [real, setReal] = useState(false)
  const handleReady = useCallback(() => {
    setReal(true)
    onReady?.()
  }, [onReady])

  useFrame(() => {
    const m = motionRef.current
    if (!m) return
    const angle = toolArmAngle(m)
    const s = shoulderRef.current
    const live = real && s.live
    if (toolRef.current) {
      // Put away mid-emote: the arm is busy dancing, not holding a pickaxe.
      toolRef.current.visible = !(m.emoteClip && m.emoteWeight > 0.5)
      toolRef.current.rotation.x = angle
      if (live) toolRef.current.position.copy(s)
      else toolRef.current.position.set(SHOULDER.x, SHOULDER.y, SHOULDER.z)
    }
    const trail = trailRef.current
    if (trail) {
      trail.position.copy(toolRef.current?.position ?? s)
      // Only during the chop: fades in as the head comes down, out as it lands.
      const t = m.swing
      const k = t < 0.35 || t > 0.85 ? 0 : t < 0.5 ? (t - 0.35) / 0.15 : 1 - (t - 0.5) / 0.35
      trail.visible = k > 0.01
      trail.rotation.x = angle
      trailMaterial.opacity = k * 0.85
    }
  })

  const blocky = <BlockyAvatar motionRef={motionRef} />

  return (
    <group ref={rootRef}>
      <group ref={fullRef}>
        <AvatarBoundary fallback={blocky}>
          <Suspense fallback={blocky}>
            <BloxityAvatar
              equipped={equipped}
              proportions={proportions}
              motionRef={motionRef}
              castShadow={castShadow}
              onReady={handleReady}
              rootRef={fullRef}
              shoulderRef={shoulderRef}
            />
          </Suspense>
        </AvatarBoundary>
      </group>
      <group ref={toolRef} position={[SHOULDER.x, SHOULDER.y, SHOULDER.z]}>
        <mesh geometry={tool.solid} material={toolMaterial} castShadow={castShadow} />
        {tool.glow && <mesh geometry={tool.glow} material={toolGlowMaterial} />}
        {!real && <BlockyRightArm />}
      </group>
      {bagRef && <Backpack bagRef={bagRef} shoulderRef={shoulderRef} showTag={showTag} castShadow={castShadow} />}
      {trails && (
        <mesh
          ref={trailRef}
          geometry={trailGeometry()}
          material={trailMaterial}
          position={[SHOULDER.x, SHOULDER.y, SHOULDER.z]}
          visible={false}
          renderOrder={6}
        />
      )}
    </group>
  )
}
