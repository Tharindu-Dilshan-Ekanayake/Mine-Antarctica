import { useEffect, useRef } from 'react'

import { aimPointer, edgeArrow } from '../game/TutorialArrow'
import { skipTutorial, STEP_COUNT, STEPS, useTutorial } from '../game/tutorial'

const COARSE = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

/**
 * A ring round the button matching `selector`, and a bouncing label over it (or under
 * it, near the top of the screen). Follows the button as it moves, scales or appears.
 */
function PointerMark({ selector, label }) {
  const pointerRef = useRef(null)
  const ringRef = useRef(null)

  useEffect(() => {
    const el = pointerRef.current
    const ring = ringRef.current
    if (!el || !ring) return undefined
    const hide = () => {
      el.style.opacity = '0'
      ring.style.opacity = '0'
    }
    if (!selector) {
      hide()
      return undefined
    }
    const place = () => {
      const target = [...document.querySelectorAll(selector)].find((n) => n.getBoundingClientRect().width > 0)
      if (!target) {
        hide()
        return
      }
      const r = target.getBoundingClientRect()
      ring.style.transform = `translate(${r.left - 6}px, ${r.top - 6}px)`
      ring.style.width = `${r.width + 12}px`
      ring.style.height = `${r.height + 12}px`
      ring.style.borderRadius = getComputedStyle(target).borderRadius === '50%' ? '50%' : '18px'
      ring.style.opacity = '1'
      // In the top-right button column: beside the button, pointing at it from the left.
      const inColumn = Boolean(target.closest('[data-hud="phonebar"]')) && window.innerHeight > window.innerWidth
      el.dataset.side = inColumn ? 'left' : ''
      // Otherwise above the button, pointing down - or below it when it's at the top of the screen.
      const below = !inColumn && r.top < 90
      el.dataset.below = below ? 'true' : 'false'
      el.style.transform = inColumn
        ? `translate(${r.left - 8}px, ${r.top + r.height / 2}px)`
        : `translate(${r.left + r.width / 2}px, ${below ? r.bottom + 6 : r.top - 6}px)`
      el.style.opacity = '1'
    }
    place()
    const id = setInterval(place, 200)
    return () => clearInterval(id)
  }, [selector])

  return (
    <>
      <div ref={ringRef} className="tut-ring" style={{ opacity: 0 }} />
      <div ref={pointerRef} className="tut-pointer" style={{ opacity: 0 }}>
        <span className="tut-pointer-label">{label}</span>
        <span className="tut-pointer-arrow" />
      </div>
    </>
  )
}

/**
 * The first-time guide on screen: one small line at the top saying what to do, a
 * bouncing "TAP HERE" arrow on the button to press, and an arrow on the screen edge
 * when the place to go is out of view (the trail on the ground is TutorialArrow's). The arrows are moved straight in the DOM, never through React renders.
 */
export default function Tutorial() {
  const step = useTutorial((s) => s.step)
  const title = useTutorial((s) => s.title)
  const pointTo = useTutorial((s) => s.pointTo)
  const pointToAlso = useTutorial((s) => s.pointToAlso)
  const welcome = useTutorial((s) => s.welcome)
  const doneFlash = useTutorial((s) => s.doneFlash)
  const edgeRef = useRef(null)
  const aimRef = useRef(null)

  useEffect(() => {
    edgeArrow.el = edgeRef.current
    aimPointer.el = aimRef.current
    return () => {
      edgeArrow.el = null
      aimPointer.el = null
    }
  }, [step])

  const label = COARSE ? 'TAP HERE' : 'CLICK HERE'
  if (step < 0) return null
  const finished = STEPS[step] === 'done'

  return (
    <div className="pointer-events-none absolute inset-0 z-[25]">
      {welcome && (
        <div className="tut-welcome-wrap pointer-events-auto">
          <div className="tut-welcome snowcap pop-in">
            <div className="panel px-6 pb-5 pt-5 text-center">
              <div className="tut-welcome-icon" aria-hidden>
                ⛏
              </div>
              <h2 className="cartoon text-[30px] leading-tight text-white">Welcome, miner!</h2>
              <ol className="tut-welcome-steps">
                <li>
                  <b>Dig</b> the mountain to find crystals
                </li>
                <li>
                  <b>Sell</b> them at the base for cash
                </li>
                <li>
                  <b>Plant</b> the best ones in your garden
                </li>
              </ol>
              <p className="tut-welcome-hint">Just follow the yellow arrows!</p>
              <button
                type="button"
                className="btn btn-green cartoon mt-3 h-12 w-full text-[22px] text-white"
                onClick={() => useTutorial.setState({ welcome: false })}
              >
                LET&apos;S GO!
              </button>
            </div>
          </div>
        </div>
      )}
      {doneFlash > 0 && !finished && (
        <div key={doneFlash} className="tut-done-pop" aria-hidden>
          ✓ Nice!
        </div>
      )}
      {/* One small line at the top: the arrows on the ground and the buttons show the way. */}
      <div data-hud="tutorial" className={`tut-card pointer-events-auto ${finished ? 'tut-done' : ''}`} key={`${step}:${title}`}>
        {finished ? (
          <span className="tut-badge">★</span>
        ) : (
          <span className="tut-dots" aria-label={`Step ${step + 1} of ${STEP_COUNT}`}>
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span key={i} className={i < step ? 'done' : i === step ? 'now' : ''} />
            ))}
          </span>
        )}
        <span className="tut-title">{title}</span>
        {!finished && (
          <button type="button" className="tut-skip" onClick={skipTutorial} aria-label="Skip the guide" title="Skip the guide">
            ✕
          </button>
        )}
      </div>
      {/* The button(s) to press: a ring round each, with a bouncing label. Two in a row
          are numbered, so the order is clear. */}
      <PointerMark selector={pointTo} label={pointToAlso ? '1 · FIRST' : label} />
      <PointerMark selector={pointToAlso} label="2 · THEN THIS" />
      <div ref={edgeRef} className="tut-edge" style={{ opacity: 0 }} />
      <div ref={aimRef} className="tut-pointer tut-aim" style={{ opacity: 0 }}>
        <span className="tut-pointer-label">{COARSE ? 'TAP HERE' : 'CLICK HERE'}</span>
        <span className="tut-pointer-arrow" />
      </div>
    </div>
  )
}
