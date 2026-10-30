/**
 * The in-game mouse cursor: a little pickaxe whose head sits right where your swing
 * lands (the hotspot), so you always see what you're about to dig. Three looks:
 *
 *   ready   - metal head, ready to swing
 *   swing   - tipped forward mid-swing
 *   blocked - red: there's nothing to dig there (or too deep, bedrock...)
 *
 * Drawn as inline SVG data URIs: zero asset bytes, built once.
 */

const SIZE = 56
/** The pickaxe head's biting point inside the picture. */
const HOTSPOT = [17, 17]

function pickaxeSvg({ head, edge, tilt = 0 }) {
  // The handle runs from the bottom right to the head; the head is a crescent bent
  // away from the hand, its middle (the hotspot) at the top left.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <g transform="rotate(${tilt} ${HOTSPOT[0]} ${HOTSPOT[1]}) translate(6 6)" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M34 34 L16 16" stroke="#1b1208" stroke-width="8.5"/>
    <path d="M7 31 Q6 8 31 7" stroke="#1b1208" stroke-width="10.5"/>
    <path d="M34 34 L16 16" stroke="#9a6a3c" stroke-width="5"/>
    <path d="M30 30 L26 26 M24 24 L20 20" stroke="#5a3c20" stroke-width="5"/>
    <path d="M7 31 Q6 8 31 7" stroke="${head}" stroke-width="7"/>
    <path d="M7 31 Q6 8 31 7" stroke="${edge}" stroke-width="2.2" transform="translate(-1.2 -1.2)"/>
    <circle cx="17" cy="17" r="3.2" fill="#caa56a" stroke="#1b1208" stroke-width="1.5"/>
  </g>
</svg>`
}

const LOOKS = {
  ready: pickaxeSvg({ head: '#9fb2c8', edge: '#f4fbff' }),
  swing: pickaxeSvg({ head: '#b9c9dc', edge: '#ffffff', tilt: -25 }),
  blocked: pickaxeSvg({ head: '#d94a4a', edge: '#ffb0b0' }),
}

const css = {}
for (const [name, svg] of Object.entries(LOOKS)) {
  css[name] = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${HOTSPOT[0]} ${HOTSPOT[1]}, crosshair`
}

/** The CSS `cursor` value for a look ('ready' | 'swing' | 'blocked'). */
export const pickaxeCursor = (look) => css[look]
/** The raw SVG of a look (for previews and tests). */
export const pickaxeSvgOf = (look) => LOOKS[look]
