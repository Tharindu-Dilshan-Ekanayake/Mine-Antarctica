import { useState } from 'react'

import {
  CRYSTALS,
  CRYSTAL_BY_ID,
  gardenSlotCost,
  MUTATIONS,
  PASS_TIERS,
  QUESTS,
  questReward,
  questTarget,
  RARITIES,
  SIZES,
  WEATHER_TIMING,
  WEATHERS,
} from '@shared/catalog.js'
import { clock, kg, luckPct, money, shortNumber } from '@shared/format.js'
import { MAX_PLAYERS } from '@shared/world.js'
import { useBloxity } from '../bloxity/BloxityContext'
import { setMuted, sfx } from '../game/audio'
import { send, useNet } from '../net/net'
import { ORDER, useQuality } from '../store/quality'
import { useUI } from '../store/ui'
import useNow from './useNow'
import { CandyIcon, GemIcon, ItemIcon } from './icons'
import Modal from './Modal'

const act = (type, payload) => {
  sfx.click()
  send(type, payload)
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export function IndexPanel() {
  const discovered = useNet((s) => s.me?.discovered ?? [])
  const found = new Set(discovered)
  return (
    <Modal title={`Crystal Index  ${found.size}/${CRYSTALS.length}`}>
      {RARITIES.map((r, ri) => (
        <div key={r.name} className="mb-4">
          <div className="cartoon mb-2 text-[24px]" style={{ color: r.color }}>
            {r.name}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
            {CRYSTALS.filter((c) => c.rarity === ri).map((c) => {
              const has = found.has(c.id)
              return (
                <div key={c.id} className="flex flex-col items-center rounded-lg border-2 border-white/15 bg-[rgba(6,18,40,0.55)] p-2 text-center">
                  <div style={{ filter: has ? 'none' : 'brightness(0) opacity(0.5)' }}>
                    <GemIcon color={c.color} size={56} />
                  </div>
                  <div className="text-[13px] font-bold text-white">{has ? c.name : '???'}</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Garden
// ---------------------------------------------------------------------------

function Row({ label, desc, children }) {
  return (
    <div className="flex items-center gap-4 py-2">
      <div className="w-[38%] text-[24px] font-bold text-white">{label}</div>
      <div className="w-[160px] shrink-0">{children}</div>
      <div className="flex-1 text-[15px] font-semibold text-white/80">{desc}</div>
    </div>
  )
}

const GreenBtn = ({ children, onClick, red }) => (
  <button type="button" onClick={onClick} className={`btn ${red ? 'btn-red' : 'btn-green'} cartoon-thin h-12 w-full text-[22px] font-bold text-white`}>
    {children}
  </button>
)

export function GardenPanel() {
  const me = useNet((s) => s.me)
  const hidden = useUI((s) => s.hiddenMutations)
  const collisions = useUI((s) => s.crystalCollisions)
  const [view, setView] = useState('main')
  if (!me) return null
  const back = (
    <button type="button" onClick={() => setView('main')} className="btn btn-blue h-12 w-12 text-[24px] font-black text-white">
      {'<'}
    </button>
  )

  if (view === 'mutations') {
    return (
      <Modal title="Crystal Mutations Effects" headerExtra={back} width="min(920px, 94vw)">
        <p className="mb-3 text-center text-[17px] font-semibold text-white/70">Choose what you want to see and not.</p>
        <div className="grid grid-cols-4 gap-4 max-sm:grid-cols-2">
          {Object.entries(MUTATIONS).map(([name, m]) => {
            const off = hidden.includes(name)
            return (
              <div key={name} className="flex flex-col items-center gap-1">
                <span className="text-[20px] font-bold" style={{ color: m.color }}>
                  {name}
                </span>
                <GreenBtn
                  red={off}
                  onClick={() =>
                    useUI.setState({ hiddenMutations: off ? hidden.filter((h) => h !== name) : [...hidden, name] })
                  }
                >
                  {off ? 'Off' : 'On'}
                </GreenBtn>
              </div>
            )
          })}
        </div>
      </Modal>
    )
  }

  if (view === 'takeout') {
    return (
      <Modal title="Take out crystals" headerExtra={back} width="min(920px, 94vw)">
        {me.garden.length === 0 && <p className="text-center text-white/70">Your garden is empty.</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          {me.garden.map((it) => (
            <div key={it.uid} className="flex items-center gap-2 rounded-lg bg-[rgba(6,18,40,0.55)] p-2">
              <ItemIcon item={it} size={40} />
              <div className="flex-1 text-[13px] font-bold text-white">
                {CRYSTAL_BY_ID[it.type]?.name}
                <div className="text-white/60">
                  {kg(it.weight)} · {luckPct(it.luck)}
                </div>
              </div>
              <button type="button" className="btn btn-green px-2 py-1 text-[13px] font-bold text-white" onClick={() => act('takeOut', { uid: it.uid })}>
                Take
              </button>
            </div>
          ))}
        </div>
      </Modal>
    )
  }

  if (view === 'stats') {
    const total = me.garden.reduce((a, it) => a + it.weight, 0)
    const value = me.garden.reduce((a, it) => a + it.value, 0)
    const biggest = me.garden.reduce((a, it) => Math.max(a, it.weight), 0)
    const stats = [
      ['Crystals', `${me.garden.length} / ${me.gardenSlots}`],
      ['Total weight', kg(total)],
      ['Biggest', kg(biggest)],
      ['Garden value', money(value)],
      ['Digging luck', luckPct(me.luck)],
    ]
    return (
      <Modal title="Garden Stats" headerExtra={back} width="min(620px, 94vw)">
        {stats.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-white/10 py-2 text-[20px] font-bold text-white">
            <span className="text-white/75">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </Modal>
    )
  }

  const slotCost = gardenSlotCost(me.gardenSlots)
  return (
    <Modal title="Configure your garden" width="min(920px, 94vw)">
      <Row label="Mutation Effects" desc="Hide the effects from mutations">
        <GreenBtn onClick={() => setView('mutations')}>Edit</GreenBtn>
      </Row>
      <Row label="Sort your garden" desc="Automatically sort your garden">
        <GreenBtn onClick={() => act('sortGarden')}>Edit</GreenBtn>
      </Row>
      <Row label="Take out crystals" desc="Take out any crystal you want">
        <GreenBtn onClick={() => setView('takeout')}>Edit</GreenBtn>
      </Row>
      <Row label="Crystal Collisions" desc="Touch or go through crystals">
        <GreenBtn red={!collisions} onClick={() => useUI.setState({ crystalCollisions: !collisions })}>
          {collisions ? 'On' : 'Off'}
        </GreenBtn>
      </Row>
      <Row label="Garden Stats" desc="See your gardens stats!">
        <GreenBtn onClick={() => setView('stats')}>View</GreenBtn>
      </Row>
      <Row label={`Slots ${me.gardenSlots} ▶ ${me.gardenSlots + 1}`} desc="Place more crystals = more luck">
        <button
          type="button"
          disabled={me.cash < slotCost}
          onClick={() => act('buyGardenSlot')}
          className="btn btn-green cartoon h-12 w-full text-[22px]"
        >
          {money(slotCost)}
        </button>
      </Row>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

const RARITY_COLOR = { Common: '#d7d7d7', Uncommon: '#4ee44e', Rare: '#3d9bff', Epic: '#b45cff', Legendary: '#ffb020', Mythic: '#ff3d8b' }
const WEATHER_BG = {
  rain: 'linear-gradient(#2a4a7a,#1b2a44)',
  acid: 'linear-gradient(#3fae2a,#1b5a12)',
  blizzard: 'linear-gradient(#b8d8f0,#5a7a9a)',
  thunder: 'linear-gradient(#2a2f48,#11131c)',
  lucky: 'linear-gradient(#3fd23f,#145c14)',
  starfall: 'linear-gradient(#2a2f78,#11133c)',
  heatwave: 'linear-gradient(#ff8a3a,#9a2a0a)',
  aurora: 'linear-gradient(#2affc8,#2a3a8a)',
}

export function WeatherPanel() {
  const now = useNow()
  const world = useNet((s) => s.world)
  const active = world.weather && world.weatherEndsAt > now
  return (
    <Modal title="Weathers" width="min(760px, 94vw)">
      <div className="mb-3 rounded-xl border-2 border-white/20 bg-[rgba(6,18,40,0.55)] p-3 text-center">
        <div className="cartoon text-[24px] text-[#5cff6e]">{active ? 'WEATHER ACTIVE' : 'NEXT WEATHER'}</div>
        <div className="text-[18px] font-bold text-white">
          {active
            ? `${world.weather.toUpperCase()} ends in ${clock((world.weatherEndsAt - now) / 1000)}`
            : `Weather is coming to the mountain... (${clock((world.nextWeatherAt - now) / 1000)})`}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-2">
        {WEATHERS.map((w) => (
          <div key={w.id} className="relative h-[160px] overflow-hidden rounded-xl border-2 border-white/20 p-2" style={{ background: WEATHER_BG[w.id] }}>
            <div className="text-[18px] font-bold text-white">{w.name}</div>
            <div className="text-[14px] font-bold" style={{ color: RARITY_COLOR[w.rarity] }}>
              {w.rarity}
            </div>
            <div className="absolute bottom-2 right-2 text-right">
              <div className="cartoon text-[18px] text-[#ff5a7a]">x{MUTATIONS[w.mutation].mult}</div>
              <div className="cartoon text-[18px] text-[#ffd23a]">{w.chance.toFixed(1)}%</div>
              <div className="cartoon text-[18px]" style={{ color: MUTATIONS[w.mutation].color }}>
                {w.mutation}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-[16px] font-bold text-white">
        Note: Rarer weather brews a stronger crystal mutation. Each crystal you find during a weather has a{' '}
        {Math.round(WEATHER_TIMING.mutateChance * 100)}% chance to mutate.
      </p>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Quests, Event, Frost Pass
// ---------------------------------------------------------------------------

export function QuestsPanel() {
  const me = useNet((s) => s.me)
  if (!me) return null
  return (
    <Modal title="Quests" width="min(640px, 94vw)">
      {QUESTS.map((q, i) => {
        const level = me.quests[i] ?? 0
        const target = questTarget(q, level)
        const value = me[q.stat] ?? 0
        const done = value >= target
        const reward = questReward(q, level)
        return (
          <div key={q.id} className="mb-3 rounded-xl border-2 border-white/15 bg-[rgba(6,18,40,0.55)] p-3">
            <div className="flex items-center justify-between">
              <div className="text-[19px] font-bold text-white">
                {q.label.replace('{n}', shortNumber(target))} <span className="text-white/50">Lv.{level + 1}</span>
              </div>
              <div className="flex items-center gap-1 text-[16px] font-bold text-[#ffd23a]">
                {reward.cash ? money(reward.cash) : null}
                {reward.candy ? (
                  <>
                    <CandyIcon size={18} /> {reward.candy}
                  </>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-4 flex-1 rounded-full bg-black/60">
                <div className="h-full rounded-full bg-[#4cd964]" style={{ width: `${Math.min(100, (value / target) * 100)}%` }} />
              </div>
              <button type="button" disabled={!done} onClick={() => act('claimQuest', { index: i })} className="btn btn-green px-3 py-1 font-bold text-white">
                Claim
              </button>
            </div>
            <div className="text-[13px] text-white/60">
              {shortNumber(Math.floor(value))} / {shortNumber(target)}
            </div>
          </div>
        )
      })}
    </Modal>
  )
}

export function EventPanel() {
  const candy = useNet((s) => s.me?.candy ?? 0)
  const world = useNet((s) => s.world)
  const pct = Math.min(1, world.cauldron / Math.max(1, world.cauldronGoal))
  return (
    <Modal title="Haunted Event" width="min(620px, 94vw)">
      <div className="cartoon text-center text-[34px] text-[#ffb52e]">CANDY CAULDRON</div>
      <p className="text-center text-[16px] font-semibold text-white/80">
        Every crystal you dig up drops candy corn. Fill the cauldron together to summon the <span className="text-red-400">BLOODMOON</span>
        {' '}— a 5 minute weather that mutates crystals with <span className="text-red-400">Blood (x10)</span>!
      </p>
      <div className="my-4 h-9 overflow-hidden rounded-full border-[3px] border-[#111] bg-black/60">
        <div className="flex h-full items-center justify-center rounded-full bg-gradient-to-r from-[#ff8a1e] to-[#ffd23a]" style={{ width: `${Math.max(8, pct * 100)}%` }}>
          <span className="cartoon whitespace-nowrap text-[18px]">
            {shortNumber(world.cauldron)} / {shortNumber(world.cauldronGoal)}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-3">
        <CandyIcon size={40} />
        <span className="cartoon text-[30px] text-[#ffb52e]">{shortNumber(candy)}</span>
        <button type="button" disabled={!candy} onClick={() => act('deposit', { amount: candy })} className="btn btn-purple cartoon px-5 py-2 text-[24px]">
          Deposit all
        </button>
      </div>
      <p className="mt-3 text-center text-[14px] text-white/60">Candy corn also buys pickaxes at the PICKAXES stall.</p>
    </Modal>
  )
}

export function PassPanel() {
  const me = useNet((s) => s.me)
  if (!me) return null
  return (
    <Modal title="Frost Pass" width="min(900px, 94vw)">
      <p className="mb-3 text-center font-semibold text-white/80">
        Crystals mined: <span className="text-[#7fe6ff]">{me.crystalsMined}</span>. Each tier unlocks as you mine more.
      </p>
      <div className="scroll-thin flex gap-3 overflow-x-auto pb-2">
        {PASS_TIERS.map((t, i) => {
          const claimed = i < me.passClaimed
          const next = i === me.passClaimed
          const ready = next && me.crystalsMined >= t.need
          return (
            <div
              key={i}
              className={`flex w-[130px] shrink-0 flex-col items-center gap-1 rounded-xl border-2 p-2 ${
                claimed ? 'border-[#4cd964] bg-[#1d3a24]' : next ? 'border-white bg-[#1c2238]' : 'border-white/15 bg-[rgba(6,18,40,0.55)]'
              }`}
            >
              <span className="cartoon text-[20px]">TIER {i + 1}</span>
              <span className="text-[13px] font-bold text-white/70">{t.need} crystals</span>
              <span className="flex items-center gap-1 text-[17px] font-bold text-[#ffd23a]">
                {t.reward.cash ? money(t.reward.cash) : (
                  <>
                    <CandyIcon size={18} /> {t.reward.candy}
                  </>
                )}
              </span>
              <button
                type="button"
                disabled={!ready}
                onClick={() => act('claimPass')}
                className={`btn ${claimed ? 'btn-dark' : 'btn-green'} w-full py-1 text-[14px] font-bold text-white`}
              >
                {claimed ? 'Claimed' : ready ? 'Claim' : 'Locked'}
              </button>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Settings, Backpack, Players
// ---------------------------------------------------------------------------

export function SettingsPanel() {
  const preset = useQuality((s) => s.preset)
  const manual = useQuality((s) => s.manual)
  const muted = useUI((s) => s.muted)
  const { identity } = useBloxity()
  const name = identity?.displayName || identity?.username || 'Guest'
  return (
    <Modal title="Settings" width="min(620px, 94vw)">
      <div className="mb-4">
        <div className="mb-2 text-[18px] font-bold text-white">Graphics quality {manual ? '' : '(auto)'}</div>
        <div className="flex gap-2">
          {ORDER.map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => useQuality.getState().setPreset(p)}
              className={`btn flex-1 py-2 text-[18px] font-bold text-white ${preset === p ? 'btn-green' : 'btn-dark'}`}
            >
              {p}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[13px] text-white/60">LOW: no shadows, particles or weather effects. Auto-drops if FPS falls under 45.</p>
      </div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[18px] font-bold text-white">Sound</span>
        <button
          type="button"
          onClick={() => {
            setMuted(!muted)
            useUI.setState({ muted: !muted })
          }}
          className={`btn px-6 py-1 text-[18px] font-bold text-white ${muted ? 'btn-red' : 'btn-green'}`}
        >
          {muted ? 'Off' : 'On'}
        </button>
      </div>
      <div className="mb-4 rounded-xl bg-[rgba(6,18,40,0.55)] p-3">
        <div className="text-[13px] text-white/60">Playing as</div>
        <div className="text-[17px] font-bold text-white">{name}</div>
      </div>
      <div className="text-[14px] leading-6 text-white/75">
        <div className="mb-1 text-[16px] font-bold text-white">Controls</div>
        <b>WASD</b> move · <b>Space</b> jump · <b>Shift</b> sprint · <b>Left click (hold)</b> dig where you point: down, straight ahead into a wall, or up (the blue ball shows the bite; on touch, aim with the camera) · <b>Right drag</b> camera ·{' '}
        <b>Scroll</b> zoom · <b>E</b> pick up / open stall · <b>1-0</b> hotbar · <b>Q/E</b> rotate placement · <b>H</b> go home
      </div>
    </Modal>
  )
}

export function BackpackPanelModal() {
  const me = useNet((s) => s.me)
  if (!me) return null
  const total = me.backpack.reduce((a, it) => a + it.value, 0)
  return (
    <Modal title={`Backpack  ${money(total)}`} width="min(760px, 94vw)">
      {me.backpack.length === 0 && <p className="text-center text-white/70">Empty. Dig on the mountain to find crystals!</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
        {me.backpack.map((it) => {
          const c = CRYSTAL_BY_ID[it.type]
          return (
            <div key={it.uid} className="flex items-center gap-2 rounded-lg bg-[rgba(6,18,40,0.55)] p-2">
              <ItemIcon item={it} size={42} />
              <div className="flex-1 text-[13px] font-bold text-white">
                {it.kind === 'crystal' ? c?.name : `${it.type} ${it.kind}`}
                {it.kind === 'crystal' && (
                  <div className="text-white/60">
                    <span style={{ color: RARITIES[c?.rarity ?? 0].color }}>{SIZES[it.size]?.name}</span> · {kg(it.weight)} ·{' '}
                    <span className="text-[#ffd23a]">{money(it.value)}</span>
                    {it.mutation && <span style={{ color: MUTATIONS[it.mutation]?.color }}> · {it.mutation}</span>}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

export function PlayersPanel() {
  const players = useNet((s) => s.players)
  const me = useNet((s) => s.me)
  const roomId = useNet((s) => s.roomId)
  return (
    <Modal title={`Players ${players.length + (me ? 1 : 0)}/${MAX_PLAYERS}`} width="min(520px, 94vw)">
      <p className="mb-2 text-[13px] text-white/50">Server {roomId ?? '-'}</p>
      {me && (
        <div className="flex justify-between border-b border-white/10 py-2 text-[18px] font-bold text-[#7fe6ff]">
          <span>{me.name} (you)</span>
          <span>Plot {me.plot + 1}</span>
        </div>
      )}
      {players.map((p) => (
        <div key={p.id} className="flex justify-between border-b border-white/10 py-2 text-[18px] font-bold text-white">
          <span>{p.name}</span>
          <span>Plot {p.plot + 1}</span>
        </div>
      ))}
    </Modal>
  )
}
