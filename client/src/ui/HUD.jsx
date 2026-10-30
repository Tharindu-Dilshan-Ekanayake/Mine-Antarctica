import { useEffect, useRef, useState } from 'react'

import { CRYSTAL_BY_ID, PICKAXE_BY_ID, RARITIES, safeAltitude, WEATHER_BY_ID } from '@shared/catalog.js'
import { clock, kg, luckPct, money, shortNumber } from '@shared/format.js'
import { MOUNTAIN, ZONES } from '@shared/world.js'
import { sfx } from '../game/audio'
import { hotbarItems, carriedWeight, HOTBAR_SLOTS } from '../game/hotbar'
import { cameraState, teleportHome } from '../game/localPlayer'
import { playHere, useNet } from '../net/net'
import { useTutorial } from '../game/tutorial'
import { useUI } from '../store/ui'
import {
  CandyIcon,
  CloudIcon,
  CloverIcon,
  CoinIcon,
  Glyph,
  ItemIcon,
  PickaxeIcon,
  SnowflakeIcon,
} from './icons'
import { AnimatedNumber } from './Juice'
import useNow from './useNow'

const open = (modal) => () => useUI.getState().openModal(modal)

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const PX_PER_DEG = 3.1

/** Heading strip, moved by its own rAF loop (no React renders while turning). */
function Compass() {
  const stripRef = useRef(null)
  useEffect(() => {
    let raf
    const loop = () => {
      const heading = ((((-cameraState.yaw * 180) / Math.PI) % 360) + 360) % 360
      if (stripRef.current) stripRef.current.style.transform = `translateX(${-(heading + 360) * PX_PER_DEG}px)`
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const marks = []
  for (let deg = 0; deg <= 1080; deg += 15) {
    const major = deg % 45 === 0
    marks.push(
      <div key={deg} className="absolute top-0 flex flex-col items-center" style={{ left: deg * PX_PER_DEG, transform: 'translateX(-50%)' }}>
        {major ? (
          <span className={`text-[13px] font-bold ${deg % 360 === 0 ? 'text-red-500' : 'text-white'}`}>{DIRS[(deg / 45) % 8]}</span>
        ) : (
          <span className="h-[19px]" />
        )}
        <span className={`w-[2px] ${major ? 'h-[8px] bg-white' : 'h-[5px] bg-white/50'}`} />
      </div>,
    )
  }
  return (
    <div
      data-hud="compass"
      className="absolute left-1/2 top-3 h-[40px] w-[min(620px,60vw)] -translate-x-1/2 overflow-hidden rounded-md bg-[rgba(20,22,28,0.85)]"
      style={{ maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)' }}
    >
      <div className="absolute left-1/2 top-[6px]">
        <div ref={stripRef} className="relative">
          {marks}
        </div>
      </div>
      <div className="absolute left-1/2 top-0 h-full w-[3px] -translate-x-1/2 bg-sky-400" />
    </div>
  )
}

/**
 * "Rarity Zone: EPIC" - flashes up for a few seconds when you climb into a new zone,
 * then fades away (a CSS animation; the key replays it on every zone change).
 */
function ZoneBanner() {
  const onMountain = useUI((s) => s.onMountain)
  const zone = useUI((s) => s.zone)
  if (!onMountain) return null
  const z = ZONES[zone]
  return (
    <div key={zone} data-hud="zone" className="zone-flash pointer-events-none absolute left-1/2 top-[62px] -translate-x-1/2 text-center leading-none">
      <div className="cartoon-thin text-[30px]" style={{ fontFamily: 'Fredoka', fontWeight: 700 }}>
        Rarity Zone
      </div>
      <div className="cartoon text-[22px]" style={{ color: z.color }}>
        {z.name}
      </div>
    </div>
  )
}

/**
 * One HUD button: a frosted-glass tile with an icon and a small caption. Every menu
 * button in the HUD is one of these, so they all share size, spacing and feel.
 */
function Tile({ glyph, label, onClick, badge, small = false }) {
  return (
    <button type="button" onClick={onClick} className={`hb ${small ? 'hb-sm' : ''}`} aria-label={label}>
      {badge && <span className="hb-badge">{badge}</span>}
      <Glyph name={glyph} size={small ? 26 : 32} />
      <span className="hb-label">{label}</span>
    </button>
  )
}

/**
 * Switches the camera between third person (behind you) and first person (through your
 * eyes). Shows what you'd switch TO. Also the V key.
 */
function ViewTile({ small }) {
  const mode = useUI((s) => s.cameraMode)
  return (
    <Tile
      small={small}
      glyph={mode === 'first' ? 'person' : 'eye'}
      label={mode === 'first' ? '3rd View' : '1st View'}
      onClick={() => {
        sfx.click()
        useUI.getState().toggleCameraMode()
      }}
    />
  )
}

/**
 * Touch screens in first person: a small dot where your pickaxe aims (the middle of the
 * view, a touch low), so you always know what the dig button will hit.
 */
function FirstPersonDot() {
  const mode = useUI((s) => s.cameraMode)
  if (mode !== 'first' || !COARSE_POINTER) return null
  return <div className="fp-dot" aria-hidden />
}
const COARSE_POINTER = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

/** Phones: the view switch, a square button by BASE. */
function ViewButton() {
  const mode = useUI((s) => s.cameraMode)
  return (
    <button
      type="button"
      className={`slots-btn ${mode === 'first' ? 'open' : ''}`}
      onClick={() => {
        sfx.click()
        useUI.getState().toggleCameraMode()
      }}
      aria-label={mode === 'first' ? 'Switch to third-person view' : 'Switch to first-person view'}
    >
      <Glyph name={mode === 'first' ? 'person' : 'eye'} size={24} />
    </button>
  )
}

/** Top right: the game's menus, in one glass bar. */
function MenuBar() {
  return (
    <div data-hud="topright" className="hud-group pointer-events-auto">
      <ViewTile small />
      <Tile small glyph="event" label="Event" onClick={open('event')} />
      <Tile small glyph="quests" label="Quests" onClick={open('quests')} />
      <Tile small glyph="players" label="Players" onClick={open('players')} />
      <Tile small glyph="settings" label="Settings" onClick={open('settings')} />
    </div>
  )
}

/** Your altitude now and your best, as a compact stat card. */
function AltitudeChip() {
  const altitude = useUI((s) => s.altitude)
  const best = useNet((s) => s.me?.bestAlt ?? 0)
  return (
    <div className="stat-chip">
      <span className="stat-cap">Altitude</span>
      <span className="stat-num">
        {altitude}
        <small>m</small>
      </span>
      <span className="stat-sub">
        Best <b>{Math.max(best, altitude)}m</b>
      </span>
    </div>
  )
}

/** Left edge: altitude, then the shops and collections. */
function Dock() {
  return (
    <div data-hud="left" className="hud-group hud-group-col pointer-events-auto">
      <AltitudeChip />
      <Tile glyph="shop" label="Shop" badge="NEW" onClick={open('shop')} />
      <Tile glyph="index" label="Index" onClick={open('index')} />
      <Tile glyph="pass" label="Frost Pass" onClick={open('pass')} />
    </div>
  )
}

function Currencies({ hud = 'money' }) {
  const cash = useNet((s) => s.me?.cash ?? 0)
  const candy = useNet((s) => s.me?.candy ?? 0)
  return (
    <div data-hud={hud} className="pointer-events-auto flex flex-col items-start gap-2">
      <div className="cur-chip">
        <CandyIcon size={30} />
        <AnimatedNumber value={candy} format={shortNumber} className="cur-num text-[#ffb52e]" />
        <button type="button" onClick={open('event')} className="cur-add" aria-label="Get more candy">
          +
        </button>
      </div>
      <div className="cur-chip">
        <CoinIcon size={30} />
        <AnimatedNumber value={cash} format={money} className="cur-num text-[#ffd23a]" />
      </div>
    </div>
  )
}

/** Phones: shows or hides the hotbar (your pickaxe, bombs, radars and crystals). */
function SlotsButton() {
  const open = useUI((s) => s.hotbarOpen)
  return (
    <button
      type="button"
      data-tut="slots"
      className={`slots-btn ${open ? 'open' : ''}`}
      onClick={() => {
        sfx.click()
        useUI.getState().toggleHotbar()
      }}
      aria-label={open ? 'Hide your items' : 'Show your items'}
      aria-pressed={open}
    >
      <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden>
        <rect x="1" y="3" width="6" height="10" rx="1.5" fill="#fff" />
        <rect x="9" y="3" width="6" height="10" rx="1.5" fill="#7fe6ff" />
        <rect x="17" y="3" width="6" height="10" rx="1.5" fill="#fff" />
      </svg>
    </button>
  )
}

/** Phones: the top-right row - your items, and the way home. */
function PhoneBar() {
  return (
    <div data-hud="phonebar" className="phone-bar pointer-events-auto">
      <ViewButton />
      <SlotsButton />
      <BaseButton />
      <HudSwap />
    </div>
  )
}

/** The way home: the one big action button of the HUD. */
function BaseButton({ hud }) {
  return (
    <button type="button" data-hud={hud} data-tut="base" onClick={teleportHome} className="base-btn pointer-events-auto" title="Go back home">
      <Glyph name="home" size={26} />
      <span>BASE</span>
    </button>
  )
}

/** When the mountain rerolls into a new one. */
function MountainTimer({ chip = false }) {
  const now = useNow()
  const rerollAt = useNet((s) => s.world.rerollAt)
  return (
    <button
      type="button"
      className={chip ? 'info-chip' : 'info-chip info-chip-lg'}
      onClick={() => useUI.getState().toast('A NEW Antarctic mining zone EVERY HOUR! The mountain rerolls when this hits 0.', 'info', 4000)}
    >
      <Glyph name="timer" size={22} />
      <span className="flex flex-col items-start leading-none">
        <span className="stat-cap">New mountain</span>
        <span className="info-num">{rerollAt ? clock((rerollAt - now) / 1000) : '--:--'}</span>
      </span>
    </button>
  )
}

/** Bottom left on bigger screens: the reroll timer and the way home. */
function TimerRow() {
  return (
    <div data-hud="timer" className="pointer-events-auto flex items-end gap-2">
      <MountainTimer />
      <BaseButton />
    </div>
  )
}

function Hotbar() {
  const me = useNet((s) => s.me)
  const slot = useUI((s) => s.slot)
  const items = hotbarItems(me)
  const cells = Array.from({ length: HOTBAR_SLOTS }, (_, i) => {
    const item = i === 0 ? null : items[i - 1]
    const selected = slot === i
    // Rarity glow on crystal slots.
    const glow = item?.kind === 'crystal' ? RARITIES[CRYSTAL_BY_ID[item.type]?.rarity ?? 0].color : null
    return (
      <button
        type="button"
        key={i}
        data-tut={`slot-${i}`}
        onClick={() => useUI.getState().setSlot(i)}
        className={`hot-slot relative flex h-[66px] w-[68px] shrink-0 flex-col items-center justify-center rounded-md border-2 ${
          selected ? 'selected border-white bg-[rgba(70,80,100,0.85)]' : 'border-transparent bg-[rgba(20,22,28,0.75)]'
        }`}
        style={glow ? { boxShadow: `inset 0 -6px 12px -4px ${glow}` } : undefined}
      >
        <span className="cartoon-thin absolute left-1.5 top-0.5 text-[16px] font-bold text-white">{(i + 1) % 10}</span>
        {i === 0 ? (
          <>
            <PickaxeIcon id={me?.pickaxe} size={40} />
            <span className="cartoon-thin text-[10px] font-bold leading-none text-white">
              {PICKAXE_BY_ID[me?.pickaxe ?? 'rusted']?.name}
            </span>
          </>
        ) : item ? (
          <>
            <ItemIcon item={item} size={34} />
            <span className="cartoon-thin text-[12px] font-bold leading-none text-white">
              {item.kind === 'crystal' ? kg(item.weight) : item.kind}
            </span>
          </>
        ) : null}
      </button>
    )
  })
  return (
    <div data-hud="hotbar" className="pointer-events-auto flex gap-1.5">
      {cells}
    </div>
  )
}

function BackpackPanel() {
  const me = useNet((s) => s.me)
  const onMountain = useUI((s) => s.onMountain)
  if (!me) return null
  const carried = carriedWeight(me)
  const value = me.backpack.reduce((v, it) => v + (it.kind === 'crystal' ? it.value : 0), 0)
  if (!onMountain && carried === 0) return null
  const pct = Math.min(1, carried / me.backpackCap)
  // "Full" once the lightest crystal (1 kg) no longer fits.
  const full = me.backpackCap - carried < 1
  return (
    <div
      data-hud="backpack"
      role="button"
      tabIndex={-1}
      onClick={open('backpack')}
      className={`hud-card snowcap pointer-events-auto cursor-pointer w-[440px] px-5 py-2.5 text-white ${
        full ? 'bag-full !border-[#ff5a5a] !bg-[linear-gradient(160deg,rgba(130,30,36,0.95),rgba(60,10,14,0.95))]' : ''
      }`}
    >
      <div className="flex justify-between text-[13px] font-bold tracking-[0.08em] text-white/75">
        <span>{full ? 'BACKPACK FULL!' : 'BACKPACK'}</span>
        <span className="text-[#ffd23a]">{money(value)}</span>
      </div>
      <div className="text-[22px] font-bold leading-tight">
        {carried.toFixed(1)} kg / {me.backpackCap.toFixed(1)} kg
      </div>
      <div className="mt-1 h-[14px] overflow-hidden rounded-full bg-black/60">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct * 100}%`, background: pct > 0.9 ? '#ff4a4a' : 'linear-gradient(90deg,#4cd964,#a8e05a)' }}
        />
      </div>
      {full && (
        <div className="cartoon-thin mt-1 text-center text-[16px] font-bold text-[#ffd23a]">
          Go back to BASE and SELL, or buy a bigger bag at UPGRADES
        </div>
      )}
    </div>
  )
}

/** The icy climb meter on the right edge: your altitude vs the summit, plus cold. */
function AltitudeBar() {
  const altitude = useUI((s) => s.altitude)
  const cold = useUI((s) => s.cold)
  const warmth = useNet((s) => s.me?.warmth ?? 12)
  const pct = Math.min(1, altitude / MOUNTAIN.peak)
  const safePct = Math.min(1, safeAltitude(warmth) / MOUNTAIN.peak)
  const freezing = cold > 0.5
  return (
    <div data-hud="altbar" className="pointer-events-none">
      <div className="alt-peak">{MOUNTAIN.peak}m</div>
      <div className="alt-track">
        <div className="alt-fill" style={{ height: `${pct * 100}%` }} />
        <div className="alt-cold" style={{ height: `${cold * 100}%` }} />
        <div className="alt-safe" style={{ bottom: `${safePct * 100}%` }}>
          <SnowflakeIcon size={14} color="#ffffff" />
        </div>
      </div>
      <div className={`alt-you ${freezing ? 'freezing' : ''}`} style={{ bottom: `calc(${pct * 100}% + 22px)` }}>
        {altitude}m
      </div>
    </div>
  )
}

/** Weather (and when the next one comes) and your garden's luck. */
function WeatherChips({ hud = 'weather' }) {
  const now = useNow()
  const world = useNet((s) => s.world)
  const luck = useNet((s) => s.me?.luck ?? 0)
  const boost = useNet((s) => s.me?.boostUntil ?? 0)
  const active = world.weather && world.weatherEndsAt > now
  const w = WEATHER_BY_ID[world.weather]
  const t = active ? (world.weatherEndsAt - now) / 1000 : (world.nextWeatherAt - now) / 1000
  return (
    <div data-hud={hud} className="pointer-events-auto flex items-end gap-2">
      <button type="button" onClick={open('weather')} className="info-chip">
        <CloudIcon size={30} />
        <span className="flex flex-col items-start leading-none">
          <span className="stat-cap">{active ? w?.name : 'Next weather'}</span>
          <span className={`info-num ${active ? 'text-[#7fe6ff]' : ''}`}>{world.nextWeatherAt ? clock(t) : '--:--'}</span>
        </span>
      </button>
      <button type="button" onClick={open('garden')} className="info-chip">
        <CloverIcon size={26} />
        <span className="flex flex-col items-start leading-none">
          <span className="stat-cap">Luck</span>
          <span className={`info-num ${boost > now ? 'text-[#ffd23a]' : 'text-[#5cff6e]'}`}>
            {luckPct(luck)}
            {boost > now ? ' x3' : ''}
          </span>
        </span>
      </button>
    </div>
  )
}

/**
 * Phones: everything that isn't needed to play, in one drawer under the swap button -
 * your money, the timers and every menu - instead of buttons all over the mountain.
 */
function PhoneMenu() {
  const collapsed = useUI((s) => s.hudCollapsed)
  const compact = useCompact()
  if (!compact || collapsed) return null
  const go = (modal) => () => {
    useUI.getState().openModal(modal)
    useUI.getState().toggleHud()
  }
  return (
    <div data-hud="drawer" className="phone-drawer pointer-events-auto">
      <div className="drawer-grid">
        <Tile small glyph="shop" label="Shop" badge="NEW" onClick={go('shop')} />
        <Tile small glyph="index" label="Index" onClick={go('index')} />
        <Tile small glyph="pass" label="Pass" onClick={go('pass')} />
        <Tile small glyph="event" label="Event" onClick={go('event')} />
        <Tile small glyph="quests" label="Quests" onClick={go('quests')} />
        <Tile small glyph="players" label="Players" onClick={go('players')} />
        <Tile small glyph="settings" label="Settings" onClick={go('settings')} />
      </div>
      <div className="flex flex-wrap gap-2">
        <MountainTimer chip />
        <WeatherChips hud="drawer-weather" />
      </div>
      <AltitudeChip />
    </div>
  )
}

const COMPACT_QUERY = '(max-height: 560px), (max-width: 720px)'

/** True on phone-sized screens (the same rule as the compact HUD in index.css). */
function useCompact() {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY)
    const on = () => setCompact(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return compact
}

/**
 * One scale for the whole HUD, from the screen's shorter side: the same layout looks
 * the same on a phone, a laptop and a big monitor, just bigger or smaller. The hotbar
 * also shrinks to fit the width. Written as CSS variables: no React renders on resize.
 */
/** Width (px, at full size) of the bottom row: timer + BASE, the hotbar, weather + luck, gaps. */
const BOTTOM_ROW_WIDTH = 1480

function useHudScale() {
  useEffect(() => {
    const apply = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      // The HUD shrinks with the screen's height AND width: the bottom row (timer and
      // BASE, the hotbar, weather and luck) must always fit side by side.
      const s = Math.min(1.12, Math.max(0.5, Math.min(Math.min(w, h) / 800, (w - 24) / BOTTOM_ROW_WIDTH)))
      const bar = Math.min(s, (w - 16) / 760)
      document.documentElement.style.setProperty('--hud-s', s.toFixed(3))
      document.documentElement.style.setProperty('--hud-bar', bar.toFixed(3))
      // Shop and panel windows: shrink to fit a phone (portrait by width, landscape by
      // height), full size on anything bigger.
      const modal = Math.min(1, Math.max(0.5, w < h ? w / 600 : Math.min(w / 1000, h / 700)))
      document.documentElement.style.setProperty('--modal-s', modal.toFixed(3))
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])
}

const TOAST_COLORS = { error: '#ff4a5a', warn: '#ff9a2e', info: '#ffffff', good: '#5cff8a', rare: '#ffd84a' }

function Toasts() {
  const toasts = useUI((s) => s.toasts)
  return (
    <div data-hud="toasts" className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-1">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pop-in px-10 py-1.5 text-center"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(15,17,22,0.8) 15%, rgba(15,17,22,0.8) 85%, transparent)' }}
        >
          <span className="cartoon-thin text-[24px] font-bold" style={{ color: TOAST_COLORS[t.kind] ?? '#fff' }}>
            {t.text}
            {t.count > 1 && <span className="text-[#ffd84a]"> [x{t.count}]</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

function ColdVignette() {
  const cold = useUI((s) => s.cold)
  if (cold < 0.05) return null
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        opacity: cold,
        boxShadow: 'inset 0 0 120px 40px rgba(190,235,255,0.9)',
        background: 'radial-gradient(ellipse at center, transparent 55%, rgba(200,240,255,0.55))',
      }}
    />
  )
}

/** Underground: how deep you've dug, right under the top bar. */
function DepthChip() {
  const depth = useUI((s) => s.depth)
  if (!depth) return null
  return (
    <div data-hud="depth" className="depth-chip pointer-events-none">
      <span aria-hidden>⛏</span> {depth} m underground
    </div>
  )
}

function ConnectionBanner() {
  const status = useNet((s) => s.status)
  const error = useNet((s) => s.error)
  const message = useNet((s) => s.message)
  if (status === 'online') return null
  if (status === 'replaced') {
    return (
      <div className="pointer-events-auto absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-2xl bg-black/75 px-6 py-5 text-center text-white">
        <div className="text-[18px] font-bold">You're playing in another window</div>
        <button type="button" onClick={playHere} className="btn btn-green px-6 py-2 text-[18px] font-black text-white">
          PLAY HERE
        </button>
      </div>
    )
  }
  const text =
    status === 'connecting'
      ? (message ?? 'Connecting to the expedition server...')
      : status === 'error'
        ? `Can't reach the expedition server (${error ?? 'no connection'})`
        : status === 'offline'
          ? 'Disconnected from the server'
          : ''
  if (!text) return null
  return (
    <div className="pointer-events-none absolute left-1/2 top-[56px] -translate-x-1/2 rounded-lg bg-black/70 px-4 py-1 text-[14px] font-semibold text-white">
      {text}
    </div>
  )
}

/** Name of the crystal in your selected slot, shown above the hotbar. */
function SelectedItemTag() {
  const me = useNet((s) => s.me)
  const slot = useUI((s) => s.slot)
  const inOwnPlot = useUI((s) => s.inOwnPlot)
  const item = hotbarItems(me)[slot - 1]
  if (!item || slot === 0) return null
  const name = item.kind === 'crystal' ? CRYSTAL_BY_ID[item.type]?.name : `${item.type} ${item.kind}`
  return (
    <div data-hud="selected" className="pointer-events-none text-center">
      <div className="rounded-md bg-black/70 px-3 py-1 text-[14px] font-bold text-[#5cff8a]">
        {name} {item.kind === 'crystal' && <span className="text-white/80">{money(item.value)} · {kg(item.weight)}</span>}
      </div>
      {item.kind === 'crystal' && (
        <div className="cartoon-thin mt-1 text-[16px] font-bold text-white">
          {inOwnPlot ? (
            <>
              <span className="text-[#ffd23a]">Q</span> {'←'} ROTATE {'→'} <span className="text-[#ffd23a]">E</span> · click to place
            </>
          ) : (
            'Go to your garden plot to place it'
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Phones: one button swaps the menus (settings, quests, shop tiles, cash, hotbar...) in
 * and out, so most of the time the screen is the mountain, not buttons. Hidden on
 * bigger screens, where everything always fits (see the compact rules in index.css).
 */
function HudSwap() {
  const collapsed = useUI((s) => s.hudCollapsed)
  return (
    <button
      type="button"
      data-hud="swap"
      className={`hud-swap pointer-events-auto ${collapsed ? '' : 'open'}`}
      onClick={() => {
        sfx.click()
        useUI.getState().toggleHud()
      }}
      aria-label={collapsed ? 'Show menus' : 'Hide menus'}
      aria-expanded={!collapsed}
    >
      {collapsed ? (
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
          <rect x="2" y="2" width="8" height="8" rx="2.5" fill="#fff" />
          <rect x="12" y="2" width="8" height="8" rx="2.5" fill="#ffd23a" />
          <rect x="2" y="12" width="8" height="8" rx="2.5" fill="#7fe6ff" />
          <rect x="12" y="12" width="8" height="8" rx="2.5" fill="#fff" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <path d="M4 4 L16 16 M16 4 L4 16" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
        </svg>
      )}
    </button>
  )
}

export default function HUD() {
  const collapsed = useUI((s) => s.hudCollapsed)
  // The guide may point at a hotbar slot: keep the hotbar up even on a tidy phone HUD.
  const tutHotbar = useTutorial((s) => s.showHotbar)
  const hotbarOpen = useUI((s) => s.hotbarOpen)
  // In your own garden the hotbar opens by itself: that's where you place crystals.
  const inOwnPlot = useUI((s) => s.inOwnPlot)
  const showHotbar = !collapsed || hotbarOpen || inOwnPlot || tutHotbar
  useHudScale()
  return (
    <div data-collapsed={collapsed} data-hotbar={showHotbar} className="pointer-events-none absolute inset-0 z-10 select-none">
      <ColdVignette />
      <Compass />
      <ZoneBanner />
      <DepthChip />
      <ConnectionBanner />
      <MenuBar />
      <Dock />
      <AltitudeBar />
      <Currencies />
      <TimerRow />
      <PhoneBar />
      <BackpackPanel />
      <SelectedItemTag />
      <Hotbar />
      <WeatherChips />
      <PhoneMenu />
      <FirstPersonDot />
      <Toasts />
    </div>
  )
}
