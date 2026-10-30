import { useEffect } from 'react'
import { create } from 'zustand'

import { GATE, PLAZA, plotContains, PLOTS, STALLS } from '@shared/world.js'
import { net, useNet } from '../net/net'
import { useUI } from '../store/ui'
import { sfx } from './audio'
import { hotbarItems, itemInSlot } from './hotbar'
import { localPlayer } from './localPlayer'
import { surfaceAt as surfaceHeight } from './terrain/solid'

/**
 * The first-time guide: mine two crystals, carry them home, sell one and plant the
 * other in your garden. Each step says what to do, a 3D arrow over the world points
 * where to go (or an arrow at the screen edge when it's off-screen), and a bouncing
 * arrow points at the button to press. Shown once per browser, to brand-new miners;
 * progress is remembered, so leaving halfway resumes at the same step.
 */

export const STEPS = ['mountain', 'mine', 'base', 'sell', 'garden', 'done']
/** Steps the player sees as "Step n of 5" (the last one is the celebration). */
export const STEP_COUNT = STEPS.length - 1
const CRYSTALS_TO_MINE = 2
const KEY = 'ma.tutorial'
const SELL = STALLS.find((s) => s.id === 'sell')

export const useTutorial = create(() => ({
  /** Index into STEPS, or -1 when the guide isn't running. */
  step: -1,
  title: '',
  /** CSS selector of the button the bouncing arrow points at (and rings), or null. */
  pointTo: null,
  /** A second button to press after the first (e.g. pick a crystal, THEN "sell this one"). */
  pointToAlso: null,
  /** Point a "click here" at the spot your pickaxe will hit (on the mountain). */
  pointAim: false,
  /** Point a "tap here" at the spot in your garden where the crystal will be planted. */
  pointPlace: false,
  /** Show the welcome card (a brand-new miner, before the first step). */
  welcome: false,
  /** Bumped each time a step is completed: the UI pops a "done!" for it. */
  doneFlash: 0,
  /** Phones: show the hotbar even with the menus tucked away (a slot is the target). */
  showHotbar: false,
}))

/** Where the 3D arrow hovers (read every frame by TutorialArrow; no React). */
export const tutorialTarget = { active: false, x: 0, y: 0, z: 0 }

/**
 * The way there, as waypoints on the ground ([x, z] pairs, last = the goal): the
 * glowing arrow trail runs from the player through them. Routed around what's in the
 * way - in through a garden's entrance, up to the front of a stall, out of the gate.
 */
export const tutorialPath = { n: 0, x: new Float32Array(4), z: new Float32Array(4) }

function setPath(...points) {
  tutorialPath.n = points.length
  points.forEach(([x, z], i) => {
    tutorialPath.x[i] = x
    tutorialPath.z[i] = z
  })
}

const save = (value) => {
  try {
    localStorage.setItem(KEY, String(value))
  } catch {
    /* storage unavailable: the guide simply won't be remembered */
  }
}
const load = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function skipTutorial() {
  save('done')
  tutorialTarget.active = false
  tutorialPath.n = 0
  useTutorial.setState({ step: -1, pointTo: null, pointToAlso: null, pointAim: false, pointPlace: false, showHotbar: false, welcome: false })
}

const touchControls = () => Boolean(document.querySelector('[data-hud="action"]'))
const crystalsIn = (me) => me.backpack.filter((it) => it.kind === 'crystal').length
/** Selector for the hotbar slot holding your first crystal, or null. */
function crystalSlot(me) {
  const i = hotbarItems(me).findIndex((it) => it.kind === 'crystal')
  return i < 0 ? null : `[data-tut="slot-${i + 1}"]`
}
const inPlaza = (x, z) => x > PLAZA.minX && x < PLAZA.maxX && z > PLAZA.minZ && z < PLAZA.maxZ

/** The nearest loose crystal you may pick up, within 40 m, for the arrow. */
function nearestLooseCrystal() {
  const crystals = net.room?.state?.crystals
  if (!crystals) return null
  const me = net.room.sessionId
  let best = null
  let bestD = 40 * 40
  crystals.forEach((c) => {
    if (c.state !== 1 || (c.owner && c.owner !== me)) return
    const d = (c.x - localPlayer.x) ** 2 + (c.z - localPlayer.z) ** 2
    if (d < bestD) {
      bestD = d
      best = c
    }
  })
  return best
}

function setTarget(x, y, z) {
  tutorialTarget.active = true
  tutorialTarget.x = x
  tutorialTarget.y = y
  tutorialTarget.z = z
}

/** Up the slope past the gate: where every "go and mine" arrow leads. */
function toMountain() {
  const z = PLAZA.minZ - 30
  setTarget(GATE.x, surfaceHeight(GATE.x, z), z)
  setPath([GATE.x, z])
}
/** At (or near) the base, rather than out on the mountain. */
const atBase = (ui) => !ui.onMountain && localPlayer.z > PLAZA.minZ - 14

/** What the current step shows right now: its words, its arrows, and whether it's done. */
function evaluate(step, me, ui, start) {
  const touch = touchControls()
  const held = itemInSlot(me, ui.slot)
  const holdingCrystal = held?.kind === 'crystal'
  const tap = touch ? 'Tap' : 'Click'
  tutorialTarget.active = false
  tutorialPath.n = 0
  // Each step is one short line: the arrows on the ground and on the buttons do the rest.
  switch (STEPS[step]) {
    case 'mountain':
      // A little way up the slope, past the gate. Through the gate counts as there.
      toMountain()
      return { done: !atBase(ui), title: 'Follow the arrows to the mountain', pointTo: null }
    case 'mine': {
      const n = Math.min(CRYSTALS_TO_MINE, crystalsIn(me))
      // Back at the base (a reload, a trip home): the arrows lead out again first.
      if (atBase(ui) && n < CRYSTALS_TO_MINE) {
        toMountain()
        return { done: false, title: `Follow the arrows to the mountain (${n}/${CRYSTALS_TO_MINE})`, pointTo: null }
      }
      const loose = nearestLooseCrystal()
      const pickup = ui.prompt?.kind === 'pickup'
      // Standing at it already: the "E PICK UP" on the crystal says it all.
      if (loose && !pickup) {
        setTarget(loose.x, loose.y + 0.6, loose.z)
        setPath([loose.x, loose.z])
      }
      const count = ` (${n}/${CRYSTALS_TO_MINE})`
      return {
        done: n >= CRYSTALS_TO_MINE,
        title: pickup
          ? `${touch ? 'Tap PICK UP' : 'Press E'} to take the crystal${count}`
          : loose
            ? `Follow the arrows to your crystal${count}`
            : `${tap} the mountain to dig crystals${count}`,
        pointTo: pickup ? '[data-hud="interact"]' : touch ? '[data-hud="action"]' : null,
        // Digging: a "click here" right on the spot the pickaxe will hit.
        pointAim: !pickup && !loose,
      }
    }
    case 'base':
      // Walking home works too: the trail leads back through the gate.
      setPath([GATE.x, GATE.z + 10])
      return {
        done: !ui.onMountain && inPlaza(localPlayer.x, localPlayer.z),
        title: `${tap} BASE to go home`,
        pointTo: '[data-tut="base"]',
      }
    case 'sell': {
      const slot = crystalSlot(me)
      // Nothing to sell: back out to dig one.
      if (!slot) {
        if (atBase(ui)) {
          toMountain()
          return { done: false, title: 'You need a crystal to sell: follow the arrows to the mountain', pointTo: null }
        }
        return { done: false, title: `${tap} the mountain to dig a crystal`, pointTo: touch ? '[data-hud="action"]' : null, pointAim: true }
      }
      setTarget(SELL.x, 0, SELL.z)
      setPath([SELL.x, SELL.z + 3.5])
      let title = 'Follow the arrows to SELL'
      let pointTo = null
      let pointToAlso = null
      if (ui.sellDialog) {
        if (holdingCrystal) {
          title = 'Now choose "Just sell this one"'
          pointTo = '[data-tut="sell-one"]'
        } else if (slot) {
          // Two steps, in order: a crystal in your hand first, then the option for it.
          title = 'Pick a crystal below, then "Just sell this one"'
          pointTo = slot
          pointToAlso = '[data-tut="sell-one"]'
        } else {
          title = 'You need a crystal to sell: go and mine one'
        }
      }
      return { done: me.totalSold > start.sold, title, pointTo, pointToAlso }
    }
    case 'garden': {
      const plot = PLOTS[me.plot]
      const inside = plot && plotContains(me.plot, localPlayer.x, localPlayer.z, -1)
      const slot = crystalSlot(me)
      const done = me.garden.length > start.garden
      // No crystal left (both sold, say): one more from the mountain first.
      if (!slot) {
        const loose = nearestLooseCrystal()
        if (atBase(ui)) {
          toMountain()
          return { done, title: 'Dig one more crystal for your garden: follow the arrows', pointTo: null }
        }
        const pickup = ui.prompt?.kind === 'pickup'
        if (loose && !pickup) {
          setTarget(loose.x, loose.y + 0.6, loose.z)
          setPath([loose.x, loose.z])
        }
        return {
          done,
          title: pickup ? `${touch ? 'Tap PICK UP' : 'Press E'} to take the crystal` : loose ? 'Follow the arrows to your crystal' : `${tap} the mountain to dig one more crystal`,
          pointTo: pickup ? '[data-hud="interact"]' : touch && !loose ? '[data-hud="action"]' : null,
          pointAim: !pickup && !loose,
        }
      }
      // Arrows lead there; once you're inside, the "tap here" on the spot takes over.
      if (plot && !inside) {
        setTarget(plot.x, 0, plot.z)
        setPath([plot.x, plot.z])
      }
      const title = !inside
        ? 'Follow the arrows to your garden'
        : holdingCrystal
          ? `${tap} inside your garden to plant it`
          : 'Pick your crystal in the hotbar'
      return {
        done,
        title,
        pointTo: inside && !holdingCrystal ? slot : null,
        // Holding it in your garden: a "tap here" on the green spot it'll go.
        pointPlace: inside && holdingCrystal,
      }
    }
    default:
      return { done: false, title: "You're a real miner now!", pointTo: null }
  }
}

/** Runs the guide (from App): starts it for new miners and moves it along. */
export function useTutorialDriver() {
  useEffect(() => {
    /** Baselines for "sell one" and "plant one", taken when the guide starts. */
    const start = { sold: 0, garden: 0 }
    let decided = false
    let doneTimer = null

    const begin = (step, me) => {
      start.sold = me.totalSold
      start.garden = me.garden.length
      useTutorial.setState({ step })
    }

    const id = setInterval(() => {
      const me = useNet.getState().me
      if (!me) return
      if (!decided) {
        decided = true
        const saved = load()
        if (saved === 'done') return
        // (Number(null) is 0: a brand-new miner has nothing saved, which isn't step 0.)
        const resume = saved === null ? NaN : Number(saved)
        if (Number.isInteger(resume) && resume >= 0 && resume < STEPS.length - 1) begin(resume, me)
        else if (me.crystalsMined === 0 && me.totalSold === 0 && me.garden.length === 0) {
          begin(0, me)
          // A brand-new miner: a word of welcome before the first arrow.
          useTutorial.setState({ welcome: true })
        }
        else save('done')
        return
      }
      const { step } = useTutorial.getState()
      if (step < 0) return
      const ui = useUI.getState()
      const view = evaluate(step, me, ui, start)
      const next = {
        title: view.title,
        pointTo: view.pointTo,
        pointToAlso: view.pointToAlso ?? null,
        pointAim: Boolean(view.pointAim),
        pointPlace: Boolean(view.pointPlace),
        showHotbar: Boolean(view.pointTo?.includes('slot-') || view.pointToAlso?.includes('slot-')),
      }
      const cur = useTutorial.getState()
      if (
        next.title !== cur.title ||
        next.pointTo !== cur.pointTo ||
        next.pointToAlso !== cur.pointToAlso ||
        next.pointAim !== cur.pointAim ||
        next.pointPlace !== cur.pointPlace ||
        next.showHotbar !== cur.showHotbar
      ) {
        useTutorial.setState(next)
      }
      if (!view.done) return
      // On to the next step.
      const after = step + 1
      if (STEPS[after] === 'sell') start.sold = me.totalSold
      if (STEPS[after] === 'garden') start.garden = me.garden.length
      if (STEPS[after] === 'done') sfx.find(4)
      else sfx.chime()
      useTutorial.setState((s) => ({ doneFlash: s.doneFlash + 1, welcome: false }))
      if (STEPS[after] === 'done') {
        save('done')
        const fin = evaluate(after, me, ui, start)
        tutorialTarget.active = false
        tutorialPath.n = 0
        useTutorial.setState({ step: after, title: fin.title, pointTo: null, pointToAlso: null, pointAim: false, pointPlace: false, showHotbar: false })
        doneTimer = setTimeout(() => useTutorial.setState({ step: -1 }), 6000)
      } else {
        save(after)
        useTutorial.setState({ step: after })
      }
    }, 250)

    return () => {
      clearInterval(id)
      clearTimeout(doneTimer)
    }
  }, [])
}
