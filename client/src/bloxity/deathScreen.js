import { useUI } from '../store/ui'
import { getSDK, safeCall } from './sdk'

/**
 * Boxity's death screen. When you freeze, Boxity may show ads around the game while
 * you're down, and the game's own Respawn button (DeathCard) waits out its countdown -
 * at least 4 s - so they're seen. Never a respawn on a timer: only the button, once
 * Boxity says so. Outside Boxity, or with no ads to show, the countdown is 0 at once
 * and Respawn works straight away, so this one path works everywhere.
 */

let death = null
let offCountdown = null
let onRespawn = null

const setDeath = (value) => useUI.setState({ death: value })

/** You froze: `respawn` runs once Respawn is pressed (and allowed). */
export function openDeathScreen(respawn) {
  closeHandles()
  const sdk = getSDK()
  death = safeCall(() => sdk?.deathScreen?.show?.()) ?? null
  onRespawn = respawn
  setDeath({ seconds: death ? 4 : 0 })
  if (death?.onCountdown) {
    offCountdown = safeCall(() =>
      death.onCountdown((seconds) => {
        if (useUI.getState().death) setDeath({ seconds: Math.max(0, Math.ceil(Number(seconds) || 0)) })
      }),
    )
  }
}

/** Respawn pressed: goes ahead only if Boxity's countdown is over. Returns whether it did. */
export function pressRespawn() {
  if (!useUI.getState().death) return false
  if (death && !safeCall(() => death.respawn())) return false
  const respawn = onRespawn
  closeHandles()
  setDeath(null)
  respawn?.()
  return true
}

/**
 * Away from the death screen some other way (Boxity's "Reset Character", or leaving the
 * room): Boxity is told to take it down, rather than a respawn being claimed.
 */
export function closeDeathScreen() {
  if (death) safeCall(() => getSDK()?.deathScreen?.hide?.())
  closeHandles()
  if (useUI.getState().death) setDeath(null)
}

function closeHandles() {
  if (typeof offCountdown === 'function') safeCall(offCountdown)
  offCountdown = null
  death = null
  onRespawn = null
}
