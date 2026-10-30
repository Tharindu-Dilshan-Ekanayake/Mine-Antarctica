import { useEffect } from 'react'

import { CRYSTAL_BY_ID, RARITIES, SIZES } from '@shared/catalog.js'
import { money } from '@shared/format.js'
import { MOUNTAIN, plotContains, zoneIndexAt } from '@shared/world.js'
import { openDeathScreen } from '../bloxity/deathScreen'
import { setWind, sfx } from '../game/audio'
import { nearestLoose, nearestStall, openStall } from '../game/interaction'
import { localPlayer, placement, respawnPlayer } from '../game/localPlayer'
import { insideGrid, terrainHeight } from '../game/terrain/heightGrid'
import { surfaceAt } from '../game/terrain/solid'
import { onNetEvent, useNet } from '../net/net'
import { useUI } from '../store/ui'

const TICK_MS = 125

/**
 * Copies frame-loop state into the UI store at 8 Hz (only fields that changed), opens
 * shops when you walk up to a stall, and turns server events into toasts/sounds.
 */
export default function useUITicker() {
  useEffect(() => {
    let lastStall = null

    const id = setInterval(() => {
      const ui = useUI.getState()
      const me = useNet.getState().me
      const p = localPlayer
      const patch = {}

      const altitude = Math.max(0, Math.round(p.y))
      if (altitude !== ui.altitude) patch.altitude = altitude
      const onMountain = insideGrid(p.x, p.z) && terrainHeight(p.x, p.z) > 0.6
      if (onMountain !== ui.onMountain) patch.onMountain = onMountain
      const zone = zoneIndexAt(p.y)
      if (zone !== ui.zone) patch.zone = zone
      // The wind picks up as you climb.
      setWind(onMountain ? p.y / MOUNTAIN.peak : 0)
      // How deep underground: the surface above you minus where you stand.
      const under = onMountain ? surfaceAt(p.x, p.z) - p.y : 0
      const depth = under > 1.5 ? Math.round(under) : 0
      if (depth !== ui.depth) patch.depth = depth
      const cold = Math.round(p.cold * 50) / 50
      if (cold !== ui.cold) patch.cold = cold

      const loose = nearestLoose(5)
      const stall = nearestStall()
      const prompt = placement.active
        ? { kind: 'rotate' }
        : loose?.mine
          ? { kind: 'pickup', id: loose.id }
          : stall
            ? { kind: 'stall', id: stall.id }
            : null
      if (JSON.stringify(prompt) !== JSON.stringify(ui.prompt)) patch.prompt = prompt

      const inOwnPlot = !!me && plotContains(me.plot, p.x, p.z, -2)
      if (inOwnPlot !== ui.inOwnPlot) patch.inOwnPlot = inOwnPlot

      // Walk up to a stall -> it opens; walk away -> it closes.
      const stallId = stall?.id ?? null
      if (stallId !== lastStall) {
        // Close whatever the previous stall opened, then open the new one.
        if (lastStall === 'sell') useUI.setState({ sellDialog: false })
        else if (lastStall && ui.modal === lastStall) ui.closeModal()
        if (stallId) openStall(stallId)
        lastStall = stallId
      }

      if (p.froze) {
        p.froze = false
        // Shops and dialogs make way for the death card.
        if (ui.modal) ui.closeModal()
        if (ui.sellDialog) patch.sellDialog = false
        openDeathScreen(respawnPlayer)
        sfx.freeze()
      }

      if (Object.keys(patch).length) useUI.setState(patch)
    }, TICK_MS)

    const offs = [
      onNetEvent('found', ({ type, size, weight, mutation }) => {
        const t = CRYSTAL_BY_ID[type]
        const r = RARITIES[t?.rarity ?? 0]
        sfx.find(t?.rarity ?? 0)
        // Everyday finds speak for themselves (the crystal pops out right there); only
        // the special ones get a line on screen.
        if ((t?.rarity ?? 0) < 2 && !mutation && size < 3) return
        useUI.getState().toast(
          `Found a ${SIZES[size]?.name} ${r.name}${mutation ? ` ${mutation}` : ''} crystal! (${weight} kg)`,
          'rare',
        )
      }),
      onNetEvent('sold', ({ amount, count }) => {
        useUI.getState().toast(`Sold ${count} crystal${count === 1 ? '' : 's'} for ${money(amount)}!`, 'good')
        sfx.sell()
      }),

    ]

    return () => {
      clearInterval(id)
      offs.forEach((off) => off())
    }
  }, [])
}
