import { useProgress } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'

import { CRYSTAL_BY_ID } from '@shared/catalog.js'
import { money } from '@shared/format.js'
import { sfx } from '../game/audio'
import { itemInSlot } from '../game/hotbar'
import { interact, startAction, stopAction } from '../game/interaction'
import { input } from '../game/localPlayer'
import { send, useNet } from '../net/net'
import { isTouchDevice } from '../store/quality'
import { useUI } from '../store/ui'
import { CssSnow } from './Juice'
import Modal from './Modal'

// ---------------------------------------------------------------------------
// SELL stall: NPC dialogue + confirm
// ---------------------------------------------------------------------------

export function SellDialog() {
  const open = useUI((s) => s.sellDialog)
  const me = useNet((s) => s.me)
  const slot = useUI((s) => s.slot)
  const [confirm, setConfirm] = useState(false)
  const [line, setLine] = useState('Hey there! Selling some crystals?')
  if (!open || !me) return null

  const crystals = me.backpack.filter((it) => it.kind === 'crystal')
  const total = crystals.reduce((a, it) => a + it.value, 0)
  const held = itemInSlot(me, slot)
  const heldCrystal = held?.kind === 'crystal' ? held : null
  const close = () => {
    setConfirm(false)
    setLine('Hey there! Selling some crystals?')
    useUI.setState({ sellDialog: false })
  }

  const options = [
    ['Sell all crystals', () => (crystals.length ? setConfirm(true) : setLine("You don't have any crystals!"))],
    [
      'Just sell this one',
      () => {
        if (!heldCrystal) return setLine('Hold the crystal you want to sell in your hotbar first!')
        sfx.click()
        send('sell', { mode: 'one', uid: heldCrystal.uid })
        setLine('Pleasure doing business!')
      },
    ],
    [
      "What's this worth?",
      () =>
        setLine(
          heldCrystal
            ? `That ${CRYSTAL_BY_ID[heldCrystal.type]?.name} is worth ${money(heldCrystal.value)}!`
            : `Your whole backpack is worth ${money(total)}.`,
        ),
    ],
    ['Goodbye', close],
  ]

  return (
    <>
      <div data-hud="sell" className="pointer-events-auto absolute right-[8vw] top-[42vh] z-20 flex flex-col gap-2">
        <div className="cartoon-thin mb-1 max-w-[340px] text-[19px] font-bold text-white">{line}</div>
        {options.map(([label, fn], i) => (
          <button type="button" key={label} onClick={fn} data-tut={i === 1 ? 'sell-one' : undefined} className="cartoon-thin text-left text-[22px] font-bold text-[#ffd23a] hover:text-white">
            {i + 1}.) [&quot;{label}&quot;]
          </button>
        ))}
      </div>
      {confirm && (
        <Modal title="Sell All Crystals?" width="min(520px, 92vw)" onClose={() => setConfirm(false)}>
          <div className="text-center">
            <div className="text-[20px] font-bold text-white">
              You are about to sell <span className="text-[#5ee0ff]">{crystals.length} crystals</span> for
            </div>
            <div className="cartoon my-2 text-[54px] text-[#ffd23a]">{money(total)}</div>
            <div className="mb-4 text-[17px] font-semibold text-white">This can&apos;t be undone!</div>
            <div className="flex gap-3">
              <button
                type="button"
                className="btn btn-green cartoon flex-1 py-3 text-[26px]"
                onClick={() => {
                  send('sell', { mode: 'all' })
                  setConfirm(false)
                  setLine('Pleasure doing business!')
                }}
              >
                SELL ALL
              </button>
              <button type="button" className="btn btn-red cartoon flex-1 py-3 text-[26px]" onClick={() => setConfirm(false)}>
                CANCEL
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Touch controls (always available on touch screens)
// ---------------------------------------------------------------------------

function Joystick() {
  const baseRef = useRef(null)
  const knobRef = useRef(null)
  const active = useRef(null)
  const RADIUS = 52

  const update = (e) => {
    const rect = baseRef.current.getBoundingClientRect()
    let dx = e.clientX - (rect.left + rect.width / 2)
    let dy = e.clientY - (rect.top + rect.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS
      dy = (dy / len) * RADIUS
    }
    knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`
    input.joyX = dx / RADIUS
    input.joyY = -dy / RADIUS
  }
  const end = () => {
    active.current = null
    input.joyX = 0
    input.joyY = 0
    if (knobRef.current) knobRef.current.style.transform = 'translate(0,0)'
  }

  return (
    <div
      ref={baseRef}
      data-hud="joystick" className="pointer-events-auto absolute bottom-[110px] left-[6vw] flex h-[130px] w-[130px] items-center justify-center rounded-full border-4 border-white/40 bg-black/25"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        active.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        update(e)
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div ref={knobRef} className="h-[58px] w-[58px] rounded-full border-4 border-white/70 bg-white/40" />
    </div>
  )
}

function HoldButton({ className, label, onDown, onUp, hud }) {
  return (
    <button
      type="button"
      data-hud={hud}
      className={`pointer-events-auto absolute flex items-center justify-center rounded-full border-4 border-white/60 bg-black/40 text-white ${className}`}
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        e.preventDefault()
        onDown?.()
      }}
      onPointerUp={() => onUp?.()}
      onPointerCancel={() => onUp?.()}
      onPointerLeave={() => onUp?.()}
    >
      {label}
    </button>
  )
}

export function TouchControls() {
  const [touch, setTouch] = useState(isTouchDevice)
  const prompt = useUI((s) => s.prompt)
  useEffect(() => {
    // A touch on a laptop with a touchscreen turns the controls on.
    const on = (e) => e.pointerType === 'touch' && setTouch(true)
    window.addEventListener('pointerdown', on)
    return () => window.removeEventListener('pointerdown', on)
  }, [])
  if (!touch) return null
  const promptLabel = prompt?.kind === 'pickup' ? 'PICK UP' : prompt?.kind === 'stall' ? 'OPEN' : prompt?.kind === 'rotate' ? 'ROTATE' : null
  return (
    <div className="pointer-events-none absolute inset-0 z-[15]">
      <Joystick />
      <HoldButton
        hud="action"
        className="bottom-[120px] right-[7vw] h-[96px] w-[96px] text-[40px]"
        label={'⛏️'}
        onDown={() => startAction(true)}
        onUp={stopAction}
      />
      <HoldButton
        hud="jump"
        className="bottom-[230px] right-[4vw] h-[66px] w-[66px] text-[15px] font-bold"
        label="JUMP"
        onDown={() => {
          input.jump = true
        }}
        onUp={() => {
          input.jump = false
        }}
      />
      {promptLabel && (
        <HoldButton
          hud="interact"
          className="bottom-[220px] right-[calc(7vw+90px)] h-[70px] w-[70px] text-[12px] font-bold !bg-[#14b80f]/80"
          label={promptLabel}
          onDown={interact}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading screen + context-lost overlay
// ---------------------------------------------------------------------------

export function LoadingScreen() {
  const { progress, active } = useProgress()
  const loaded = useUI((s) => s.loaded)
  const status = useNet((s) => s.status)
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (!loaded) return undefined
    const t = setTimeout(() => setHidden(true), 450)
    return () => clearTimeout(t)
  }, [loaded])
  if (hidden) return null
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-500 ${loaded ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: 'linear-gradient(#2f7fd8, #bfe1f7 70%, #eef4fb)' }}
    >
      <CssSnow />
      <div className="title-bounce cartoon text-center text-[64px] leading-none text-white">
        MINE
        <br />
        <span className="text-[#7fe6ff]">ANTARCTICA</span>
      </div>
      <div className="mt-8 h-5 w-[min(420px,80vw)] overflow-hidden rounded-full border-[3px] border-[#111] bg-black/40">
        <div className="h-full rounded-full bg-gradient-to-r from-[#3db8ff] to-[#7fe6ff] transition-[width]" style={{ width: `${active ? progress : 100}%` }} />
      </div>
      <div className="cartoon-thin mt-3 text-[18px] font-bold text-white">
        {status === 'connecting' ? 'Joining an expedition...' : active ? 'Loading avatar...' : 'Building the base...'}
      </div>
    </div>
  )
}

export function ContextLostOverlay() {
  const lost = useUI((s) => s.contextLost)
  if (!lost) return null
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 text-center text-white">
      <div>
        <div className="cartoon text-[36px]">Graphics paused</div>
        <p className="mt-2 font-semibold text-white/80">Your device reset the 3D view. Restoring...</p>
        <button type="button" className="btn btn-green mt-4 px-6 py-2 font-bold" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  )
}
