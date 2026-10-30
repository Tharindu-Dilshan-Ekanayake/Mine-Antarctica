import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'

/** Shared canvas helpers for the textured signs and boards. */

export const SIGN_FONT = '"Luckiest Guy", "Arial Black", Impact, sans-serif'
export const UI_FONT = '"Fredoka", "Arial Rounded MT Bold", Arial, sans-serif'

/** Resolves once the display fonts are usable (or after a short timeout). */
export function fontsReady() {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve()
  const load = Promise.all([
    document.fonts.load(`64px ${SIGN_FONT}`),
    document.fonts.load(`700 32px ${UI_FONT}`),
  ]).catch(() => {})
  return Promise.race([load, new Promise((r) => setTimeout(r, 2500))])
}

/** Cartoon text: thick dark outline, bright fill, light top highlight. */
export function outlinedText(ctx, text, x, y, { size, color, outline = '#141824', font = SIGN_FONT, align = 'center', maxWidth }) {
  ctx.font = `${size}px ${font}`
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  let px = size
  if (maxWidth) {
    while (ctx.measureText(text).width > maxWidth && px > 8) {
      px -= 2
      ctx.font = `${px}px ${font}`
    }
  }
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(3, px * 0.2)
  ctx.strokeStyle = outline
  ctx.strokeText(text, x, y + px * 0.06)
  ctx.strokeText(text, x, y)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  return px
}

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

export function canvasTexture(canvas) {
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearMipmapLinearFilter
  tex.anisotropy = 4
  return tex
}
