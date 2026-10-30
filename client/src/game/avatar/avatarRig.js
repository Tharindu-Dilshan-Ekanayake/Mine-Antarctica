import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  MeshLambertMaterial,
  NearestFilter,
  Quaternion,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { BACK_BONE, HAT_BONE, NECK_OFFSET_BONE, PART_SLOTS } from '../../bloxity/avatarAssets'
import { BODY_OFFSETS, buildMusclePart, MUSCLE_SLOTS } from './muscleBody'

/**
 * How built every miner is, 0 (skinny) .. 1 (full bodybuilder): a mid-level
 * bodybuilder - broad chest, big arms, solid legs, not a cartoon giant.
 */
export const MINER_BULK = 0.62

/**
 * Rig manipulation for the base `player.glb` character.
 *
 * The rig's real structure (confirmed by reading player.glb directly):
 *   character
 *     - default_arm_L / default_arm_R / default_head
 *     - default_leg_L / default_leg_R / default_torso   (6 SkinnedMeshes, 1 skeleton)
 *     - Rig1
 *         - Spine1 > Spine2 > { ArmL_Offset > ArmL1 > ArmL2,
 *                               ArmR_Offset > ArmR1 > ArmR2,
 *                               Neck_Offset > Neck1 }
 *         - LegL_Offset > LegL1 > LegL2, LegR_Offset > LegR1 > LegR2
 *
 * Two consequences drive everything below:
 *  1. Body parts are NOT attached to bones. Each is a separate SkinnedMesh sharing one
 *     skeleton, so equipping a part means swapping that mesh's geometry (remapping
 *     skin indices into the base skeleton's bone order first).
 *  2. Accessories DO attach to bones: hats to `Neck1`, back items to `Spine2`.
 *
 * player.glb ships no animation clips, so the character is posed, not animated.
 */

/**
 * Walks the loaded rig and collects everything later operations need.
 *
 * @param {import('three').Object3D} root
 */
export function collectRig(root) {
  const rig = {
    root,
    skeleton: null,
    /** slot -> SkinnedMesh */
    partMeshes: {},
    /** slot -> the pristine geometry to restore on unequip */
    originalGeometries: {},
    /** bone name -> { bone, origPos, origQuat, origScale } */
    bones: {},
    hatBone: null,
    backBone: null,
    neckOffsetBindY: 0,
    skinnedMeshes: [],
    /** Rest Y of the character root, so the run-cycle bob can return to it. */
    rootRestY: root.position.y,
  }

  const meshBySlot = new Map(
    Object.entries(PART_SLOTS).map(([slot, cfg]) => [cfg.mesh.toLowerCase(), slot]),
  )

  root.traverse((node) => {
    if (node.isSkinnedMesh) {
      node.castShadow = true
      node.receiveShadow = true
      rig.skinnedMeshes.push(node)
      if (!rig.skeleton) rig.skeleton = node.skeleton

      const slot = meshBySlot.get((node.name || '').toLowerCase())
      if (slot) {
        rig.partMeshes[slot] = node
        rig.originalGeometries[slot] = node.geometry.clone()
      }
    } else if (node.isMesh) {
      node.castShadow = true
      node.receiveShadow = true
    }
  })

  const skeleton = rig.skeleton
  if (skeleton) {
    for (const bone of skeleton.bones) {
      // Proportions are re-applied every frame from these rest values.
      bone.matrixAutoUpdate = true
      rig.bones[bone.name] = {
        bone,
        origPos: bone.position.clone(),
        origQuat: bone.quaternion.clone(),
        origScale: bone.scale.clone(),
      }
    }

    // Bone local axes are NOT world-aligned in this rig: a limb bone's local X
    // points along world -Z and its local Z along world -X, so rotating a leg about
    // its local X swings it sideways instead of forward/back. The offsets differ per
    // bone (Spine1 is identity, ArmL2 is off by ~14 degrees), so rather than hardcode
    // an axis, record for each bone the local-space axis matching each character-space
    // axis and animate about those.
    root.updateMatrixWorld(true)
    const rootQuat = new Quaternion()
    root.getWorldQuaternion(rootQuat)
    const rootQuatInv = rootQuat.invert()
    const boneWorld = new Quaternion()

    for (const bone of skeleton.bones) {
      const entry = rig.bones[bone.name]
      if (!entry) continue
      bone.getWorldQuaternion(boneWorld)
      // Bone orientation relative to the character, then inverted: this maps a
      // character-space axis into the bone's own local frame.
      const relInv = rootQuatInv.clone().multiply(boneWorld).invert()
      /** Local axis to rotate about for forward/back swing. */
      entry.axisX = new Vector3(1, 0, 0).applyQuaternion(relInv).normalize()
      /** Local axis to rotate about for lateral sway. */
      entry.axisZ = new Vector3(0, 0, 1).applyQuaternion(relInv).normalize()
    }

    rig.hatBone = skeleton.bones.find((b) => b.name === HAT_BONE) || null
    rig.backBone = skeleton.bones.find((b) => b.name === BACK_BONE) || null

    const neckIndex = skeleton.bones.findIndex((b) => b.name === NECK_OFFSET_BONE)
    if (neckIndex >= 0) {
      // elements[13] is the Y translation of the inverted bind matrix.
      rig.neckOffsetBindY = skeleton.boneInverses[neckIndex].clone().invert().elements[13]
    }
  }

  return rig
}

/**
 * Bloxity textures are authored unflipped and pixel-art filtered.
 *
 * They are also sRGB images. A plain TextureLoader leaves them tagged as linear, which
 * makes three skip the sRGB decode and the avatar renders pale and washed out.
 */
export function configureAvatarTexture(texture) {
  if (!texture) return texture
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}

/**
 * Applies the skin texture to every skinned mesh of the base body.
 * The base body ships with an empty texture, so this always runs - with skin "0"
 * standing in when nothing is equipped.
 */
export function applySkin(rig, texture) {
  if (!texture) return
  for (const mesh of rig.skinnedMeshes) {
    if (!mesh.material) continue
    mesh.material.map = texture
    mesh.material.needsUpdate = true
  }
}

/**
 * Swaps a body part's geometry onto its base skinned mesh.
 *
 * A part GLB carries its own skeleton whose bone *order* may differ from the base
 * rig's. Its `skinIndex` attribute therefore has to be remapped by bone name, or the
 * limb deforms against the wrong bones.
 *
 * @param {object} rig from `collectRig`
 * @param {string} slot key of PART_SLOTS
 * @param {import('three').Object3D|null} partScene loaded GLB scene, or null to reset
 */
export function applyPart(rig, slot, partScene) {
  const targetMesh = rig.partMeshes[slot]
  if (!targetMesh) return

  // Unequipped / failed download: restore the part baked into player.glb.
  if (!partScene) {
    const original = rig.originalGeometries[slot]
    if (original && targetMesh.geometry !== original) targetMesh.geometry = original
    return
  }

  let skinnedSource = null
  let plainSource = null
  partScene.traverse((node) => {
    if (node.isSkinnedMesh && !skinnedSource) skinnedSource = node
    else if (node.isMesh && !plainSource) plainSource = node
  })

  if (!skinnedSource) {
    // Some parts ship as plain meshes; use them as-is.
    if (plainSource) targetMesh.geometry = plainSource.geometry
    return
  }

  const baseSkeleton = rig.skeleton
  if (!baseSkeleton || !skinnedSource.skeleton) {
    targetMesh.geometry = skinnedSource.geometry
    return
  }

  const geometry = skinnedSource.geometry.clone()

  const baseIndexByName = new Map()
  baseSkeleton.bones.forEach((bone, i) => baseIndexByName.set(bone.name, i))

  const remap = new Map()
  skinnedSource.skeleton.bones.forEach((bone, i) => {
    const baseIndex = baseIndexByName.get(bone.name)
    if (baseIndex !== undefined) remap.set(i, baseIndex)
  })

  const skinIndex = geometry.getAttribute('skinIndex')
  if (skinIndex) {
    const array = skinIndex.array
    for (let i = 0; i < array.length; i += 1) {
      const mapped = remap.get(array[i])
      if (mapped !== undefined) array[i] = mapped
    }
    skinIndex.needsUpdate = true
  }

  targetMesh.geometry = geometry
}

/**
 * Attaches a hat or back accessory to its bone.
 * Offsets are the SDK's own: hats sit at y=0.8 on `Neck1`, back items at the origin
 * of `Spine2`.
 */
export function attachAccessory(rig, kind, object) {
  const bone = kind === 'hat' ? rig.hatBone : rig.backBone
  if (!object || !bone) return null

  object.scale.setScalar(1)
  object.position.set(0, kind === 'hat' ? 0.8 : 0, 0)
  object.traverse((child) => {
    if (child.isMesh) child.castShadow = true
  })

  bone.add(object)
  return object
}

/** What the merged body keeps of each part, and each attribute's size. */
const BODY_ATTRIBUTES = [
  ['position', 3],
  ['normal', 3],
  ['uv', 2],
  ['skinIndex', 4],
  ['skinWeight', 4],
]

/**
 * A part's geometry as plain, non-indexed float attributes: parts come from different
 * GLBs (indexed or not, 8- or 16-bit skin indices), and only matching layouts merge.
 */
function plainGeometry(source) {
  const g = source.index ? source.toNonIndexed() : source.clone()
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const count = g.getAttribute('position').count
  const out = new BufferGeometry()
  for (const [name, size] of BODY_ATTRIBUTES) {
    const attr = g.getAttribute(name)
    const array = new Float32Array(count * size)
    if (attr) {
      for (let i = 0; i < count; i += 1) {
        for (let k = 0; k < size; k += 1) array[i * size + k] = attr.getComponent(i, k)
      }
    } else if (name === 'skinWeight') {
      // An unskinned part follows its first bone fully.
      for (let i = 0; i < count; i += 1) array[i * 4] = 1
    }
    out.setAttribute(name, new BufferAttribute(array, size))
  }
  g.dispose()
  return out
}

/** Skin index of a rig's bone, by name. */
const boneIndexer = (rig) => (name) => rig.skeleton.bones.findIndex((b) => b.name === name)

/**
 * Builds the rounded muscle parts ahead of mergeBody, one part per idle moment, so the
 * first avatar never lands as one long stall (parts are shared: later avatars find
 * them built). Returns a cancel.
 */
export function prepareMuscleParts(rig) {
  const slots = rig.skeleton ? MUSCLE_SLOTS.filter((slot) => rig.originalGeometries[slot]) : []
  const later = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 0))
  let handle = null
  let done = false
  const next = () => {
    const slot = slots.shift()
    if (!slot || done) return
    buildMusclePart(slot, rig.originalGeometries[slot], boneIndexer(rig))
    handle = later(next)
  }
  handle = later(next)
  return () => {
    done = true
    if (window.cancelIdleCallback) window.cancelIdleCallback(handle)
    clearTimeout(handle)
  }
}

/**
 * A part's piece of the merged body: the rounded muscle part for the torso, arms and
 * legs (built from the part's original box, so clothes map as before), and the part's
 * own geometry otherwise (the head), with nothing to morph.
 */
function bodyPiece(rig, mesh) {
  const slot = MUSCLE_SLOTS.find((s) => rig.partMeshes[s] === mesh)
  const source = slot ? rig.originalGeometries[slot] : null
  if (source) return buildMusclePart(slot, source, boneIndexer(rig)).clone()
  const piece = plainGeometry(mesh.geometry)
  const count = piece.getAttribute('position').count
  piece.morphAttributes.position = [new BufferAttribute(new Float32Array(count * 3), 3)]
  piece.morphAttributes.normal = [new BufferAttribute(new Float32Array(count * 3), 3)]
  piece.morphTargetsRelative = true
  return piece
}

/**
 * Merges the six body parts into one muscled, skinned mesh on the same skeleton: one
 * draw call per character instead of six. The parts stay (hidden) as the source for
 * the next re-assembly. Call after the skin is applied; returns the body, or null.
 */
export function mergeBody(rig, castShadow = false) {
  const parts = rig.skinnedMeshes
  if (!rig.skeleton || parts.length === 0) return null
  const pieces = parts.map((mesh) => bodyPiece(rig, mesh))
  const geometry = mergeGeometries(pieces, false)
  for (const piece of pieces) piece.dispose()
  if (!geometry) return null
  // The pieces' morphs are offsets; mergeGeometries keeps them but not that flag.
  geometry.morphTargetsRelative = true
  const body = new SkinnedMesh(geometry, new MeshLambertMaterial({ map: parts[0].material?.map ?? null }))
  body.name = 'merged_body'
  body.castShadow = castShadow
  body.receiveShadow = true
  // Skinned bounds don't follow the pose; the avatar is always near the camera anyway.
  body.frustumCulled = false
  parts[0].parent.add(body)
  body.bind(rig.skeleton, parts[0].bindMatrix)
  for (const mesh of parts) mesh.visible = false
  rig.body = body
  return body
}

/** Removes and frees a body made by mergeBody, showing the plain parts again. */
export function disposeMergedBody(rig, body) {
  if (!body) return
  body.parent?.remove(body)
  body.geometry.dispose()
  body.material.dispose()
  if (rig.body === body) rig.body = null
  for (const mesh of rig.skinnedMeshes) mesh.visible = true
}

/**
 * Applies Bloxity body proportions.
 *
 * Must run every frame: each bone is reset to its rest transform before the
 * multipliers are re-applied, which is what makes the result idempotent and lets
 * proportion changes take effect live.
 *
 * `height`, `armLength`, `headScale` and `neckHeight` are applied exactly as the
 * Bloxity portal does, so the in-game body matches the preview. The remaining three
 * (`shoulderWidth`, `torsoScaleX`, `legOffsetX`) are not implemented in the SDK's
 * preview renderer; they are applied here in the spirit of their names and are the
 * ones to sanity-check against the portal.
 */
export function applyProportions(rig, proportions, bulk = MINER_BULK) {
  const skeleton = rig.skeleton
  if (!skeleton || !proportions) return

  // The muscle body (see muscleBody): its morph, the arms and legs moved out so they
  // stay at the sides of the broader body, and a little extra height.
  const built = Math.min(1, Math.max(0, bulk))
  const { shoulder, hip, tall } = BODY_OFFSETS
  const shoulderOut = rig.body ? shoulder[0] + (shoulder[1] - shoulder[0]) * built : 0
  const hipOut = rig.body ? hip[0] + (hip[1] - hip[0]) * built : 0
  if (rig.body?.morphTargetInfluences) rig.body.morphTargetInfluences[0] = built

  const height = (proportions.height ?? 1) * (rig.body ? tall[0] + (tall[1] - tall[0]) * built : 1)
  const armLength = proportions.armLength ?? 1
  const headScale = proportions.headScale ?? 1
  const neckHeight = proportions.neckHeight ?? 1
  const shoulderWidth = proportions.shoulderWidth ?? 1
  const torsoScaleX = proportions.torsoScaleX ?? 1
  const legOffsetX = proportions.legOffsetX ?? 1

  // Overall height is a scale on the character root, not on a bone.
  rig.root.scale.set(1, height, 1)

  for (const bone of skeleton.bones) {
    const rest = rig.bones[bone.name]
    if (!rest) continue

    const { origScale, origPos, origQuat } = rest
    bone.position.copy(origPos)
    bone.quaternion.copy(origQuat)
    bone.scale.copy(origScale)

    const name = bone.name

    if (name.startsWith('Arm')) {
      bone.scale.y = origScale.y * armLength
      // Not in the SDK preview: widen the shoulders by pushing the arm roots out.
      if (name === 'ArmL_Offset' || name === 'ArmR_Offset') {
        bone.position.x = origPos.x * shoulderWidth + Math.sign(origPos.x) * shoulderOut
      }
    } else if (name === NECK_OFFSET_BONE) {
      // Keeps the head sitting on the neck as height/headScale change, then applies
      // neckHeight against the bind-pose offset.
      bone.position.y += (height - headScale) * origPos.y
      bone.position.y += rig.neckOffsetBindY * (neckHeight - 1) * 0.8
    } else if (name === HAT_BONE) {
      // Divided by height so the head stays uniform inside the stretched root.
      bone.scale.set(
        origScale.x * headScale,
        origScale.y * (headScale / height),
        origScale.z * headScale,
      )
    } else if (name === BACK_BONE) {
      // Not in the SDK preview: torso width.
      bone.scale.x = origScale.x * torsoScaleX
    } else if (name === 'LegL_Offset' || name === 'LegR_Offset') {
      // Not in the SDK preview: leg splay, mirrored about the rig centre.
      bone.position.x = origPos.x * legOffsetX + Math.sign(origPos.x) * hipOut
    }
  }
}

/* ---------------------------------------------------------------------------
 * Procedural animation
 *
 * player.glb ships zero animation clips, so a walk/run/jump cycle has to be
 * driven directly on the bones. Rotations are *multiplied onto* whatever
 * applyProportions() just wrote, so this must run immediately after it in the
 * same frame - proportions reset each bone to its rest pose, which is exactly
 * the clean base a pose needs.
 * ------------------------------------------------------------------------- */

const _animQ = new Quaternion()

/**
 * Rotates a bone about one of its precomputed character-space axes.
 * `which` is 'axisX' (forward/back swing) or 'axisZ' (lateral sway).
 */
function rotateBone(rig, name, which, angle) {
  if (!angle) return
  const entry = rig.bones[name]
  const axis = entry?.[which]
  if (!axis) return
  entry.bone.quaternion.multiply(_animQ.setFromAxisAngle(axis, angle))
}

/** Swing a limb forward/back - the plane a walk cycle actually moves in. */
const swing = (rig, name, angle) => rotateBone(rig, name, 'axisX', angle)
/** Sway a limb out to the side. */
const sway = (rig, name, angle) => rotateBone(rig, name, 'axisZ', angle)

/**
 * Right-arm angle for a pickaxe swing at progress `t` (0..1): wind up overhead,
 * then chop down in front. Negative = arm forward/up. Shared with the held tool so
 * the pickaxe follows the hand.
 */
export function swingAngle(t) {
  if (t < 0) return 0
  if (t < 0.35) return -2.7 * (t / 0.35)
  const k = (t - 0.35) / 0.65
  return -2.7 + 2.2 * (1 - (1 - k) * (1 - k))
}

/** Arm pose while just holding the tool (not swinging). */
export const HOLD_ANGLE = -0.55

/**
 * The tool arm's angle for a motion state: holding, or swinging toward where the
 * player aimed. `aimPitch` (+ up) tilts the chop so it lands on a ceiling, straight
 * ahead into a wall, or down at your feet.
 */
export function toolArmAngle(m) {
  if (!m || m.swing < 0) return HOLD_ANGLE
  const t = m.swing
  const k = t < 0.35 ? (t / 0.35) * 0.3 : 1
  return Math.min(-0.05, swingAngle(t) - (m.aimPitch ?? 0) * 0.75 * k)
}

/**
 * Poses the rig for the current motion state.
 *
 * @param {object} rig from `collectRig`
 * @param {{ time: number, speed: number, grounded: boolean, maxSpeed: number,
 *           swing?: number, holding?: boolean }} motion
 *   `speed` is horizontal speed in world units/sec; `maxSpeed` is what counts as a
 *   full-amplitude run. `swing` is pickaxe swing progress 0..1 (or -1); while
 *   `holding`, the right arm carries the tool instead of joining the walk cycle.
 */
export function animateRig(rig, motion) {
  if (!rig?.skeleton || !motion) return

  const { time = 0, speed = 0, grounded = true, maxSpeed = 6, swing: swingT = -1, holding = true } = motion
  const ratio = Math.min(speed / Math.max(maxSpeed, 0.001), 1)

  rig.root.position.y = rig.rootRestY

  const toolArm = swingT >= 0 || holding ? toolArmAngle(motion) : null
  animateBody(rig, time, ratio, grounded, toolArm !== null)
  if (toolArm !== null) swing(rig, 'ArmR1', toolArm)
}

function animateBody(rig, time, ratio, grounded, toolArm) {
  // --- Airborne: tuck the legs, throw the arms up ---------------------------
  if (!grounded) {
    swing(rig, 'LegL1', -0.55)
    swing(rig, 'LegL2', 0.75)
    swing(rig, 'LegR1', 0.3)
    swing(rig, 'LegR2', 0.2)
    swing(rig, 'ArmL1', -2.1)
    if (!toolArm) swing(rig, 'ArmR1', -2.1)
    swing(rig, 'Spine1', -0.1)
    return
  }

  // --- Standing still: a slow breathing sway --------------------------------
  if (ratio < 0.04) {
    const idle = Math.sin(time * 1.6)
    sway(rig, 'ArmL1', -0.07 - idle * 0.03)
    if (!toolArm) sway(rig, 'ArmR1', 0.07 + idle * 0.03)
    swing(rig, 'Spine1', idle * 0.02)
    rig.root.position.y = rig.rootRestY + idle * 0.03
    return
  }

  // --- Walk / run cycle -----------------------------------------------------
  // Step frequency rises with speed so a sprint doesn't look like a moonwalk.
  const phase = time * (5 + ratio * 5)
  const cycle = Math.sin(phase)
  const legAmp = 0.85 * ratio
  const armAmp = 0.7 * ratio

  // Legs swing in opposition; knees fold on the backswing only.
  swing(rig, 'LegL1', cycle * legAmp)
  swing(rig, 'LegR1', -cycle * legAmp)
  swing(rig, 'LegL2', Math.max(0, -cycle) * 1.1 * ratio)
  swing(rig, 'LegR2', Math.max(0, cycle) * 1.1 * ratio)

  // Arms counter-swing against the legs.
  swing(rig, 'ArmL1', -cycle * armAmp)
  swing(rig, 'ArmL2', Math.max(0, cycle) * 0.5 * ratio)
  if (!toolArm) {
    swing(rig, 'ArmR1', cycle * armAmp)
    swing(rig, 'ArmR2', Math.max(0, -cycle) * 0.5 * ratio)
  }

  // Lean into the run, and bob once per step (twice per full cycle).
  swing(rig, 'Spine1', -0.14 * ratio)
  rig.root.position.y = rig.rootRestY + Math.abs(Math.cos(phase)) * 0.18 * ratio
}

// --- Boxity emotes ----------------------------------------------------------------------

const DEG = Math.PI / 180
const _emoteQ = new Quaternion()
const _emoteDelta = new Quaternion()
const _emoteEuler = new Euler()
const _sample = [0, 0, 0]

/**
 * A track's angles at `t` into `out`: smoothstep between keys, held outside them.
 * Returns false for an empty track.
 */
function sampleTrack(keys, t, out) {
  if (!keys?.length) return false
  let a = keys[0]
  let b = a
  if (t >= keys[keys.length - 1][0]) a = b = keys[keys.length - 1]
  else if (t > keys[0][0]) {
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (t >= keys[i][0] && t <= keys[i + 1][0]) {
        a = keys[i]
        b = keys[i + 1]
        break
      }
    }
  }
  let s = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0
  s = s * s * (3 - 2 * s)
  for (let j = 0; j < 3; j += 1) out[j] = a[j + 1] + (b[j + 1] - a[j + 1]) * s
  return true
}

/**
 * Plays Boxity emote `clip` (`{ len, loop, trackList: [[bone, keys]] }`) on the rig at
 * `time` seconds in, blended over the pose by `weight` (0-1). Each key is a delta in
 * degrees over the bone's bind pose (euler XYZ, multiplied on the right); a bone the rig
 * doesn't have is skipped. Run after animateRig.
 */
export function applyEmote(rig, clip, time, weight) {
  if (!clip || !(weight > 0) || !rig?.skeleton) return
  const t = clip.loop && clip.len > 0 ? time % clip.len : Math.min(time, clip.len || time)
  for (const [name, keys] of clip.trackList) {
    const rest = rig.bones[name]
    if (!rest || !sampleTrack(keys, t, _sample)) continue
    _emoteDelta.setFromEuler(_emoteEuler.set(_sample[0] * DEG, _sample[1] * DEG, _sample[2] * DEG, 'XYZ'))
    _emoteQ.copy(rest.origQuat).multiply(_emoteDelta)
    rest.bone.quaternion.slerp(_emoteQ, Math.min(1, weight))
  }
}
