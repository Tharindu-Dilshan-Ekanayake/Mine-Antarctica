import { BOXITY_BOARDS } from '@shared/boxity.js'

import { setAdBreak, setMusicVolume, setVolume } from '../game/audio'
import { loadEmotes, playEmote } from '../game/emotes'
import { input, localPlayer, respawnPlayer, teleportHome } from '../game/localPlayer'
import { showChatBubble } from '../game/speechBubbles'
import { useQuality } from '../store/quality'
import { useUI } from '../store/ui'
import { closeDeathScreen } from './deathScreen'
import { safeCall, toUnsubscribe } from './sdk'
import { useBloxityStore } from './store'

/**
 * Everything the game does with Boxity beyond who you are and what you wear (that's
 * BloxityProvider, with its one onUserChanged subscription): set up once, right after
 * Legion.SDK.init(), and kept for the whole session.
 *
 * - Platform features: emotes registered (Boxity draws the picker; we play them), the
 *   leaderboard declared (Boxity's trophy button; the server reports the scores).
 * - Settings from Boxity's menu: volume and graphics quality.
 * - Ad breaks: the player stands still, the cold waits and every sound is off.
 * - Player events: "Reset Character", emotes picked.
 * - Chat: each player's latest message over their head.
 * - Escape opens Boxity's menu (inside Boxity, when no panel of ours is open).
 * - Screen ads around a full-screen panel (shop, upgrades, backpack...) while it's open.
 */

let sdkRef = null
let started = false

/** Whether we're inside Boxity (its page around us). */
export function insideBoxity(sdk = sdkRef) {
  return Boolean(safeCall(() => sdk?.portal?.isEmbeddedInLegion?.()) || safeCall(() => sdk?.portal?.isInIframe?.()))
}

/** A setting's percentage as 0-1, or the default when it isn't a number. */
const percent = (value, fallback) => {
  const n = Number.parseFloat(value)
  return (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback) / 100
}

/**
 * Boxity's graphics setting. The game starts on LOW whatever the hardware; Boxity's own
 * default ("High", sent before the player's real choice lands) doesn't override that -
 * only a choice the player makes in Boxity's menu does.
 */
const QUALITY_FROM_BOXITY = { Low: 'LOW', Medium: 'MEDIUM', High: 'HIGH', Ultra: 'HIGH' }
let lastQualitySetting = null
function applyGraphics(value) {
  const preset = QUALITY_FROM_BOXITY[value]
  const first = lastQualitySetting === null
  const changed = value !== lastQualitySetting
  lastQualitySetting = value
  if (!preset || !changed) return
  if (first && value === 'High') return
  if (useQuality.getState().preset !== preset) useQuality.getState().setPreset(preset)
}

/** Boxity's "Reset Character": instant, and the way out of a death screen too. */
function resetCharacter() {
  if (localPlayer.dead) {
    closeDeathScreen()
    respawnPlayer()
  } else teleportHome()
}

/** Whether one of our panels is open (it gets Escape, and screen ads around it). */
const panelOpen = (ui) => Boolean(ui.modal || ui.sellDialog)

/** Sets up everything above once the SDK is initialised. Safe to call more than once. */
export function startPlatform(sdk) {
  if (started || !sdk) return
  started = true
  sdkRef = sdk
  const keep = (unsubscribe) => toUnsubscribe(unsubscribe)

  // As soon as init has resolved: a late registration means a late emote button.
  safeCall(() => sdk.game?.registerFeature?.('emotes'))
  safeCall(() => sdk.leaderboard?.define?.(BOXITY_BOARDS))
  loadEmotes()

  useBloxityStore.setState({ embedded: insideBoxity(sdk) })

  // Ad breaks: Boxity may start one at any time.
  safeCall(() =>
    sdk.ads?.onBreakStart?.(() => {
      localPlayer.paused = true
      input.action = false
      setAdBreak(true)
    }),
  )
  safeCall(() =>
    sdk.ads?.onBreakEnd?.(() => {
      localPlayer.paused = false
      setAdBreak(false)
    }),
  )

  // Settings: listening is also what turns each control on in Boxity's menu.
  safeCall(() => sdk.settings?.listen?.('master_volume', (v) => setVolume(percent(v, 80))))
  safeCall(() => sdk.settings?.listen?.('music_volume', (v) => setMusicVolume(percent(v, 80))))
  safeCall(() => sdk.settings?.listen?.('graphics_quality', (v) => applyGraphics(String(v))))

  keep(
    safeCall(() =>
      sdk.player?.onEvent?.((event, data) => {
        try {
          if (event === 'respawn_request') resetCharacter()
          else if (event === 'play_emote') playEmote(data)
        } catch (err) {
          console.warn('[bloxity] could not handle', event, err)
        }
      }),
    ),
  )

  keep(
    safeCall(() =>
      sdk.chat?.onMessage?.((message) => {
        const text = safeCall(() => sdk.chat.bubbleText(message))
        showChatBubble(message?.isLocalPlayer ? 'local' : String(message?.userId ?? '').replace(/^legion_/, ''), text, sdk.chat?.bubbleSeconds ?? 4)
      }),
    ),
  )

  // Escape: Boxity's pause menu, when there's no panel of ours open for it to close.
  // Capture phase, so it sees the panel before the game's own Escape closes it.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.repeat || !insideBoxity(sdk)) return
      const ui = useUI.getState()
      if (panelOpen(ui) || ui.death) return
      safeCall(() => sdk.portal?.showMenu?.(true))
    },
    true,
  )

  // Screen ads: Boxity's banners around a full-screen panel while it's open.
  let screen = null
  useUI.subscribe((state, prev) => {
    const open = panelOpen(state)
    if (open === panelOpen(prev)) return
    if (open && !screen) screen = safeCall(() => sdk.ads?.screen?.('panel')) ?? null
    else if (!open && screen) {
      safeCall(() => screen.hide?.())
      screen = null
    }
  })
}

/**
 * The game is on screen and playable (after loadingEnd): every setting applied again now
 * that the systems exist, and gameplay begins - this game has no menu before it.
 */
export function platformReady() {
  const sdk = sdkRef
  if (!sdk) return
  safeCall(() => sdk.settings?.triggerAll?.())
  safeCall(() => sdk.game?.gameplayStart?.())
}

/** The room you're in, for invites and "join a friend" ('' when not in a joinable one). */
export function reportRoom(roomId) {
  safeCall(() => sdkRef?.game?.updateRoom?.(roomId || ''))
}

/** Another player in your room, for Boxity's "your friend joined" toasts. */
export function reportPlayer(name, alreadyThere) {
  if (!name) return
  safeCall(() => (alreadyThere ? sdkRef?.game?.playerInRoom?.(name) : sdkRef?.game?.playerJoined?.(name)))
}
