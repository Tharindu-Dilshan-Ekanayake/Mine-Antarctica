import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { DoubleSide, MeshLambertMaterial, Vector3, Vector4 } from 'three'

import { GRID, MOUNTAIN, MOUNTAIN_FOOT } from '@shared/world.js'
import { plainHole } from '../lobby/Lobby'
import { useQuality } from '../../store/quality'
import { localPlayer } from '../localPlayer'
import { VCOL } from '../terrain/digStore'
import { CHUNKS, getGeneration } from '../terrain/heightGrid'
import { addWorldPos, makeDetailTexture, uTime } from '../world/materials'
import { takeDirtySurface } from '../terrain/digStore'
import { createChunkGeometry, createFarGeometry, fillChunkGeometry, fillFarGeometry, recolorChunk, recolorFar, setChunkHoles } from './terrainMesh'
import { getReadyVersion, isColumnReady, mergeChunk, resetVolumes, takeStale, updateVolumes } from './volumes'

/**
 * The mountain: a coarse whole-mountain mesh plus a 3x3 window of full-detail
 * chunks streamed around the player. Where players have dug, each near chunk also
 * has a merged volume mesh (tunnels, shafts, craters) and cuts a hole in its
 * heightfield for it. 19 draw calls at most.
 *
 * The far mesh discards its fragments inside the near window so the two never
 * overlap; near chunks carry skirts that hide the seam between them.
 */
const POOL = 9
/** Milliseconds per frame spent meshing dug ground. */
const VOLUME_BUDGET = { LOW: 3, MEDIUM: 4, HIGH: 5 }
const _win = [0, 0, 0, 0]
/**
 * Only stream near chunks when the player is this close to the mountain square.
 * On LOW the coarse mesh covers the foot until you are almost on it.
 */
const NEAR_MARGIN = { LOW: 8, MEDIUM: 32, HIGH: 40 }

function farMaterial(detail) {
  const mat = new MeshLambertMaterial({ vertexColors: true, map: detail })
  mat.userData.nearRect = { value: new Vector4(0, 0, -1, -1) }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNearRect = mat.userData.nearRect
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;\nuniform vec4 uNearRect;')
      .replace(
        'void main() {',
        `void main() {
  if (vWorldXZ.x > uNearRect.x && vWorldXZ.x < uNearRect.z && vWorldXZ.y > uNearRect.y && vWorldXZ.y < uNearRect.w) discard;`,
      )
  }
  mat.customProgramCacheKey = () => 'mountainFar'
  return mat
}

/** Where the headlamp is (the player's head), set every frame. */
const caveTorch = { value: new Vector3() }

/**
 * Dug ground, painted like a crystal cave: deep walls turn to warm layered rock (rust,
 * ochre and plum strata), studded with glowing crystal veins - pink, violet, green,
 * cyan - that pulse softly and grow denser the higher up the mountain you dig.
 * Underground it's lit by a headlamp you carry and the distance fades to darkness, so
 * near and far, and one wall from the next, are easy to tell apart. All in the shader,
 * by world position and each vertex's depth inside the original rock.
 */
function makeCaveMaterial(detail) {
  const mat = new MeshLambertMaterial({ vertexColors: true, map: detail, side: DoubleSide })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    shader.uniforms.uTorch = caveTorch
    addWorldPos(shader)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aDepth;
varying float vDepth;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vDepth = aDepth;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform vec3 uTorch;
varying float vDepth;
float caveHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float cave = smoothstep(0.7, 3.0, vDepth);
  // Layered rock: bands by height, wavering with position.
  float waver = sin(vWPos.x * 0.21 + vWPos.z * 0.17) * 0.9 + sin(vWPos.x * 0.07 - vWPos.z * 0.11) * 1.4;
  float strata = sin(vWPos.y * 0.85 + waver) * 0.5 + 0.5;
  vec3 rust = vec3(0.56, 0.24, 0.18);
  vec3 ochre = vec3(0.74, 0.5, 0.27);
  vec3 plum = vec3(0.4, 0.2, 0.38);
  vec3 rockCol = mix(mix(rust, ochre, smoothstep(0.35, 0.75, strata)), plum, smoothstep(0.75, 0.98, strata) * 0.8);
  diffuseColor.rgb = mix(diffuseColor.rgb, rockCol * (0.85 + diffuseColor.rgb * 0.3), cave * 0.8);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  // Crystal veins: some cells of a 3D grid hold a glowing patch of crystal.
  vec3 cellPos = vWPos * 0.75;
  vec3 cell = floor(cellPos);
  float h = caveHash(cell);
  float density = 0.86 - clamp(vWPos.y / 320.0, 0.0, 1.0) * 0.1;
  if (h > density && cave > 0.05) {
    vec3 local = fract(cellPos) - 0.5;
    // Small, crisp patches: they sparkle in the wall instead of blurring it.
    float spot = 1.0 - smoothstep(0.08, 0.24, length(local + (vec3(caveHash(cell + 1.3), caveHash(cell + 2.7), caveHash(cell + 4.1)) - 0.5) * 0.3));
    float pick = caveHash(cell + 9.1);
    vec3 vein = pick < 0.25 ? vec3(1.0, 0.35, 0.75) : pick < 0.5 ? vec3(0.7, 0.4, 1.0) : pick < 0.75 ? vec3(0.35, 1.0, 0.55) : vec3(0.35, 0.9, 1.0);
    float pulse = 0.7 + 0.3 * sin(uTime * 1.8 + h * 40.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vein, spot * cave * 0.9);
    totalEmissiveRadiance += vein * spot * cave * pulse * 0.7;
  }`)
      .replace('#include <opaque_fragment>', `
  // Headlamp: underground the light comes from where you stand. Walls near you are
  // bright, far ones dim, and walls turned towards you brighter than the ones turned
  // away - so you can tell at a glance what's close, what's far and where the tunnel goes.
  vec3 toLamp = uTorch - vWPos;
  float dLamp = length(toLamp);
  vec3 nWorld = inverseTransformDirection(normal, viewMatrix);
  float facing = max(dot(nWorld, toLamp / max(dLamp, 0.001)), 0.0);
  float lamp = (0.3 + 0.7 * facing) / (1.0 + dLamp * dLamp * 0.02);
  vec3 lit = outgoingLight * (0.2 + 1.3 * lamp) + diffuseColor.rgb * vec3(1.0, 0.8, 0.55) * lamp * 0.45;
  outgoingLight = mix(outgoingLight, lit, cave);
#include <opaque_fragment>`)
      .replace('#include <fog_fragment>', `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogAmount = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogAmount = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  // Underground the distance fades into darkness, not into the pale sky: far walls sink
  // back, near ones stand out.
  float caveDark = smoothstep(4.0, 26.0, vFogDepth) * cave;
  vec3 fogTo = mix(fogColor, vec3(0.035, 0.022, 0.018), cave);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTo, max(fogAmount, caveDark * 0.92));
#endif`)
  }
  mat.customProgramCacheKey = () => 'caveWalls2'
  return mat
}

export default function MountainTerrain() {
  const settings = useQuality((s) => s.settings)
  const stride = Math.round(settings.nearCell / MOUNTAIN.cell)
  const farStep = settings.farStep
  const shadows = settings.shadows

  const detail = useMemo(() => {
    const t = makeDetailTexture(settings.texSize >= 1024 ? 256 : 128)
    return t
  }, [settings.texSize])
  const nearMat = useMemo(() => new MeshLambertMaterial({ vertexColors: true, map: detail, side: DoubleSide }), [detail])
  const caveMat = useMemo(() => makeCaveMaterial(detail), [detail])
  useEffect(() => () => caveMat.dispose(), [caveMat])
  const farMat = useMemo(() => farMaterial(detail), [detail])
  const farGeo = useMemo(() => createFarGeometry(farStep), [farStep])
  const chunkGeos = useMemo(() => Array.from({ length: POOL }, () => createChunkGeometry(stride)), [stride])

  const nearRefs = useRef([])
  const volRefs = useRef([])
  /** Merged volume geometry per pool slot (grown and swapped as needed). */
  const volGeos = useRef(new Array(POOL).fill(null))
  /** Which chunk each pool slot shows: key = cz * CHUNKS + cx, or -1. */
  const slotKeys = useRef(new Int32Array(POOL).fill(-1))
  const track = useRef({ generation: -1, center: -1, ready: -1, voxel: 0 })

  useEffect(
    () => () => {
      detail.dispose()
      nearMat.dispose()
      farMat.dispose()
    },
    [detail, nearMat, farMat],
  )
  useEffect(() => () => farGeo.dispose(), [farGeo])
  // The mountain is here: the snow plain stops drawing under it (see Lobby).
  useEffect(() => {
    plainHole.value = [MOUNTAIN.cx, MOUNTAIN.cz, MOUNTAIN_FOOT]
    return () => {
      plainHole.value = [0, 0, 0]
    }
  }, [])
  useEffect(
    () => () => {
      for (const g of volGeos.current) g?.dispose()
    },
    [],
  )
  useEffect(() => {
    slotKeys.current.fill(-1)
    track.current.center = -1
    return () => chunkGeos.forEach((g) => g.dispose())
  }, [chunkGeos])
  useEffect(() => {
    track.current.generation = -1
  }, [farGeo])

  useFrame(() => {
    // The headlamp sits on your head.
    caveTorch.value.set(localPlayer.x, localPlayer.y + 1.7, localPlayer.z)
    const t = track.current
    const gen = getGeneration()
    const voxel = stride * MOUNTAIN.cell
    if (gen !== t.generation || voxel !== t.voxel) {
      // New mountain (or new voxel size): start from scratch.
      t.generation = gen
      t.voxel = voxel
      slotKeys.current.fill(-1)
      t.center = -1
      t.ready = -1
      resetVolumes(voxel)
      fillFarGeometry(farGeo)
    }

    // --- New digs: paint their openings into the terrain -------------------------
    // Only the patch round each dig is re-coloured, on the far mesh and on any near
    // chunk it touches: a few dozen vertices, never a whole rebuild.
    const dirty = takeDirtySurface()
    if (dirty.length) {
      const keys = slotKeys.current
      for (let b = 0; b < dirty.length; b += 4) {
        recolorFar(farGeo, dirty[b], dirty[b + 1], dirty[b + 2], dirty[b + 3])
        for (let s = 0; s < POOL; s += 1) {
          const k = keys[s]
          if (k >= 0) recolorChunk(chunkGeos[s], k % CHUNKS, Math.floor(k / CHUNKS), dirty[b], dirty[b + 1], dirty[b + 2], dirty[b + 3])
        }
      }
    }

    // --- Near window -----------------------------------------------------------
    const near = farMat.userData.nearRect.value
    const gx = (localPlayer.x - GRID.originX) / MOUNTAIN.chunk
    const gz = (localPlayer.z - GRID.originZ) / MOUNTAIN.chunk
    const margin = NEAR_MARGIN[useQuality.getState().preset] / MOUNTAIN.chunk
    const active = gx > -margin && gz > -margin && gx < CHUNKS + margin && gz < CHUNKS + margin
    if (!active) {
      near.set(0, 0, -1, -1)
      t.center = -1
      for (let s = 0; s < POOL; s += 1) {
        if (nearRefs.current[s]) nearRefs.current[s].visible = false
        if (volRefs.current[s]) volRefs.current[s].visible = false
      }
      return
    }
    const ccx = Math.min(CHUNKS - 2, Math.max(1, Math.floor(gx)))
    const ccz = Math.min(CHUNKS - 2, Math.max(1, Math.floor(gz)))
    const center = ccz * CHUNKS + ccx

    if (center !== t.center) {
      t.center = center
      // Keep slots that still fall inside the window; refill the rest.
      const keys = slotKeys.current
      for (let s = 0; s < POOL; s += 1) {
        const k = keys[s]
        if (k < 0) continue
        const kx = k % CHUNKS
        const kz = Math.floor(k / CHUNKS)
        if (Math.abs(kx - ccx) > 1 || Math.abs(kz - ccz) > 1) keys[s] = -1
      }
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const k = (ccz + dz) * CHUNKS + ccx + dx
          let has = false
          for (let s = 0; s < POOL; s += 1) if (keys[s] === k) has = true
          if (has) continue
          for (let s = 0; s < POOL; s += 1) {
            if (keys[s] === -1) {
              keys[s] = k
              fillChunkGeometry(chunkGeos[s], ccx + dx, ccz + dz)
              chunkGeos[s].userData.holes = null
              chunkGeos[s].userData.mergeNeeded = true
              break
            }
          }
        }
      }
      near.set(
        GRID.originX + (ccx - 1) * MOUNTAIN.chunk,
        GRID.originZ + (ccz - 1) * MOUNTAIN.chunk,
        GRID.originX + (ccx + 2) * MOUNTAIN.chunk,
        GRID.originZ + (ccz + 2) * MOUNTAIN.chunk,
      )
    }

    // --- Dug ground: build volume chunks, then merge and cut holes ------------
    _win[0] = ccx - 1
    _win[1] = ccz - 1
    _win[2] = ccx + 1
    _win[3] = ccz + 1
    const q = useQuality.getState()
    updateVolumes(localPlayer.x, localPlayer.z, _win, q.settings.digView, VOLUME_BUDGET[q.preset])
    const readyVersion = getReadyVersion()
    const keys = slotKeys.current
    for (let s = 0; s < POOL; s += 1) {
      const k = keys[s]
      if (k < 0) continue
      const kx = k % CHUNKS
      const kz = Math.floor(k / CHUNKS)
      const geo = chunkGeos[s]
      if (t.ready !== readyVersion || geo.userData.holes === null) {
        setChunkHoles(geo, kx, kz, isColumnReady, VCOL)
      }
      if (takeStale(k) || geo.userData.mergeNeeded || t.ready !== readyVersion) {
        geo.userData.mergeNeeded = false
        const merged = mergeChunk(volGeos.current[s], kx, kz)
        volGeos.current[s] = merged
        const mesh = volRefs.current[s]
        if (mesh && mesh.geometry !== merged) mesh.geometry = merged
      }
    }
    t.ready = readyVersion

    for (let s = 0; s < POOL; s += 1) {
      const m = nearRefs.current[s]
      if (m) m.visible = keys[s] >= 0
      const v = volRefs.current[s]
      if (v) v.visible = keys[s] >= 0 && (volGeos.current[s]?.userData.count ?? 0) > 0
    }
  })

  return (
    <>
      <mesh geometry={farGeo} material={farMat} receiveShadow={shadows} />
      {chunkGeos.map((geo, s) => (
        <mesh
          key={s}
          ref={(m) => {
            nearRefs.current[s] = m
          }}
          geometry={geo}
          material={nearMat}
          receiveShadow={shadows}
          visible={false}
        />
      ))}
      {chunkGeos.map((_, s) => (
        <mesh
          key={`v${s}`}
          ref={(m) => {
            volRefs.current[s] = m
            if (m && volGeos.current[s]) m.geometry = volGeos.current[s]
          }}
          material={caveMat}
          receiveShadow={shadows}
          castShadow={shadows}
          frustumCulled={false}
          visible={false}
        />
      ))}
    </>
  )
}
