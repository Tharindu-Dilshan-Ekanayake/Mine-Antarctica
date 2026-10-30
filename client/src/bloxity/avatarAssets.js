/**
 * URL construction and slot metadata for Bloxity avatar assets.
 *
 * The shapes here are not guesses: they mirror the assembly logic inside
 * legion-sdk.min.js (the same code that renders the avatar preview in the Bloxity
 * portal), so an avatar built with this file matches what the player sees there.
 *
 * `avatar.getEquipped()` returns:
 *   { hatId, backId, skinId, headId, armLId, armRId, legLId, legRId, torsoId,
 *     hairId, maskId, neckId, chestId, waistId, handId, shoesId,
 *     pantsId, shirtId, faceId }
 */

import { avatarCdn, boxityEnv } from './env'

/**
 * The base humanoid body + skeleton. All other assets modify this. From the avatar CDN
 * of the environment Boxity told this page (see env.js) - never a fixed host.
 */
export const baseBodyUrl = () => `${avatarCdn()}/player.glb`

/** Bone that hats attach to, from player.glb's skeleton. */
export const HAT_BONE = 'Neck1'
/** Bone that back items attach to. */
export const BACK_BONE = 'Spine2'
/** Bone whose bind-pose Y drives the neckHeight proportion. */
export const NECK_OFFSET_BONE = 'Neck_Offset'

/** Skin id used when nothing is equipped — the base body has no baked-in texture. */
export const DEFAULT_SKIN_ID = '0'

/**
 * Body-part slots.
 *
 * Each maps an equipped id onto a named skinned mesh already present in player.glb.
 * A part is applied by swapping that mesh's *geometry*, not by attaching a new
 * object — that is what keeps it bound to the shared skeleton.
 */
export const PART_SLOTS = {
  head: { idKey: 'headId', mesh: 'default_head', dir: 'head', suffix: '' },
  arm_L: { idKey: 'armLId', mesh: 'default_arm_L', dir: 'arms', suffix: '_L' },
  arm_R: { idKey: 'armRId', mesh: 'default_arm_R', dir: 'arms', suffix: '_R' },
  leg_L: { idKey: 'legLId', mesh: 'default_leg_L', dir: 'legs', suffix: '_L' },
  leg_R: { idKey: 'legRId', mesh: 'default_leg_R', dir: 'legs', suffix: '_R' },
  torso: { idKey: 'torsoId', mesh: 'default_torso', dir: 'torso', suffix: '' },
}

/** Values that all mean "nothing equipped". Superset of the SDK's own check. */
const EMPTY_IDS = new Set(['-1', '', 'undefined', 'null'])

/**
 * @param {unknown} id
 * @returns {boolean} true when the id names a real asset worth fetching
 */
export function isRealId(id) {
  if (id === null || id === undefined) return false
  return !EMPTY_IDS.has(String(id).trim())
}

export const assetUrls = {
  part: (slot, id) => {
    const { dir, suffix } = PART_SLOTS[slot]
    return `${avatarCdn()}/parts/${dir}/${id}${suffix}.glb`
  },
  skinTexture: (id) => `${avatarCdn()}/skins/${id}.png`,
  hatMesh: (id) => `${avatarCdn()}/items/hats/${id}.obj`,
  hatTexture: (id) => `${avatarCdn()}/textures/hats/${id}.png`,
  backMesh: (id) => `${avatarCdn()}/items/back/${id}.obj`,
  backTexture: (id) => `${avatarCdn()}/textures/back/${id}.png`,
}

/** Skin ids fall back to "0" rather than being skipped. */
export const skinIdOrDefault = (id) => (isRealId(id) ? String(id) : DEFAULT_SKIN_ID)

/**
 * Clothing and face are not separate meshes: Bloxity draws them onto the skin texture
 * server-side. Listed in the order the API expects their URL segments.
 */
const SKIN_OVERLAYS = [
  ['pantsId', 'pn'],
  ['shirtId', 'sh'],
  ['faceId', 'fc'],
]

/**
 * URL of the skin with the worn pants, shirt and face drawn on, or null when none are
 * worn (then the plain `assetUrls.skinTexture` is the right texture).
 *
 * Mirrors the SDK's `avatar.getSkinTextureUrl()`, but built from the equipped payload
 * this component is rendering rather than the SDK's current user, so it can't lag a
 * live outfit change.
 */
export function skinCompositeUrl(equipped) {
  // As in the SDK, '0' also means "no overlay" here.
  const worn = (id) => isRealId(id) && String(id) !== '0'
  const layers = SKIN_OVERLAYS.filter(([key]) => worn(equipped?.[key]))
  if (layers.length === 0) return null

  let key = `s${skinIdOrDefault(equipped.skinId)}`
  for (const [field, prefix] of layers) key += `_${prefix}${equipped[field]}`
  return `${boxityEnv().apiUrl}/v1/avatar/skin-texture/${key}.png`
}
