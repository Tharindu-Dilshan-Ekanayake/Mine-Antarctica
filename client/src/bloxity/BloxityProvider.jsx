import { useEffect, useMemo, useRef } from 'react'

import { GAME_ID } from '@shared/boxity.js'
import { BloxityContext } from './BloxityContext'
import { boxityEnv, toldEnvironment } from './env'
import { startPlatform } from './platform'
import { getSDK, safeCall, toUnsubscribe, waitForSDK } from './sdk'
import { DEFAULT_PROPORTIONS, useBloxityStore } from './store'

/**
 * `Legion.SDK.init()` must happen exactly once per page, but React 19 StrictMode
 * mounts effects twice in dev. A module-level latch (rather than a ref) is what
 * actually survives that double mount.
 */
let initPromise = null

/** Slots the SDK's equipped payload carries beyond the skin. */
const PART_ID_KEYS = [
  'hatId',
  'backId',
  'headId',
  'armLId',
  'armRId',
  'legLId',
  'legRId',
  'torsoId',
]

/**
 * True for the blanked-out `{ skinId: '-1' }` payload the SDK emits while it resets
 * state during a login/logout, as opposed to a genuinely bare avatar.
 */
function isResetSentinel(equipped) {
  if (!equipped) return false
  if (String(equipped.skinId) !== '-1') return false
  return PART_ID_KEYS.every((key) => equipped[key] === undefined)
}

/**
 * Which Boxity to talk to is the platform's to say (see env.js), so init() is given no
 * URLs - with one exception: a dev server on localhost that nobody told anything. There
 * the SDK would repoint itself at the Vite server (meant for running the whole Boxity
 * portal locally) and sign-in could never return, so in development, and only when told
 * nothing, it's handed production's addresses from the one environment helper.
 */
function initOptions(gameSlug) {
  if (!import.meta.env.DEV || toldEnvironment()) return { gameSlug }
  const { apiUrl, portalUrl } = boxityEnv()
  return { gameSlug, apiUrl, portalUrl }
}

function initOnce(gameSlug) {
  if (!initPromise) {
    // No abort signal: this promise is shared by every mount (StrictMode mounts twice in
    // dev), so one mount's cleanup must not cancel it for the next. Each caller ignores
    // a late result through its own `cancelled` flag instead.
    initPromise = waitForSDK().then((sdk) => {
      sdk.init(initOptions(gameSlug))
      // Emotes, leaderboards, settings, ad breaks, chat...: right after init, not later.
      startPlatform(sdk)
      return sdk
    })
    // A failed init shouldn't poison every later attempt (e.g. HMR reload).
    initPromise.catch(() => {
      initPromise = null
    })
  }
  return initPromise
}

/**
 * Owns the whole Bloxity session lifecycle: waits for the SDK script, initialises it
 * once, and subscribes to the auth/avatar change streams. Those subscriptions are the
 * single source of truth — nothing here polls `getUser()`.
 *
 * @param {{ gameSlug?: string, children: React.ReactNode }} props
 */
export function BloxityProvider({ gameSlug, children }) {
  // The game's Boxity slug (its hosting id); VITE_GAME_SLUG or the `gameSlug` prop override it.
  const slug = gameSlug || import.meta.env.VITE_GAME_SLUG || GAME_ID

  const status = useBloxityStore((s) => s.status)
  const error = useBloxityStore((s) => s.error)
  const user = useBloxityStore((s) => s.user)
  const guest = useBloxityStore((s) => s.guest)
  const equipped = useBloxityStore((s) => s.equipped)
  const proportions = useBloxityStore((s) => s.proportions)

  const sdkRef = useRef(null)

  useEffect(() => {
    const store = useBloxityStore.getState()
    const unsubscribers = []
    let cancelled = false

    store.setStatus('loading')

    initOnce(slug)
      .then((sdk) => {
        if (cancelled) return
        sdkRef.current = sdk

        const readEquipped = () =>
          safeCall(sdk.avatar.getEquipped?.bind(sdk.avatar)) || null

        // Auth. Fires immediately with the current user (or null), then on every
        // login/logout.
        unsubscribers.push(
          toUnsubscribe(
            sdk.auth.onUserChanged((nextUser) => {
              useBloxityStore.getState().setUser(nextUser || null)
              // The guest identity is what the HUD falls back to when signed out.
              useBloxityStore
                .getState()
                .setGuest(safeCall(sdk.auth.getGuest?.bind(sdk.auth)) || null)

              // Re-read the equipped set on every login/logout. `getEquipped()`
              // derives from the user object, so this is the authoritative value
              // for whoever just signed in — see the note on the reset sentinel
              // below for why we cannot wait for onAvatarChanged here.
              useBloxityStore.getState().setEquipped(readEquipped())
              useBloxityStore
                .getState()
                .setProportions(safeCall(sdk.avatar.getProportions?.bind(sdk.avatar)))
            }),
          ),
        )

        // Avatar cosmetics + body proportions. These drive a live rebuild of the
        // player model, so a change made in the Bloxity portal shows up without a
        // page reload.
        unsubscribers.push(
          toUnsubscribe(
            sdk.avatar.onAvatarChanged((nextEquipped) => {
              // The SDK notifies this callback with its *customizer* state, and its
              // own internal onUserChanged handler blanks that to {skinId:'-1'} on
              // every login/logout before re-fetching the real data (which it then
              // does NOT re-notify). Taking that sentinel at face value would reset
              // the character to the default body the instant you sign in, so fall
              // back to the user-derived getEquipped() when we see it.
              const store = useBloxityStore.getState()
              const next =
                isResetSentinel(nextEquipped) && store.user
                  ? readEquipped()
                  : nextEquipped || null
              store.setEquipped(next)
            }),
          ),
        )
        unsubscribers.push(
          toUnsubscribe(
            sdk.avatar.onProportionsChanged((nextProportions) => {
              useBloxityStore.getState().setProportions(nextProportions)
            }),
          ),
        )

        // Seed anything the subscriptions didn't fire synchronously.
        const s = useBloxityStore.getState()
        if (!s.guest) s.setGuest(safeCall(sdk.auth.getGuest?.bind(sdk.auth)) || null)
        if (!s.equipped) {
          s.setEquipped(safeCall(sdk.avatar.getEquipped?.bind(sdk.avatar)) || null)
        }

        useBloxityStore.getState().setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[bloxity] init failed:', err)
        useBloxityStore.getState().setStatus('error', err)
      })

    return () => {
      cancelled = true
      unsubscribers.forEach((fn) => safeCall(fn))
    }
  }, [slug])

  // No login / logout here: inside Boxity its toolbar handles accounts, and this game
  // runs nowhere else. The signed-in user arrives through onUserChanged above.

  // Loading-screen + room helpers, exposed so gameplay code doesn't reach for
  // `window.Legion` directly.
  const game = useMemo(
    () => ({
      loadingStep: (label) =>
        safeCall((sdkRef.current || getSDK())?.game?.loadingStep, label),
      loadingEnd: () => safeCall((sdkRef.current || getSDK())?.game?.loadingEnd),
      updateRoom: (room) => safeCall((sdkRef.current || getSDK())?.game?.updateRoom, room),
    }),
    [],
  )

  const value = useMemo(
    () => ({
      status,
      error,
      isReady: status === 'ready',
      user,
      guest,
      isLoggedIn: Boolean(user),
      /** Always something displayable, per the getUser() || getGuest() pattern. */
      identity: user || guest,
      avatar: equipped,
      proportions: proportions || DEFAULT_PROPORTIONS,
      game,
      gameSlug: slug,
    }),
    [status, error, user, guest, equipped, proportions, game, slug],
  )

  return <BloxityContext.Provider value={value}>{children}</BloxityContext.Provider>
}

export default BloxityProvider
