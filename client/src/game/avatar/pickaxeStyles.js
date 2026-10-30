/**
 * How each pickaxe looks, shared by the 3D model in the hand and the 2D icons.
 *
 *   head     - main head colour       edge   - bright cutting edge / bevel
 *   handle   - shaft colour           grip   - wrap colour near the hand
 *   collar   - metal band at the head gem    - inset gem (null for none)
 *   shape    - 'pick' (two curved points), 'adze' (point + flat blade),
 *              'crystal' (head grown from crystal shards)
 *   glow     - glowing parts (and swing trail) colour, or null
 *   curve    - how far the points bend back toward the hand (0 straight .. 1 hooked)
 *   length   - head reach to each side (in tool units)
 */
export const PICKAXE_STYLES = {
  rusted: {
    head: '#8a5a3c', edge: '#c98a5c', handle: '#7b5536', grip: '#3b2a1f', collar: '#5d4636',
    gem: null, shape: 'pick', glow: null, curve: 0.55, length: 0.5,
  },
  timber: {
    head: '#8d969e', edge: '#d7dde3', handle: '#d9c49a', grip: '#6b4a2e', collar: '#a07a4a',
    gem: null, shape: 'adze', glow: null, curve: 0.35, length: 0.5,
  },
  flint: {
    head: '#4d5560', edge: '#9aa4b0', handle: '#6b4a2e', grip: '#c9a36a', collar: '#3b2a1f',
    gem: null, shape: 'crystal', glow: null, curve: 0.3, length: 0.52,
  },
  slate: {
    head: '#334052', edge: '#8ea2bc', handle: '#7a5230', grip: '#22252b', collar: '#9aa3ab',
    gem: '#5ee0ff', shape: 'pick', glow: null, curve: 0.6, length: 0.56,
  },
  copper: {
    head: '#c4672a', edge: '#ffb27a', handle: '#4a3020', grip: '#1d1f2b', collar: '#e8a24a',
    gem: '#3dff8a', shape: 'adze', glow: null, curve: 0.45, length: 0.58,
  },
  iron: {
    head: '#aab3bd', edge: '#ffffff', handle: '#22232b', grip: '#b8892b', collar: '#ffcf4a',
    gem: '#ff3d6e', shape: 'pick', glow: null, curve: 0.75, length: 0.62,
  },
  frostbite: {
    head: '#62c8ff', edge: '#e8fbff', handle: '#2a4a7a', grip: '#e8f4ff', collar: '#bfe9ff',
    gem: '#e8fbff', shape: 'crystal', glow: '#7fe6ff', curve: 0.55, length: 0.62,
  },
  glacier: {
    head: '#2fb8f0', edge: '#d8f6ff', handle: '#f0f8ff', grip: '#2a6ab0', collar: '#9fe8ff',
    gem: '#ffffff', shape: 'adze', glow: '#5ee0ff', curve: 0.5, length: 0.68,
  },
  aurora: {
    head: '#3dffb8', edge: '#d0ffee', handle: '#5a1fb8', grip: '#2a0f5a', collar: '#c29bff',
    gem: '#ff5ad1', shape: 'crystal', glow: '#6dffd0', curve: 0.65, length: 0.7,
  },
  celestial: {
    head: '#ff5ad1', edge: '#ffe6fa', handle: '#ffd84a', grip: '#7a2cff', collar: '#fff2a8',
    gem: '#7ae8ff', shape: 'pick', glow: '#ff9ce6', curve: 0.8, length: 0.74,
  },
}

export const pickaxeStyle = (id) => PICKAXE_STYLES[id] ?? PICKAXE_STYLES.rusted
