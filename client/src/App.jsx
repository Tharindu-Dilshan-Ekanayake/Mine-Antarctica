import { useCallback, useEffect, useRef } from 'react'

import { useBloxity } from './bloxity/BloxityContext'
import { platformReady } from './bloxity/platform'
import { installAudioUnlock } from './game/audio'
import { useTutorialDriver } from './game/tutorial'
import GameCanvas from './game/GameCanvas'
import useKeyboard from './game/useKeyboard'
import { labelLayer } from './game/WorldLabels'
import { connect, rejoinAsNewIdentity, send, useNet } from './net/net'
import { useUI } from './store/ui'
import DeathCard from './ui/DeathCard'
import HUD from './ui/HUD'
import { Splash } from './ui/Juice'
import Tutorial from './ui/Tutorial'
import { ContextLostOverlay, LoadingScreen, SellDialog, TouchControls } from './ui/Overlays'
import {
  BackpackPanelModal,
  EventPanel,
  GardenPanel,
  IndexPanel,
  PassPanel,
  PlayersPanel,
  QuestsPanel,
  SettingsPanel,
  WeatherPanel,
} from './ui/Panels'
import { BombShop, PickaxeShop, RadarShop, ShopHub, UpgradeShop } from './ui/Shops'
import useUITicker from './ui/useUITicker'

const MODALS = {
  shop: ShopHub,
  pickaxes: PickaxeShop,
  upgrades: UpgradeShop,
  bombs: BombShop,
  radars: RadarShop,
  index: IndexPanel,
  garden: GardenPanel,
  weather: WeatherPanel,
  quests: QuestsPanel,
  event: EventPanel,
  pass: PassPanel,
  settings: SettingsPanel,
  backpack: BackpackPanelModal,
  players: PlayersPanel,
}

function ActiveModal() {
  const modal = useUI((s) => s.modal)
  const Panel = MODALS[modal]
  return Panel ? <Panel /> : null
}

/**
 * Joins the server once the Bloxity identity is known; republishes avatar changes.
 * Signing in (or out) mid-game rejoins the same room as the new identity, so the
 * server loads the right save and friends stay together.
 */
function useConnection() {
  const { identity, user, avatar, proportions, isReady, status, game } = useBloxity()
  const name = identity?.displayName || identity?.username || 'Guest'
  const avatarJson = JSON.stringify({ equipped: avatar ?? null, proportions })
  const netStatus = useNet((s) => s.status)
  const userId = user?._id ?? null
  const joinedAs = useRef(undefined)

  useEffect(() => {
    // Don't wait forever on the SDK: if it fails, join as a guest.
    if (!isReady && status !== 'error') return
    if (netStatus !== 'idle') return
    game.loadingStep('Joining server...')
    joinedAs.current = userId
    connect({ name, avatar: avatarJson })
  }, [isReady, status, netStatus, name, avatarJson, userId, game])

  useEffect(() => {
    if (joinedAs.current === undefined || joinedAs.current === userId) return
    joinedAs.current = userId
    rejoinAsNewIdentity({ name, avatar: avatarJson })
  }, [userId, name, avatarJson])

  useEffect(() => {
    if (netStatus === 'online') send('identity', { name, avatar: avatarJson })
  }, [netStatus, name, avatarJson])
}

export default function App() {
  const { game } = useBloxity()
  const labelsRef = useRef(null)
  const ended = useRef(false)

  useKeyboard()
  useUITicker()
  useConnection()
  useTutorialDriver()
  useEffect(() => installAudioUnlock(), [])
  useEffect(() => {
    labelLayer.el = labelsRef.current
  }, [])

  const finishLoading = useCallback(() => {
    if (ended.current) return
    ended.current = true
    useUI.setState({ loaded: true })
    game.loadingEnd()
    // Settings applied again now that everything exists, and gameplay starts.
    platformReady()
  }, [game])

  // The avatar CDN can be slow or unreachable: never hold the player hostage.
  useEffect(() => {
    const t = setTimeout(finishLoading, 8000)
    return () => clearTimeout(t)
  }, [finishLoading])

  return (
    <div className="fixed inset-0 overflow-hidden">
      <GameCanvas onAvatarReady={finishLoading} />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" />
      <HUD />
      <TouchControls />
      <SellDialog />
      <Splash />
      <ActiveModal />
      <Tutorial />
      <DeathCard />
      <LoadingScreen />
      <ContextLostOverlay />
    </div>
  )
}
