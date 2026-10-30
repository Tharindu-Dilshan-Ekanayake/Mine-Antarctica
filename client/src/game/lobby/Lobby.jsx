import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { MeshLambertMaterial } from 'three'

import { PLAZA } from '@shared/world.js'
import { localPlayer } from '../localPlayer'
import { useQuality } from '../../store/quality'
import { glowMaterial, makePlazaTexture, makeSnowTexture, solidMaterial, uTime } from '../world/materials'
import { Leaderboards, PlotBoards, PlotNameBoards } from './Boards'
import { buildLobby } from './buildLobby'
import Penguins from './Penguins'
import Shopkeepers from './Shopkeepers'
import Signs from './Signs'
import Treadmills from './Treadmills'

/** How far outside the plaza (m) the base's small dressing still draws. */
const DETAIL_MARGIN = 30

/**
 * The circle (x, z, radius) where the snow plain isn't drawn: under the mountain,
 * whose own surface covers it - so a hole dug below the plain shows as a hole. Zero
 * radius until the mountain has loaded (MountainTerrain sets it).
 */
export const plainHole = { value: [0, 0, 0] }

function makeSnowMaterial(map) {
  const mat = new MeshLambertMaterial({ map })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHole = { get value() { return plainHole.value } }
    shader.uniforms.uTime = uTime
    // Under the plaza floor the plain is never seen: not drawing it there means the two
    // can never flicker against each other, however far away you look from.
    shader.uniforms.uPlaza = { value: [PLAZA.minX + 0.05, PLAZA.minZ + 0.05, PLAZA.maxX - 0.05, PLAZA.maxZ - 0.05] }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPlainXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPlainXZ = (modelMatrix * vec4(position, 1.0)).xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHole;\nuniform vec4 uPlaza;\nuniform float uTime;\nvarying vec2 vPlainXZ;')
      .replace(
        'void main() {',
        'void main() {\n  if (uHole.z > 0.0 && distance(vPlainXZ, uHole.xy) < uHole.z) discard;\n  if (all(greaterThan(vPlainXZ, uPlaza.xy)) && all(lessThan(vPlainXZ, uPlaza.zw))) discard;',
      )
      // Glittering snow: here and there a speck catches the sun and twinkles.
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  vec2 glitCell = floor(vPlainXZ * 2.2);
  float glitH = fract(sin(dot(glitCell, vec2(12.9898, 78.233))) * 43758.5453);
  float glit = step(0.965, glitH) * pow(max(0.0, sin(uTime * 2.5 + glitH * 90.0)), 12.0);
  totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * glit * 1.4;`,
      )
  }
  mat.customProgramCacheKey = () => 'snowPlainHole3'
  return mat
}

/** Snow field to the horizon, plus the trampled plaza floor. */
function LobbyGround() {
  const texSize = useQuality((s) => Math.min(512, s.settings.texSize / 2))
  const snow = useMemo(() => {
    const t = makeSnowTexture(texSize)
    t.repeat.set(160, 160)
    return t
  }, [texSize])
  const plaza = useMemo(() => {
    const t = makePlazaTexture(texSize)
    t.repeat.set((PLAZA.maxX - PLAZA.minX) / 10, (PLAZA.maxZ - PLAZA.minZ) / 10)
    return t
  }, [texSize])
  const snowMat = useMemo(() => makeSnowMaterial(snow), [snow])
  useEffect(() => () => snow.dispose(), [snow])
  useEffect(() => () => snowMat.dispose(), [snowMat])
  useEffect(() => () => plaza.dispose(), [plaza])

  const w = PLAZA.maxX - PLAZA.minX
  const d = PLAZA.maxZ - PLAZA.minZ

  return (
    <>
      {/* A few cm under the plaza, so the two never fight - no polygon offset needed. */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.04} receiveShadow>
        <planeGeometry args={[1800, 1800]} />
        <primitive object={snowMat} attach="material" />
      </mesh>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[(PLAZA.minX + PLAZA.maxX) / 2, 0, (PLAZA.minZ + PLAZA.maxZ) / 2]}
        receiveShadow
      >
        <planeGeometry args={[w, d]} />
        <meshLambertMaterial map={plaza} />
      </mesh>
    </>
  )
}

/**
 * The base where all eight players meet: shops, gardens, leaderboards and the gate to
 * the mountain. Loaded in the main bundle; the mountain stage streams in after.
 */
export default function Lobby() {
  const shadows = useQuality((s) => s.settings.shadows)
  const { solid, glow, detail, detailGlow } = useMemo(() => buildLobby(), [])
  const detailRef = useRef(null)
  // The small dressing only draws while you're at (or near) the base.
  useFrame(() => {
    const g = detailRef.current
    if (!g) return
    const near =
      localPlayer.x > PLAZA.minX - DETAIL_MARGIN &&
      localPlayer.x < PLAZA.maxX + DETAIL_MARGIN &&
      localPlayer.z > PLAZA.minZ - DETAIL_MARGIN &&
      localPlayer.z < PLAZA.maxZ + DETAIL_MARGIN
    if (g.visible !== near) g.visible = near
  })
  useEffect(
    () => () => {
      solid.dispose()
      detail.dispose()
      detailGlow.dispose()
      glow.dispose()
    },
    [solid, glow, detail, detailGlow],
  )

  return (
    <group>
      <LobbyGround />
      <mesh geometry={solid} material={solidMaterial} castShadow={shadows} receiveShadow />
      <mesh geometry={glow} material={glowMaterial} castShadow={shadows} />
      <group ref={detailRef}>
        <mesh geometry={detail} material={solidMaterial} castShadow={shadows} receiveShadow />
        <mesh geometry={detailGlow} material={glowMaterial} />
      </group>
      <Signs />
      <Leaderboards />
      <PlotBoards />
      <PlotNameBoards />
      <Treadmills />
      <Penguins />
      <Shopkeepers />
    </group>
  )
}
