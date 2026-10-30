import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box3, MeshStandardMaterial, Vector3 } from 'three'

const _shoulder = new Vector3()

/** False when the avatar or any parent is hidden (another player culled by distance). */
function visibleInTree(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false
  return true
}
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

import {
  assetUrls,
  baseBodyUrl,
  isRealId,
  PART_SLOTS,
  skinCompositeUrl,
  skinIdOrDefault,
} from '../../bloxity/avatarAssets'
import { loadOBJ, loadPartGLB, loadTexture } from '../../bloxity/avatarLoader'
import { DEFAULT_PROPORTIONS } from '../../bloxity/store'
import {
  animateRig,
  applyEmote,
  applyPart,
  applyProportions,
  applySkin,
  attachAccessory,
  collectRig,
  disposeMergedBody,
  mergeBody,
  prepareMuscleParts,
} from './avatarRig'

/**
 * A Bloxity avatar, assembled at runtime from the base rig plus equipped parts.
 *
 * `player.glb` is the base humanoid rig: six skinned meshes (head, torso, two arms,
 * two legs) sharing one skeleton. Assembly means, per equipped slot:
 *   - body parts  -> swap the matching mesh's geometry
 *   - hat / back  -> attach an OBJ to the Neck1 / Spine2 bone
 *   - skin        -> set one texture as the map on every skinned mesh
 *
 * Used for both the local player (equipped from the SDK) and remote players
 * (equipped from the server state), so it takes the payload as props.
 *
 * @param {{ equipped: object|null, proportions?: object, motionRef: React.RefObject,
 *           onReady?: () => void, targetHeight?: number, castShadow?: boolean }} props
 */
/** Beyond this distance (m) from the camera, an avatar animates at a third of the rate. */
const FAR_ANIM = 30
const _far = new Vector3()

export default function BloxityAvatar({
  equipped,
  proportions = DEFAULT_PROPORTIONS,
  motionRef,
  onReady,
  targetHeight = 1.8,
  castShadow = false,
  rootRef,
  shoulderRef,
}) {
  const { scene: baseScene } = useGLTF(baseBodyUrl())
  const [assembled, setAssembled] = useState(false)

  // The GLTF cache hands back one shared scene. Clone via SkeletonUtils so this
  // instance gets an independent, still-working skeleton.
  const character = useMemo(() => cloneSkeleton(baseScene), [baseScene])

  const rig = useMemo(() => {
    const collected = collectRig(character)
    for (const mesh of collected.skinnedMeshes) {
      mesh.material = new MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 1 })
    }
    return collected
  }, [character])

  useEffect(() => {
    for (const mesh of rig.skinnedMeshes) mesh.castShadow = castShadow
    if (rig.body) rig.body.castShadow = castShadow
  }, [rig, castShadow])

  // Build the muscle body's parts in idle time while the cosmetics download.
  useEffect(() => prepareMuscleParts(rig), [rig])
  const castShadowRef = useRef(castShadow)
  useEffect(() => {
    castShadowRef.current = castShadow
  }, [castShadow])

  // Dispose per-instance materials and the merged body on unmount.
  useEffect(
    () => () => {
      disposeMergedBody(rig, rig.body)
      for (const mesh of rig.skinnedMeshes) mesh.material?.dispose()
    },
    [rig],
  )

  // Measured once, from the bind pose, before proportions touch the root scale.
  const fit = useMemo(() => {
    const box = new Box3().setFromObject(character)
    const size = box.getSize(new Vector3())
    if (!Number.isFinite(size.y) || size.y <= 0) return { scale: 1, footOffset: 0 }
    const scale = targetHeight / size.y
    return { scale, footOffset: -box.min.y * scale }
  }, [character, targetHeight])

  // --- Assemble equipped cosmetics --------------------------------------------
  useEffect(() => {
    let cancelled = false
    const attached = []
    const jobs = []

    // Skin always loads - "0" is the fallback, since the base body has no baked map.
    const compositeUrl = skinCompositeUrl(equipped)
    const plainSkinUrl = assetUrls.skinTexture(skinIdOrDefault(equipped?.skinId))
    jobs.push(
      (compositeUrl ? loadTexture(compositeUrl) : Promise.resolve(null))
        .then((texture) => texture || loadTexture(plainSkinUrl))
        .then((texture) => ({ kind: 'skin', texture })),
    )

    for (const [slot, cfg] of Object.entries(PART_SLOTS)) {
      const id = equipped?.[cfg.idKey]
      if (!isRealId(id)) {
        jobs.push(Promise.resolve({ kind: 'part', slot, scene: null }))
        continue
      }
      jobs.push(loadPartGLB(assetUrls.part(slot, id)).then((scene) => ({ kind: 'part', slot, scene })))
    }

    for (const [kind, idKey, meshUrl, texUrl] of [
      ['hat', 'hatId', assetUrls.hatMesh, assetUrls.hatTexture],
      ['back', 'backId', assetUrls.backMesh, assetUrls.backTexture],
    ]) {
      const id = equipped?.[idKey]
      if (!isRealId(id)) continue
      jobs.push(
        Promise.all([loadOBJ(meshUrl(id)), loadTexture(texUrl(id))]).then(([object, texture]) => ({
          kind: 'accessory',
          accessory: kind,
          object,
          texture,
        })),
      )
    }

    Promise.all(jobs)
      .then((results) => {
        if (cancelled) return
        for (const result of results) {
          // One bad slot must not take the rest of the character down.
          try {
            if (result.kind === 'skin') applySkin(rig, result.texture)
            else if (result.kind === 'part') applyPart(rig, result.slot, result.scene)
            else if (result.kind === 'accessory' && result.object) {
              if (result.texture) {
                result.object.traverse((child) => {
                  if (child.isMesh) child.material = new MeshStandardMaterial({ map: result.texture })
                })
              }
              const added = attachAccessory(rig, result.accessory, result.object)
              if (added) attached.push(added)
            }
          } catch (err) {
            console.warn(`[bloxity] failed to apply ${result.kind}`, err)
          }
        }
        // The miner's muscle body, as one draw call.
        try {
          disposeMergedBody(rig, rig.body)
          mergeBody(rig, castShadowRef.current)
        } catch (err) {
          console.warn('[avatar] could not build the muscle body; drawing the plain parts', err)
          disposeMergedBody(rig, rig.body)
        }
        setAssembled(true)
      })
      .catch((err) => {
        console.warn('[bloxity] avatar assembly failed; showing base body', err)
        if (!cancelled) setAssembled(true)
      })

    return () => {
      cancelled = true
      for (const object of attached) {
        object.parent?.remove(object)
        object.traverse((child) => {
          child.geometry?.dispose()
          child.material?.dispose?.()
        })
      }
    }
  }, [rig, equipped])

  const proportionsRef = useRef(proportions)
  useEffect(() => {
    proportionsRef.current = proportions
  }, [proportions])

  const frame = useRef(0)
  useFrame(({ camera }) => {
    // A culled player costs nothing: no bone work while nobody can see them.
    if (rootRef?.current && !visibleInTree(rootRef.current)) return
    // Far away, a pose every third frame is plenty: you can't tell at that distance.
    if (rootRef?.current) {
      rootRef.current.getWorldPosition(_far)
      if (_far.distanceToSquared(camera.position) > FAR_ANIM * FAR_ANIM && frame.current++ % 3 !== 0) return
    }
    try {
      // Order matters: proportions reset every bone to its rest pose, and the
      // animation then rotates on top of that clean base.
      applyProportions(rig, proportionsRef.current)
      const m = motionRef.current
      animateRig(rig, m)
      if (m?.emoteClip) applyEmote(rig, m.emoteClip, m.emoteTime, m.emoteWeight)
      // Tell the held tool where the right shoulder really is: the muscle body moves
      // it out and up, and the tool must stay in the fist.
      const arm = rig.bones.ArmR1?.bone
      if (arm && rootRef?.current && shoulderRef) {
        arm.getWorldPosition(_shoulder)
        rootRef.current.worldToLocal(_shoulder)
        shoulderRef.current.copy(_shoulder)
        shoulderRef.current.live = true
      }
    } catch {
      // A malformed payload must not kill the render loop.
    }
  })

  useEffect(() => {
    if (assembled) onReady?.()
  }, [assembled, onReady])

  return (
    <group scale={fit.scale} position={[0, fit.footOffset, 0]}>
      <primitive object={character} />
    </group>
  )
}

useGLTF.preload(baseBodyUrl())
