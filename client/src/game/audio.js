/**
 * All of the game's sound, synthesised with WebAudio: zero asset bytes to download.
 *
 * - Sound effects (`sfx`): crunchy digs, glassy crystal tinks, sparkling shatters,
 *   find fanfares that grow with the crystal's rarity, coins, footsteps in the snow...
 * - Music: a soft, never-repeating Antarctic tune - pad chords and a sparse bell
 *   melody with an echo - scheduled a little ahead on the audio clock.
 * - Wind: a filtered-noise breeze that rises as you climb.
 *
 * The AudioContext is only created on the first user gesture: browsers block audio
 * until then. Everything goes through one master gain (Boxity's volume, mute, ad
 * breaks); music and wind have their own levels under it.
 */

let ctx = null
let master = null
let sfxBus = null
let musicBus = null
let windBus = null
let echo = null
let muted = false
/** Boxity's master volume, 0..1. */
let volume = 0.8
/** Boxity's music volume, 0..1. */
let musicVolume = 0.8
/** Silent while Boxity shows an ad. */
let adBreak = false
const BASE_GAIN = 0.35
const MUSIC_GAIN = 0.32
const WIND_GAIN = 0.5

const silent = () => muted || adBreak || volume <= 0
const applyGain = () => {
  if (master) master.gain.value = silent() ? 0 : BASE_GAIN * volume
  if (musicBus) musicBus.gain.value = MUSIC_GAIN * musicVolume
}

function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume()
    return
  }
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  ctx = new AC()
  master = ctx.createGain()
  master.connect(ctx.destination)
  sfxBus = ctx.createGain()
  sfxBus.connect(master)
  musicBus = ctx.createGain()
  musicBus.connect(master)
  // A soft echo the bells (music and finds) ring into.
  echo = ctx.createDelay(1)
  echo.delayTime.value = 0.36
  const feedback = ctx.createGain()
  feedback.gain.value = 0.38
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 2600
  echo.connect(tone)
  tone.connect(feedback)
  feedback.connect(echo)
  tone.connect(master)
  applyGain()
  startWind()
  startMusic()
}

export function installAudioUnlock() {
  const events = ['pointerdown', 'keydown', 'touchstart']
  const handler = () => {
    unlock()
    events.forEach((e) => window.removeEventListener(e, handler))
  }
  events.forEach((e) => window.addEventListener(e, handler, { passive: true }))
  return () => events.forEach((e) => window.removeEventListener(e, handler))
}

export function setMuted(value) {
  muted = value
  applyGain()
}

/** Boxity's master volume setting, 0..1. */
export function setVolume(value) {
  volume = Math.min(1, Math.max(0, value))
  applyGain()
}

/** Boxity's music volume setting, 0..1. */
export function setMusicVolume(value) {
  musicVolume = Math.min(1, Math.max(0, value))
  applyGain()
}

/** An ad break started (true) or ended (false): every sound off meanwhile. */
export function setAdBreak(value) {
  adBreak = value
  applyGain()
}

// --- Building blocks ------------------------------------------------------------------

/** One oscillator note with a quick attack and an exponential fade. */
function tone(freq, dur, { type = 'square', gain = 0.3, slide = 0, delay = 0, attack = 0.005, bus, wet = 0 } = {}) {
  if (!ctx || silent()) return
  const t = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g)
  g.connect(bus ?? sfxBus)
  if (wet && echo) {
    const send = ctx.createGain()
    send.gain.value = wet
    g.connect(send)
    send.connect(echo)
  }
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

let noiseBuffer = null
function getNoise() {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  }
  return noiseBuffer
}

/** A burst of filtered noise. */
function noise(dur, { gain = 0.4, freq = 1200, type = 'lowpass', q = 0.7, delay = 0, sweep = 0 } = {}) {
  if (!ctx || silent()) return
  const t = ctx.currentTime + delay
  const src = ctx.createBufferSource()
  src.buffer = getNoise()
  src.playbackRate.value = 0.8 + Math.random() * 0.4
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.setValueAtTime(freq, t)
  if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), t + dur)
  filter.Q.value = q
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  src.connect(filter)
  filter.connect(g)
  g.connect(sfxBus)
  src.start(t, Math.random() * 0.4)
  src.stop(t + dur)
}

const rnd = (a, b) => a + Math.random() * (b - a)
/** Equal-tempered note: semitones from A4. */
const note = (semi) => 440 * Math.pow(2, semi / 12)

// --- Sound effects --------------------------------------------------------------------

/** Find fanfares: longer, higher and more sparkly the rarer the crystal. */
const FIND_RUNS = [
  [0, 4, 7],
  [0, 4, 7, 12],
  [0, 4, 7, 12, 16],
  [0, 7, 12, 16, 19, 24],
  [0, 4, 7, 12, 16, 19, 24, 28],
  [0, 4, 7, 11, 12, 16, 19, 23, 24, 28, 31],
]

export const sfx = {
  /** A pickaxe biting into snow and rock: a thud and a crunch, never quite the same. */
  dig: () => {
    tone(rnd(90, 120), 0.16, { type: 'sine', gain: 0.5, slide: -40 })
    noise(0.2, { gain: 0.45, freq: rnd(600, 900), sweep: -300 })
    noise(0.07, { gain: 0.2, freq: 3500, type: 'highpass', delay: 0.02 })
  },
  /** A tunnel bite opening up: a deeper rumble with rubble tumbling. */
  tunnel: () => {
    tone(70, 0.35, { type: 'sine', gain: 0.45, slide: -25 })
    noise(0.4, { gain: 0.35, freq: 500, sweep: -250, delay: 0.04 })
  },
  /** A glassy tink on a crystal. */
  hit: () => {
    const f = rnd(1300, 1900)
    tone(f, 0.18, { type: 'triangle', gain: 0.22, wet: 0.25 })
    tone(f * 2.01, 0.1, { type: 'sine', gain: 0.08 })
    noise(0.05, { gain: 0.15, freq: 5000, type: 'highpass' })
  },
  /** A crystal breaking free: a cascade of glassy sparkles. */
  shatter: () => {
    noise(0.35, { gain: 0.3, freq: 6000, type: 'highpass' })
    for (let i = 0; i < 6; i += 1) tone(rnd(1800, 3600), 0.22, { type: 'sine', gain: 0.1, delay: i * 0.035, wet: 0.3 })
    tone(220, 0.25, { type: 'triangle', gain: 0.2, slide: -80 })
  },
  /** A find, its fanfare sized by rarity (0 Common .. 5 Mythic). */
  find: (rarity = 0) => {
    const run = FIND_RUNS[Math.max(0, Math.min(FIND_RUNS.length - 1, rarity))]
    const root = 3 + rarity
    const gap = rarity >= 4 ? 0.06 : 0.075
    run.forEach((s, i) =>
      tone(note(root + s), 0.3, { type: 'triangle', gain: 0.17, delay: i * gap, wet: 0.35 }),
    )
    if (rarity >= 3) {
      // Shimmer on top for the big ones.
      for (let i = 0; i < 8; i += 1) tone(rnd(2400, 4200), 0.2, { type: 'sine', gain: 0.05, delay: run.length * gap + i * 0.04, wet: 0.4 })
    }
    if (rarity >= 5) tone(note(root - 12), 1.4, { type: 'sine', gain: 0.25, attack: 0.05, wet: 0.3 })
  },
  /** Into the bag: a bubbly pop and a coin. */
  pickup: () => {
    tone(520, 0.12, { type: 'sine', gain: 0.28, slide: 500 })
    tone(1568, 0.14, { type: 'triangle', gain: 0.12, delay: 0.07, wet: 0.2 })
  },
  /** Ka-ching. */
  sell: () => {
    noise(0.06, { gain: 0.25, freq: 3000, type: 'bandpass', q: 3 })
    ;[1319, 1760, 2637].forEach((f, i) => tone(f, 0.35, { type: 'triangle', gain: 0.12, delay: 0.05 + i * 0.07, wet: 0.3 }))
  },
  /** A purchase or an upgrade: a bright little fanfare. */
  buy: () => [0, 4, 7, 12].forEach((s, i) => tone(note(5 + s), 0.22, { type: 'square', gain: 0.07, delay: i * 0.06 })),
  error: () => {
    tone(196, 0.14, { type: 'triangle', gain: 0.16 })
    tone(147, 0.2, { type: 'triangle', gain: 0.16, delay: 0.09 })
  },
  click: () => tone(1100, 0.05, { type: 'sine', gain: 0.12 }),
  /** A tutorial step done: a happy two-note chime. */
  chime: () => {
    tone(note(15), 0.3, { type: 'sine', gain: 0.18, wet: 0.3 })
    tone(note(22), 0.45, { type: 'sine', gain: 0.18, delay: 0.1, wet: 0.35 })
  },
  boom: () => {
    noise(0.9, { gain: 0.9, freq: 400, sweep: -250 })
    tone(70, 0.6, { type: 'sine', gain: 0.6, slide: -30 })
  },
  jump: () => tone(380, 0.1, { type: 'sine', gain: 0.1, slide: 260 }),
  /** A footstep crunching in the snow. */
  step: () => noise(0.09, { gain: rnd(0.07, 0.11), freq: rnd(1400, 2200), type: 'bandpass', q: 1.2 }),
  /** Frozen solid: ice creaks and the music of it falls away. */
  freeze: () => {
    noise(0.6, { gain: 0.3, freq: 7000, type: 'highpass' })
    ;[12, 7, 3, 0].forEach((s, i) => tone(note(s), 0.4, { type: 'sine', gain: 0.15, delay: i * 0.12, wet: 0.4 }))
  },
  /** Back on your feet: a warm rising whoosh. */
  respawn: () => {
    noise(0.5, { gain: 0.25, freq: 300, sweep: 2500 })
    ;[0, 4, 7, 12].forEach((s, i) => tone(note(3 + s), 0.25, { type: 'triangle', gain: 0.13, delay: 0.15 + i * 0.06, wet: 0.3 }))
  },
}

// --- Wind -------------------------------------------------------------------------------

let windGain = null
let windFilter = null

function startWind() {
  const src = ctx.createBufferSource()
  src.buffer = getNoise()
  src.loop = true
  windFilter = ctx.createBiquadFilter()
  windFilter.type = 'bandpass'
  windFilter.frequency.value = 500
  windFilter.Q.value = 0.6
  // Slow gusts: an LFO swaying the filter.
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.09
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.value = 260
  lfo.connect(lfoDepth)
  lfoDepth.connect(windFilter.frequency)
  windGain = ctx.createGain()
  windGain.gain.value = 0.02
  windBus = ctx.createGain()
  windBus.gain.value = WIND_GAIN
  src.connect(windFilter)
  windFilter.connect(windGain)
  windGain.connect(windBus)
  windBus.connect(master)
  src.start()
  lfo.start()
}

/** How windy it sounds, 0 (base) .. 1 (summit). Called a few times a second. */
export function setWind(level) {
  if (!windGain || !ctx) return
  const l = Math.min(1, Math.max(0, level))
  windGain.gain.setTargetAtTime(0.02 + l * 0.16, ctx.currentTime, 0.8)
  windFilter.frequency.setTargetAtTime(420 + l * 520, ctx.currentTime, 0.8)
}

// --- Music --------------------------------------------------------------------------------

/** Chord progression (semitones from A4 for each chord tone): Cmaj7 Am7 Fmaj7 G6. */
const CHORDS = [
  [-21, -17, -14, -10],
  [-24, -21, -17, -14],
  [-28, -24, -21, -17],
  [-26, -22, -19, -17],
]
/** C major pentatonic, for the bell melody (semitones from A4). */
const SCALE = [3, 5, 7, 10, 12, 15, 17, 19, 22, 24]
const BAR = 4.8
let musicTimer = null
let nextBar = 0
let bar = 0
let melodyIdx = 4

function padNote(freq, t, dur) {
  for (const detune of [-6, 6]) {
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq
    osc.detune.value = detune
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.05, t + 1.2)
    g.gain.setValueAtTime(0.05, t + dur - 1.2)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6)
    osc.connect(filter)
    filter.connect(g)
    g.connect(musicBus)
    osc.start(t)
    osc.stop(t + dur + 0.7)
  }
}

function bell(freq, t) {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6)
  osc.connect(g)
  g.connect(musicBus)
  const send = ctx.createGain()
  send.gain.value = 0.5
  g.connect(send)
  send.connect(echo)
  osc.start(t)
  osc.stop(t + 1.7)
}

/** Schedules the next bar: a pad chord and a few bell notes wandering the scale. */
function scheduleBar(t) {
  const chord = CHORDS[bar % CHORDS.length]
  for (const s of chord) padNote(note(s), t, BAR)
  // A sparse melody: 2-4 notes per bar, stepping around the scale.
  const notes = 2 + Math.floor(Math.random() * 3)
  for (let i = 0; i < notes; i += 1) {
    if (Math.random() < 0.25) continue
    melodyIdx = Math.max(0, Math.min(SCALE.length - 1, melodyIdx + Math.floor(Math.random() * 5) - 2))
    bell(note(SCALE[melodyIdx]), t + (i * BAR) / notes + Math.random() * 0.15)
  }
  bar += 1
}

function startMusic() {
  if (musicTimer) return
  nextBar = ctx.currentTime + 0.5
  // Look ahead a little on the audio clock; the timer only tops up the schedule.
  musicTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return
    while (nextBar < ctx.currentTime + 1.5) {
      if (!silent()) scheduleBar(nextBar)
      nextBar += BAR
    }
  }, 500)
}
