import { create } from 'zustand'

/**
 * Quality presets. Every visual feature reads its budget from here; LOW is the
 * mobile floor (no shadows, no particles, dpr 1, shorter view distance).
 */
export const PRESETS = {
  LOW: {
    dpr: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: 0,
    particles: false,
    weatherFx: false,
    far: 430,
    fogNear: 70,
    fogFar: 410,
    /**
     * Near-terrain vertex spacing in metres (grid is 0.5 m). Dug ground is meshed at
     * the same spacing so the two meet without cracks.
     */
    nearCell: 1,
    /** Tunnels and craters are meshed within this distance; farther away the plain surface shows. */
    digView: 18,
    /** Glowing far-away markers over dug areas (1 draw call): how many may show. */
    digMarkers: 140,
    farStep: 8,
    remoteCull: 70,
    labels: 4,
    clouds: 7,
    texSize: 512,
  },
  MEDIUM: {
    dpr: 1.25,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    particles: true,
    weatherFx: true,
    far: 650,
    fogNear: 130,
    fogFar: 600,
    nearCell: 1,
    farStep: 4,
    digView: 36,
    digMarkers: 280,
    remoteCull: 100,
    labels: 8,
    clouds: 12,
    texSize: 1024,
  },
  HIGH: {
    dpr: 1.75,
    antialias: false,
    shadows: true,
    shadowMapSize: 2048,
    particles: true,
    weatherFx: true,
    far: 800,
    fogNear: 170,
    fogFar: 760,
    nearCell: 1,
    farStep: 4,
    digView: 48,
    digMarkers: 420,
    remoteCull: 160,
    labels: 10,
    clouds: 16,
    texSize: 1024,
  },
}

export const ORDER = ['LOW', 'MEDIUM', 'HIGH']

export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)

/**
 * Everyone starts on LOW, so the game runs smoothly on low-end PCs and phones from
 * the first second. Players with strong machines can raise it in Settings, and that
 * choice is remembered.
 */
const DEFAULT_PRESET = 'LOW'

function readSaved() {
  try {
    const v = localStorage.getItem('ma.quality')
    return ORDER.includes(v) ? v : null
  } catch {
    return null
  }
}

function clampDpr(dpr) {
  const device = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  return Math.min(dpr, device)
}

const initial = readSaved() ?? DEFAULT_PRESET

export const useQuality = create((set, get) => ({
  preset: initial,
  /** True when the player picked a preset; auto-drop then stays off. */
  manual: readSaved() !== null,
  settings: { ...PRESETS[initial], dpr: clampDpr(PRESETS[initial].dpr) },

  setPreset(preset, manual = true) {
    if (!PRESETS[preset]) return
    if (manual) {
      try {
        localStorage.setItem('ma.quality', preset)
      } catch {
        /* storage unavailable: preset still applies for this session */
      }
    }
    set({ preset, manual, settings: { ...PRESETS[preset], dpr: clampDpr(PRESETS[preset].dpr) } })
  },

  /** Called by <PerformanceMonitor> when FPS stays under budget. */
  drop() {
    const { preset, manual } = get()
    const i = ORDER.indexOf(preset)
    if (manual || i <= 0) return
    get().setPreset(ORDER[i - 1], false)
  },
}))

/** Non-reactive read for frame loops. */
export const quality = () => useQuality.getState().settings
