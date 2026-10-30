import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { DoubleSide, MeshLambertMaterial, Vector3, Vector4 } from 'three'

import { GRID, MOUNTAIN, MOUNTAIN_FOOT } from '@shared/world.js'
import { plainHole } from '../lobby/Lobby'
import { useQuality } from '../../store/quality'
import { localPlayer } from '../localPlayer'
import { VCOL } from '../terrain/digStore'
import { CHUNKS, getGeneration } from '../terrain/heightGrid'
import { addWorldPos, makeDetailTexture, makeRockTexture } from '../world/materials'
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
 * Dug ground, painted like real rock. Deep in the mountain the walls are dark earthy
 * brown - clay and umber lumps, grey stone, damp olive moss low down, thin sandy veins -
 * all with a rough, bumpy, cracked surface that catches the light; near the surface and
 * higher up they are frosted grey-white. Lit by a headlamp you carry, fading to
 * darkness in the distance, so near and far and one wall from the next are easy to tell
 * apart. All in the shader: a tileable rock texture read from three directions
 * (triplanar, so nothing stretches) gives the colour variation AND the relief.
 */
function makeCaveMaterial(detail, rock) {
  const mat = new MeshLambertMaterial({ vertexColors: true, map: detail, side: DoubleSide })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTorch = caveTorch
    shader.uniforms.uRock = { value: rock }
    addWorldPos(shader)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aDepth;
varying float vDepth;
varying vec3 vWNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vDepth = aDepth;
  vWNormal = normalize(mat3(modelMatrix) * objectNormal);`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uTorch;
uniform sampler2D uRock;
varying float vDepth;
varying vec3 vWNormal;
// The rock texture from three directions, blended by which way the wall faces.
vec3 rockTri(vec3 p, vec3 w, float s) {
  p *= s;
  return texture2D(uRock, p.zy).rgb * w.x + texture2D(uRock, p.xz).rgb * w.y + texture2D(uRock, p.xy).rgb * w.z;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec3 triW = abs(vWNormal);
  triW /= (triW.x + triW.y + triW.z + 1e-4);
  vec3 rkA = rockTri(vWPos, triW, 0.10);   // big lumps, patches, moss
  vec3 rkB = rockTri(vWPos, triW, 0.42);   // medium rock, veins
  vec3 rkC = rockTri(vWPos, triW, 1.7);    // fine grain
  // Relief from the medium and fine scales only (the big, gentle scale would show as
  // stair-steps: its changes are smaller than the texture's 8-bit precision).
  float rockH = rkB.r * 0.8 + rkC.r * 0.2;
  // Earthy palette.
  vec3 umber = vec3(0.10, 0.068, 0.045);
  vec3 brown = vec3(0.30, 0.20, 0.125);
  vec3 clay  = vec3(0.50, 0.33, 0.20);
  vec3 olive = vec3(0.24, 0.27, 0.11);
  vec3 stone = vec3(0.27, 0.26, 0.26);
  vec3 sand  = vec3(0.76, 0.65, 0.43);
  vec3 earth = mix(umber, brown, smoothstep(0.25, 0.7, rkB.r));
  earth = mix(earth, clay, smoothstep(0.55, 0.85, rkA.r) * 0.7);
  // Grey stone patches, and damp olive moss on the lower levels of the mountain.
  earth = mix(earth, stone, smoothstep(0.58, 0.78, rkA.g) * 0.8);
  float moss = smoothstep(0.6, 0.78, rkA.b) * (0.4 + 0.6 * smoothstep(0.25, 0.8, rkB.r));
  moss *= 1.0 - smoothstep(70.0, 170.0, vWPos.y);
  earth = mix(earth, olive * (0.75 + rkC.r * 0.5), moss * 0.85);
  // Thin pale sandy veins, like the light strip running down a rock wall.
  // (Only in a few places - a vein everywhere reads as map contour lines.)
  float vein = (1.0 - smoothstep(0.008, 0.032, abs(rkB.g - 0.5))) * smoothstep(0.55, 0.7, rkA.g);
  earth = mix(earth, sand * (0.8 + rkC.g * 0.4), vein * 0.75);
  // Fine grain and dark cracks.
  earth *= 0.55 + 0.9 * rkC.r;
  earth *= 0.4 + 1.2 * smoothstep(0.15, 0.6, rkB.r);
  // Frost: near the surface and up high the walls are grey-white and patchy.
  float frost = (1.0 - smoothstep(1.0, 6.0, vDepth)) * smoothstep(0.3, 0.7, rkA.r * 0.6 + rkB.b * 0.5);
  frost *= 0.45 + 0.55 * smoothstep(-0.3, 0.7, vWNormal.y);
  frost = max(frost, 0.0);
  vec3 frostCol = mix(vec3(0.58, 0.64, 0.70), vec3(0.90, 0.93, 0.97), rkC.g);
  earth = mix(earth, frostCol, clamp(frost * 0.95, 0.0, 0.95));
  // Only below the thin layer of surface do the walls take this look.
  diffuseColor.rgb = mix(diffuseColor.rgb, earth, smoothstep(0.1, 0.9, vDepth));`)
      // Bumpy relief: the rock's height map tilts the lighting normal (derivative bump
      // mapping), so every wall looks rough instead of smooth.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec2 dH = vec2(dFdx(rockH), dFdy(rockH)) * 0.38;
    vec3 sX = dFdx(-vViewPosition);
    vec3 sY = dFdy(-vViewPosition);
    vec3 R1 = cross(sY, normal);
    vec3 R2 = cross(normal, sX);
    float det = dot(sX, R1);
    vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
    normal = normalize(abs(det) * normal - grad * smoothstep(0.1, 0.9, vDepth));
  }`)
      .replace('#include <opaque_fragment>', `
  // Headlamp: underground the light comes from where you stand. Walls near you are
  // bright, far ones dim, and walls turned towards you brighter than the ones turned
  // away - so you can tell at a glance what's close, what's far and where the tunnel goes.
  float caveAmt = smoothstep(0.1, 0.9, vDepth);
  vec3 toLamp = uTorch - vWPos;
  float dLamp = length(toLamp);
  vec3 nWorld = inverseTransformDirection(normal, viewMatrix);
  float facing = max(dot(nWorld, toLamp / max(dLamp, 0.001)), 0.0);
  float lamp = (0.25 + 0.75 * facing) / (1.0 + dLamp * dLamp * 0.018);
  vec3 lit = outgoingLight * (0.18 + 1.05 * lamp) + diffuseColor.rgb * vec3(1.0, 0.8, 0.55) * lamp * 0.55;
  outgoingLight = mix(outgoingLight, lit, caveAmt);
#include <opaque_fragment>`)
      .replace('#include <fog_fragment>', `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogAmount = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogAmount = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  // Underground the distance fades into darkness, not into the pale sky: far walls sink
  // back, near ones stand out.
  float caveDark = smoothstep(5.0, 30.0, vFogDepth) * smoothstep(0.1, 0.9, vDepth);
  vec3 fogTo = mix(fogColor, vec3(0.03, 0.022, 0.017), smoothstep(0.1, 0.9, vDepth));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTo, max(fogAmount, caveDark * 0.9));
#endif`)
  }
  mat.customProgramCacheKey = () => 'caveRock'
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
  const rockTex = useMemo(() => makeRockTexture(settings.texSize >= 1024 ? 256 : 128), [settings.texSize])
  const caveMat = useMemo(() => makeCaveMaterial(detail, rockTex), [detail, rockTex])
  useEffect(
    () => () => {
      caveMat.dispose()
      rockTex.dispose()
    },
    [caveMat, rockTex],
  )
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
