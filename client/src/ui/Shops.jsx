import { useState } from 'react'

import {
  BOMBS,
  LEVEL_UPGRADES,
  levelCost,
  levelSeries,
  moveMultiplier,
  PICKAXES,
  RADARS,
  RARITIES,
  safeAltitude,
  swingTime,
  upgradeCost,
} from '@shared/catalog.js'
import { clock, money, shortNumber } from '@shared/format.js'
import { digRadius, MOUNTAIN } from '@shared/world.js'
import { sfx } from '../game/audio'
import { send, useNet } from '../net/net'
import { BombIcon, CandyIcon, PickaxeIcon, RadarIcon } from './icons'
import Modal, { RarityTag } from './Modal'
import useNow from './useNow'

const buy = (type, payload) => {
  sfx.buy()
  send(type, payload)
}

const MAX_POWER = Math.max(...PICKAXES.map((p) => p.power))
const MAX_RADIUS = Math.max(...PICKAXES.map((p) => digRadius(p)))

function StatBar({ label, value, fill, color }) {
  return (
    <div className="mb-1">
      <div className="flex justify-between">
        <span className="cartoon text-[18px]">{label}</span>
        <span className="cartoon text-[18px]">{value}</span>
      </div>
      <div className="h-[12px] overflow-hidden rounded-full border-2 border-[#141824] bg-black/40">
        <div className="h-full rounded-full" style={{ width: `${Math.max(6, Math.sqrt(fill) * 100)}%`, background: color }} />
      </div>
    </div>
  )
}

export function PickaxeList() {
  const me = useNet((s) => s.me)
  if (!me) return null
  return (
    <div className="scroll-thin flex gap-3 overflow-x-auto pb-3">
      {PICKAXES.map((p) => {
        const owned = me.owned.includes(p.id)
        const equipped = me.pickaxe === p.id
        return (
          <div
            key={p.id}
            className="shine relative flex h-[420px] w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border-4 border-[#e9ecf3] p-3"
            style={{ background: 'linear-gradient(#f4f6fb, #c9ced9)' }}
          >
            <div className="cartoon text-[26px] leading-tight">{p.name}</div>
            <div className="cartoon text-[22px]" style={{ color: RARITIES[p.rarity].color }}>
              {RARITIES[p.rarity].name}
            </div>
            <div className="flex flex-1 items-center justify-center">
              <div className="pick-float">
                <PickaxeIcon id={p.id} size={170} />
              </div>
            </div>
            <StatBar label="Power" value={shortNumber(p.power)} fill={p.power / MAX_POWER} color="#ff7a3d" />
            <StatBar
              label="Tunnel"
              value={`${(digRadius(p) * 2).toFixed(1)}m`}
              fill={digRadius(p) / MAX_RADIUS}
              color="#3db8ff"
            />
            <div className="mt-2 flex gap-2">
              {equipped ? (
                <button type="button" className="btn btn-yellow cartoon h-14 flex-1 text-[26px]">
                  Equipped
                </button>
              ) : owned ? (
                <button type="button" className="btn btn-blue cartoon h-14 flex-1 text-[26px]" onClick={() => buy('buyPickaxe', { id: p.id })}>
                  Equip
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-green cartoon h-14 flex-1 text-[26px]"
                    disabled={me.cash < p.price}
                    onClick={() => buy('buyPickaxe', { id: p.id, currency: 'cash' })}
                  >
                    {money(p.price)}
                  </button>
                  <button
                    type="button"
                    className="btn btn-purple cartoon flex h-14 flex-1 items-center justify-center gap-1 text-[24px]"
                    disabled={me.candy < p.candy}
                    onClick={() => buy('buyPickaxe', { id: p.id, currency: 'candy' })}
                  >
                    <CandyIcon size={24} /> {p.candy}
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function UpgradeButton({ label, cost, cash, onClick }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <span className="cartoon text-[22px]">{label}</span>
      <button type="button" disabled={cost > cash || cost <= 0} onClick={onClick} className="btn btn-green cartoon h-14 w-full text-[26px]">
        {money(cost)}
      </button>
    </div>
  )
}

/** A Mine Faster / Run Faster card: level, what it does now, +1 / +5 / MAX. */
function LevelCard({ kind, title, tagline, icon, gradient, effect }) {
  const me = useNet((s) => s.me)
  if (!me) return null
  const field = kind === 'swing' ? 'swingLvl' : 'speedLvl'
  const level = me[field] ?? 0
  const { max } = LEVEL_UPGRADES[kind]
  const maxed = level >= max
  const five = levelSeries(kind, level, me.cash, 5)
  const all = levelSeries(kind, level, me.cash)
  return (
    <div className="relative overflow-hidden rounded-xl border-4 border-[#e9ecf3] p-4" style={{ background: gradient }}>
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-black/40 bg-black/50 text-[46px]">{icon}</div>
        <div className="flex-1">
          <div className="cartoon text-[30px]">
            {title} <span className="text-[#ffe14a]">Lv {level}/{max}</span>
          </div>
          <div className="cartoon text-[20px] text-white/90">{tagline}</div>
        </div>
        <div className="cartoon-thin text-right text-[18px] font-bold text-white">{effect(level)}</div>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full border-2 border-[#141824] bg-black/40">
        <div className="h-full rounded-full bg-[#ffe14a]" style={{ width: `${(level / max) * 100}%` }} />
      </div>
      {maxed ? (
        <div className="cartoon mt-3 text-center text-[26px] text-[#ffe14a]">MAXED OUT!</div>
      ) : (
        <div className="mt-3 flex gap-3">
          <UpgradeButton label="+1" cost={levelCost(kind, level)} cash={me.cash} onClick={() => buy('buyUpgrade', { kind, amount: 1 })} />
          <UpgradeButton label={`+${five.count}`} cost={five.cost} cash={me.cash} onClick={() => buy('buyUpgrade', { kind, amount: 5 })} />
          <UpgradeButton label={`MAX +${all.count}`} cost={all.cost} cash={me.cash} onClick={() => buy('buyUpgrade', { kind, amount: 'max' })} />
        </div>
      )}
    </div>
  )
}

export function UpgradesPanel() {
  const me = useNet((s) => s.me)
  const [custom, setCustom] = useState('')
  if (!me) return null
  const w = me.warmth
  const kg = Math.round(me.backpackCap)
  const wMax = upgradeCost.warmthMax(w, me.cash)
  const bMax = upgradeCost.backpackMax(kg, me.cash)
  const reach = Math.min(100, Math.round((safeAltitude(w) / MOUNTAIN.peak) * 100))
  const customN = Math.max(0, Math.floor(Number(custom) || 0))
  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-xl border-4 border-[#e9ecf3] p-4" style={{ background: 'linear-gradient(90deg,#e8261b,#ff5a1f)' }}>
        <div className="flex items-center gap-3">
          <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-black/40 bg-black/50 text-[46px]">{'🔥'}</div>
          <div className="flex-1">
            <div className="cartoon text-[30px]">
              {w} ({Math.round(safeAltitude(w))}m safe)
            </div>
            <div className="cartoon text-[24px] text-[#ffe14a]">CLIMB HIGHER!</div>
          </div>
          <div className="cartoon-thin text-right text-[18px] font-bold text-white">
            You can reach <span className="text-[#ffe14a]">{reach}%</span> of this mountain!
          </div>
        </div>
        <div className="mt-3 flex gap-3">
          <UpgradeButton label="+10" cost={upgradeCost.warmth(w, 10)} cash={me.cash} onClick={() => buy('buyUpgrade', { kind: 'warmth', amount: 10 })} />
          <UpgradeButton label="+50" cost={upgradeCost.warmth(w, 50)} cash={me.cash} onClick={() => buy('buyUpgrade', { kind: 'warmth', amount: 50 })} />
          <UpgradeButton label={`MAX +${shortNumber(wMax.count)}`} cost={wMax.cost} cash={me.cash} onClick={() => buy('buyUpgrade', { kind: 'warmth', amount: 'max' })} />
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border-4 border-[#e9ecf3] p-4" style={{ background: 'linear-gradient(90deg,#1f6fe0,#2f8bff)' }}>
        <div className="flex items-center gap-3">
          <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-black/40 bg-black/50 text-[46px]">{'🎒'}</div>
          <div className="flex-1">
            <div className="cartoon text-[30px]">{kg} kg</div>
            <div className="cartoon text-[24px] text-[#7fe6ff]">CARRY MORE!</div>
          </div>
        </div>
        <div className="mt-3 flex gap-3">
          <UpgradeButton label="+1 kg" cost={upgradeCost.backpack(kg, 1)} cash={me.cash} onClick={() => buy('buyUpgrade', { kind: 'backpack', amount: 1 })} />
          <UpgradeButton label="+50 kg" cost={upgradeCost.backpack(kg, 50)} cash={me.cash} onClick={() => buy('buyUpgrade', { kind: 'backpack', amount: 50 })} />
          <UpgradeButton label={`MAX +${shortNumber(bMax.count)}`} cost={bMax.cost} cash={me.cash} onClick={() => buy('buyUpgrade', { kind: 'backpack', amount: 'max' })} />
          <div className="flex flex-1 flex-col items-center gap-1">
            <label className="flex w-full items-center justify-center gap-1 rounded-lg border-2 border-white bg-[rgba(6,18,40,0.75)] px-2">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))}
                placeholder="CUSTOM"
                className="w-full bg-transparent py-1 text-center text-[18px] font-bold text-[#7fe6ff] outline-none placeholder:text-[#7fe6ff]/70"
                inputMode="numeric"
              />
              <span className="font-bold text-white">kg</span>
            </label>
            <button
              type="button"
              disabled={!customN || upgradeCost.backpack(kg, customN) > me.cash}
              onClick={() => buy('buyUpgrade', { kind: 'backpack', amount: customN })}
              className="btn btn-green cartoon h-14 w-full text-[24px]"
            >
              {customN ? money(upgradeCost.backpack(kg, customN)) : '$--'}
            </button>
          </div>
        </div>
      </div>

      <LevelCard
        kind="swing"
        title="Mine Faster"
        tagline="SWING QUICKER!"
        icon={'⛏️'}
        gradient="linear-gradient(90deg,#7a2cff,#c45cff)"
        effect={(lvl) => `${(1 / swingTime(lvl)).toFixed(1)} swings / sec`}
      />
      <LevelCard
        kind="speed"
        title="Run Faster"
        tagline="SHORTER TRIPS TO SELL!"
        icon={'👟'}
        gradient="linear-gradient(90deg,#14a34a,#5cdc3a)"
        effect={(lvl) => `${Math.round(moveMultiplier(lvl) * 100)}% speed`}
      />
    </div>
  )
}

function StockList({ kind, items }) {
  const me = useNet((s) => s.me)
  const stock = useNet((s) => s.world.stock)
  return (
    <div className="flex flex-col gap-3">
      {items.map((it) => {
        const left = stock[`${kind}:${it.id}`] ?? 0
        const gradient = ['linear-gradient(90deg,#5a7bb0,#8aa6d6)', 'linear-gradient(90deg,#2a8be0,#7fd3ff)', 'linear-gradient(90deg,#b07a3a,#d9b07a)', 'linear-gradient(90deg,#ff9a1a,#ff4a2a)'][
          kind === 'bomb' ? BOMBS.indexOf(it) : RADARS.indexOf(it) + 1
        ]
        return (
          <button
            type="button"
            key={it.id}
            disabled={!left || !me || me.cash < it.price}
            onClick={() => buy('buyItem', { kind, id: it.id })}
            className="shine relative flex items-center gap-4 overflow-hidden rounded-xl border-4 border-[#e9ecf3] p-3 text-left transition hover:brightness-110 disabled:cursor-not-allowed"
            style={{ background: gradient }}
          >
            <div className="flex h-24 w-24 shrink-0 items-center justify-center">
              {kind === 'bomb' ? <BombIcon color={it.color} size={90} /> : <RadarIcon color={it.color} size={90} />}
            </div>
            <div className="flex-1">
              <div className="cartoon text-[32px] leading-none">{it.name}</div>
              <div className="cartoon-thin mt-1 text-[15px] font-semibold text-white">{it.desc}</div>
              <div className="mt-1 flex items-end justify-between">
                <div>
                  <div className="cartoon text-[20px]">X{left} Stock</div>
                  <div className={`cartoon text-[22px] ${left ? 'text-[#5cff6e]' : 'text-[#ff3b3b]'}`}>{left ? money(it.price) : 'No Stock'}</div>
                </div>
                <RarityTag rarity={it.rarity} className="!text-[24px]" />
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function RestockTimer() {
  const now = useNow()
  const restockAt = useNet((s) => s.world.restockAt)
  return (
    <div className="flex items-center rounded-lg border-2 border-[#2a2e3a] bg-[rgba(6,18,40,0.7)] px-4">
      <span className="cartoon text-[28px] text-[#5cff6e]">{restockAt ? clock((restockAt - now) / 1000) : '--:--'}</span>
    </div>
  )
}

export function BombShop() {
  return (
    <Modal title="Bombs Shop" width="min(600px, 94vw)" headerExtra={<RestockTimer />}>
      <StockList kind="bomb" items={BOMBS} />
    </Modal>
  )
}

export function RadarShop() {
  return (
    <Modal title="Radar Shop" width="min(600px, 94vw)" headerExtra={<RestockTimer />}>
      <StockList kind="radar" items={RADARS} />
    </Modal>
  )
}

export function PickaxeShop() {
  return (
    <Modal title="Pickaxe Shop">
      <PickaxeList />
    </Modal>
  )
}

export function UpgradeShop() {
  return (
    <Modal title="Upgrade!" width="min(1040px, 96vw)">
      <UpgradesPanel />
    </Modal>
  )
}

const TABS = [
  ['pickaxes', 'PICKAXES', '#1aa3ff'],
  ['upgrades', 'UPGRADES', '#2ec43c'],
  ['bombs', 'BOMBS', '#ff8a1a'],
  ['radars', 'RADARS', '#8b3dff'],
]

/** The SHOP button: every stall's stock in one place. */
export function ShopHub() {
  const [tab, setTab] = useState('pickaxes')
  return (
    <Modal title="Shop">
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([id, label, color]) => (
          <button
            type="button"
            key={id}
            onClick={() => setTab(id)}
            className="cartoon btn px-4 py-1 text-[24px]"
            style={{ background: tab === id ? color : '#2a2e3a' }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'pickaxes' && <PickaxeList />}
      {tab === 'upgrades' && <UpgradesPanel />}
      {tab === 'bombs' && <StockList kind="bomb" items={BOMBS} />}
      {tab === 'radars' && <StockList kind="radar" items={RADARS} />}
    </Modal>
  )
}
