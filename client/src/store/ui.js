import { create } from 'zustand'

import { cameraState } from '../game/localPlayer'

/**
 * Local UI state. Never written from inside useFrame: the per-frame code writes to
 * plain objects (see game/localPlayer.js) and a low-rate ticker copies what the HUD
 * needs into here.
 */
let toastId = 0

/** Phones start with the menus tucked away; the player's last choice is remembered. */
function readHudCollapsed() {
  try {
    return localStorage.getItem('ma.hud') !== 'open'
  } catch {
    return true
  }
}

export const useUI = create((set, get) => ({
  /** Open modal id, or null. */
  modal: null,
  /** Extra data for the modal (e.g. which stall). */
  modalData: null,
  /** Hotbar slot 0..9; 0 is always the pickaxe. */
  slot: 0,
  toasts: [],
  /** Sell-stall dialogue visible. */
  sellDialog: false,

  // --- Copied from the frame loop at ~8 Hz ---
  altitude: 0,
  onMountain: false,
  zone: 0,
  cold: 0,
  /** How far below the mountain's surface you are (m), 0 above ground. */
  depth: 0,
  /** { kind: 'pickup', id, label } | { kind: 'stall', id } | null */
  prompt: null,
  nearStall: null,
  inOwnPlot: false,
  placeRot: 0,

  /** Garden settings: mutation tints hidden from view, and whether crystals block you. */
  hiddenMutations: [],
  crystalCollisions: false,

  /** Frozen to death: { seconds } until Respawn may be pressed (Boxity's countdown), or null. */
  death: null,
  /** Phones: the menu buttons tucked away for more of the view (the swap button shows them). */
  hudCollapsed: readHudCollapsed(),
  /** Phones: the hotbar opened with its button (it also opens by itself in your garden). */
  hotbarOpen: false,
  /** Camera view: 'third' (behind you) or 'first' (through your eyes). */
  cameraMode: cameraState.mode,

  contextLost: false,
  loaded: false,
  muted: false,

  openModal(modal, modalData = null) {
    set({ modal, modalData })
  },
  closeModal() {
    set({ modal: null, modalData: null })
  },
  setSlot(slot) {
    set({ slot })
  },
  toggleCameraMode() {
    const cameraMode = get().cameraMode === 'first' ? 'third' : 'first'
    cameraState.mode = cameraMode
    try {
      localStorage.setItem('ma.camera', cameraMode)
    } catch {
      /* storage unavailable: the view still switches for this session */
    }
    set({ cameraMode })
  },
  toggleHotbar() {
    set({ hotbarOpen: !get().hotbarOpen })
  },
  toggleHud() {
    const hudCollapsed = !get().hudCollapsed
    try {
      localStorage.setItem('ma.hud', hudCollapsed ? 'closed' : 'open')
    } catch {
      /* storage unavailable: the choice still applies for this session */
    }
    set({ hudCollapsed })
  },

  /**
   * Shows a centre-screen toast. Repeats of the same text collapse into one with a
   * counter, like "[x3]".
   */
  toast(text, kind = 'info', ms = 2600) {
    const toasts = get().toasts
    const existing = toasts.find((t) => t.text === text)
    if (existing) {
      clearTimeout(existing.timer)
      existing.count += 1
      existing.timer = setTimeout(() => get().dismissToast(existing.id), ms)
      set({ toasts: [...toasts] })
      return
    }
    const id = ++toastId
    const timer = setTimeout(() => get().dismissToast(id), ms)
    set({ toasts: [...toasts.slice(-3), { id, text, kind, count: 1, timer }] })
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

}))

export const ui = () => useUI.getState()
