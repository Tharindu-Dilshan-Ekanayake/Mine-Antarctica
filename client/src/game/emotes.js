import { boxityEnv } from '../bloxity/env'
import { send } from '../net/net'
import { localPlayer } from './localPlayer'

/**
 * Boxity emotes. Boxity draws the picker; the game plays what's picked on the player's
 * own character, and everyone else sees it through the synced state (Player.emote).
 * The clips come from Boxity's catalogue, fetched once - so emotes added later work
 * without a release. Nothing here can throw into a frame: an emote is cosmetic.
 */

/** Blend in (and, for a clip that doesn't loop, out) over this long, in seconds. */
const BLEND = 0.1

/** id -> { len, loop, trackList: [[bone, keys]] } */
const catalogue = new Map()
let loading = null

/** Fetches the catalogue (once). */
export function loadEmotes() {
  if (!loading) {
    loading = fetch(`${boxityEnv().apiUrl}/v1/avatar/emotes`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const list = Array.isArray(body) ? body : (body?.emotes ?? [])
        for (const emote of list) {
          const tracks = emote?.clip?.tracks
          if (!emote?.id || !tracks || typeof tracks !== 'object') continue
          catalogue.set(String(emote.id), {
            len: Math.max(0.05, Number(emote.clip.len) || 1),
            loop: Boolean(emote.clip.loop),
            trackList: Object.entries(tracks).filter(([, keys]) => Array.isArray(keys) && keys.length > 0),
          })
        }
      })
      .catch(() => {
        loading = null
      })
  }
  return loading
}

/** The clip for emote `id`, or null if it isn't (yet) known. */
export const emoteClip = (id) => (id ? (catalogue.get(String(id)) ?? null) : null)

/**
 * Boxity picked emote `id` for the player: play it on their character and tell the
 * room. An id we don't know is ignored, quietly - after a look in the catalogue, in
 * case it hadn't loaded yet.
 */
export function playEmote(id) {
  try {
    const key = String(id ?? '')
    if (!/^[a-z0-9]{1,32}$/i.test(key) || localPlayer.dead) return
    const start = () => {
      if (!emoteClip(key)) return
      localPlayer.emote = key
      localPlayer.emoteAt = performance.now()
      send('emote', { id: key })
    }
    if (emoteClip(key)) start()
    else loadEmotes()?.then(start)
  } catch {
    // Cosmetic: never let it break anything.
  }
}

/** Stops the player's emote, if one is playing (they moved, say). */
export function stopEmote() {
  if (!localPlayer.emote) return
  localPlayer.emote = ''
  send('emote', { id: '' })
}

/**
 * Writes emote `id`, started at `startedAt` (performance.now() ms), into `motion` for
 * the avatar to play (avatarRig.applyEmote): its clip, how far in, and how strongly.
 * Returns false once it has finished (a clip that doesn't loop), or for an unknown id.
 */
export function emoteMotion(motion, id, startedAt, now = performance.now()) {
  const clip = emoteClip(id)
  if (!clip) {
    motion.emoteClip = null
    return false
  }
  const time = Math.max(0, (now - startedAt) / 1000)
  let weight = Math.min(1, time / BLEND)
  if (!clip.loop) {
    if (time > clip.len + BLEND) {
      motion.emoteClip = null
      return false
    }
    weight = Math.min(weight, Math.max(0, (clip.len + BLEND - time) / BLEND))
  }
  motion.emoteClip = clip
  motion.emoteTime = time
  motion.emoteWeight = weight
  return true
}
