import { useEffect } from 'react'

import { useUI } from '../store/ui'
import { interact, rotateBack } from './interaction'
import { input, teleportHome } from './localPlayer'

/**
 * Global keyboard bindings. Movement keys write into the shared `input` object
 * (read every frame); one-shot keys (E, Q, digits, Esc) dispatch actions directly.
 */
const MOVE_KEYS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
}

const isTyping = (e) => {
  const t = e.target
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

export default function useKeyboard() {
  useEffect(() => {
    const clearMoves = () => {
      for (const action of Object.values(MOVE_KEYS)) input[action] = false
    }

    const onKeyDown = (e) => {
      if (isTyping(e)) return
      const ui = useUI.getState()
      const move = MOVE_KEYS[e.code]
      if (move) {
        e.preventDefault()
        input[move] = true
        return
      }
      if (e.repeat) return
      if (e.code === 'KeyE') interact()
      else if (e.code === 'KeyQ') rotateBack()
      else if (e.code === 'KeyH') teleportHome()
      else if (e.code === 'KeyV') ui.toggleCameraMode()
      else if (e.code === 'Escape') {
        if (ui.modal) ui.closeModal()
        else if (ui.sellDialog) useUI.setState({ sellDialog: false })
      } else if (/^Digit[0-9]$/.test(e.code)) {
        const n = Number(e.code.slice(5))
        // Keys 1..9,0 map to slots 0..9.
        ui.setSlot(n === 0 ? 9 : n - 1)
      }
    }
    const onKeyUp = (e) => {
      const move = MOVE_KEYS[e.code]
      if (move) input[move] = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    // Alt-tabbing away mid-run otherwise leaves a key stuck down.
    window.addEventListener('blur', clearMoves)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearMoves)
    }
  }, [])
}
