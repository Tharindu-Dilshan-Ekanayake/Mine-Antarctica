/**
 * The scene's look in one place: a crisp polar day with a deep blue sky, white
 * snow and soft blue shadows. Colours are sRGB hex.
 *
 * Weather overrides the sky/fog/light tint (see WEATHER_LOOK); everything lerps
 * towards the active entry.
 */

export const SKY = {
  top: '#1f6fd6',
  horizon: '#b3dbf6',
  exponent: 0.55,
}

export const CLOUDS = {
  top: '#ffffff',
  bottom: '#c9d9ec',
}

export const LIGHTS = {
  hemiSky: '#ffffff',
  hemiGround: '#b8c9dc',
  hemiIntensity: 1.35,
  sunColor: '#fff4e2',
  sunIntensity: 2.8,
  /** Direction towards the sun. */
  sunDirection: [-0.55, 0.7, 0.45],
  shadowIntensity: 0.55,
}

/** Per-weather tint: sky top/horizon, fog colour, light multiplier, particle look. */
export const WEATHER_LOOK = {
  // Clear days still have a few lazy flakes drifting down.
  '': { top: SKY.top, horizon: SKY.horizon, light: 1, particle: { color: '#ffffff', fall: 1.4, size: [0.07, 0.07], drift: 1.2, density: 0.35 } },
  rain: { top: '#5a7393', horizon: '#a9b8c8', light: 0.75, particle: { color: '#9cc8ff', fall: 26, size: [0.03, 0.7], drift: 0 } },
  acid: { top: '#4f6b3a', horizon: '#b5cf9a', light: 0.8, particle: { color: '#7dff4a', fall: 22, size: [0.04, 0.6], drift: 0 } },
  blizzard: { top: '#8aa0b8', horizon: '#e6eef6', light: 0.85, particle: { color: '#ffffff', fall: 7, size: [0.12, 0.12], drift: 9 } },
  thunder: { top: '#2e3548', horizon: '#7d8597', light: 0.6, particle: { color: '#b8d8ff', fall: 30, size: [0.03, 0.8], drift: 2 }, flashes: true },
  lucky: { top: '#2f9a5a', horizon: '#c8f5c8', light: 1.05, particle: { color: '#5cff6e', fall: 2.5, size: [0.16, 0.16], drift: 1 } },
  starfall: { top: '#1d2350', horizon: '#6a72b8', light: 0.8, particle: { color: '#ffe14a', fall: 14, size: [0.1, 0.5], drift: 4 } },
  heatwave: { top: '#d0703a', horizon: '#ffd6a0', light: 1.1, particle: { color: '#ff7a2a', fall: -3, size: [0.1, 0.1], drift: 1 } },
  aurora: { top: '#1a2a5a', horizon: '#5fe8c8', light: 0.85, particle: { color: '#9dffe6', fall: 1.5, size: [0.12, 0.12], drift: 0.6 } },
  bloodmoon: { top: '#3a0610', horizon: '#a8323e', light: 0.65, particle: { color: '#ff2a3a', fall: 20, size: [0.04, 0.6], drift: 1 } },
}
