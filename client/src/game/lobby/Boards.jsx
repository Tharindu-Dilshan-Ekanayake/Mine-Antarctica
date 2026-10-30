import { useEffect, useMemo } from 'react'
import { PlaneGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { kg, luckPct, money, shortNumber } from '@shared/format.js'
import { useNet } from '../../net/net'
import { useQuality } from '../../store/quality'
import { BOARDS, PLOT_BOARDS, PLOT_NAME_BOARDS, PLOT_TINTS } from './buildLobby'
import { canvasTexture, makeCanvas, outlinedText, UI_FONT } from './canvasText'

/** Name signs in their atlas: 2 x 4 cells, each 4:1 like the signs. */
const NAME_COLS = 2
const NAME_ROWS = 4

/** Plot boards in the atlas: one 2:1 cell per plot, the same shape as the boards. */
const PLOT_COLS = 4
const PLOT_ROWS = 2

/**
 * Leaderboards and garden plot boards. Each family shares one canvas atlas and one
 * merged mesh. Canvases are redrawn only when the data behind them changes.
 */

/** Planes for `boards`, each mapped to cell i of a cols x rows atlas. */
function atlasPlanes(boards, cols, rows) {
  const parts = boards.map((b, i) => {
    const geo = new PlaneGeometry(b.w, b.h)
    const uv = geo.getAttribute('uv')
    const cx = i % cols
    const cy = Math.floor(i / cols)
    for (let k = 0; k < uv.count; k += 1) {
      uv.setXY(k, (cx + uv.getX(k)) / cols, 1 - (cy + 1 - uv.getY(k)) / rows)
    }
    if (b.ry) geo.rotateY(b.ry)
    geo.translate(b.x, b.y, b.z)
    return geo
  })
  const merged = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  return merged
}

function useAtlas(width, height) {
  const scale = useQuality((s) => (s.settings.texSize >= 1024 ? 1 : 0.5))
  const canvas = useMemo(() => makeCanvas(width * scale, height * scale), [width, height, scale])
  const texture = useMemo(() => canvasTexture(canvas), [canvas])
  useEffect(() => () => texture.dispose(), [texture])
  return { canvas, texture, scale }
}

function drawLeaderboard(ctx, x, y, w, h, title, rows, format, accent) {
  ctx.fillStyle = '#0d0f16'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = accent
  ctx.lineWidth = 6
  ctx.strokeRect(x + 6, y + 6, w - 12, h - 12)
  outlinedText(ctx, `◆ ${title} ◆`, x + w / 2, y + h * 0.09, {
    size: h * 0.075, color: accent, maxWidth: w * 0.9,
  })
  ctx.font = `700 ${h * 0.045}px ${UI_FONT}`
  ctx.fillStyle = '#8890a6'
  ctx.textAlign = 'left'
  ctx.fillText('#    PLAYER', x + w * 0.06, y + h * 0.18)
  ctx.textAlign = 'right'
  ctx.fillText(title.includes('RICH') ? 'CASH' : 'CRYSTALS', x + w * 0.94, y + h * 0.18)
  const rankColors = ['#ffd84a', '#d8dde6', '#e0a060']
  for (let i = 0; i < 8; i += 1) {
    const ry = y + h * (0.27 + i * 0.09)
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.fillRect(x + 14, ry - h * 0.04, w - 28, h * 0.08)
    }
    const row = rows[i]
    ctx.font = `700 ${h * 0.05}px ${UI_FONT}`
    ctx.textAlign = 'left'
    ctx.fillStyle = rankColors[i] ?? '#ffffff'
    ctx.fillText(`#${i + 1}`, x + w * 0.06, ry)
    ctx.fillStyle = row ? '#ffffff' : '#4a5066'
    ctx.fillText(row ? row.name.slice(0, 16) : '---', x + w * 0.16, ry)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#5ee0ff'
    ctx.fillText(row ? format(row.value) : '', x + w * 0.94, ry)
  }
}

export function Leaderboards() {
  const boards = useNet((s) => s.boards)
  const { canvas, texture } = useAtlas(1024, 512)
  const geometry = useMemo(() => atlasPlanes(BOARDS, 2, 1), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    const ctx = canvas.getContext('2d')
    const w = canvas.width / 2
    const h = canvas.height
    drawLeaderboard(ctx, 0, 0, w, h, BOARDS[0].title, boards.mined, (v) => shortNumber(v), '#ffd84a')
    drawLeaderboard(ctx, w, 0, w, h, BOARDS[1].title, boards.cash, (v) => money(v), '#5cff8a')
    texture.needsUpdate = true
  }, [boards, canvas, texture])

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  )
}

function drawPlot(ctx, x, y, w, h, index, plot) {
  ctx.fillStyle = '#14161e'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = '#2d3242'
  ctx.lineWidth = 4
  ctx.strokeRect(x + 3, y + 3, w - 6, h - 6)
  if (!plot) {
    outlinedText(ctx, `PLOT ${index + 1}`, x + w / 2, y + h * 0.36, { size: h * 0.17, color: '#8890a6' })
    ctx.font = `700 ${h * 0.09}px ${UI_FONT}`
    ctx.fillStyle = '#5a6078'
    ctx.textAlign = 'center'
    ctx.fillText('Waiting for a miner...', x + w / 2, y + h * 0.66)
    return
  }
  let biggest = 0
  let total = 0
  for (const it of plot.items) {
    biggest = Math.max(biggest, it.weight)
    total += it.weight
  }
  outlinedText(ctx, plot.owner, x + w * 0.5, y + h * 0.15, { size: h * 0.14, color: '#ffffff', maxWidth: w * 0.9 })
  outlinedText(ctx, `Biggest: ${kg(biggest)}`, x + w * 0.5, y + h * 0.36, { size: h * 0.12, color: '#ff4a5a', maxWidth: w * 0.9 })
  outlinedText(ctx, `Total: ${kg(total)}`, x + w * 0.5, y + h * 0.55, { size: h * 0.11, color: '#f0f0f0', maxWidth: w * 0.9 })
  outlinedText(ctx, `❖ ${plot.items.length}/${plot.slots}`, x + w * 0.28, y + h * 0.8, { size: h * 0.13, color: '#7fe6ff' })
  outlinedText(ctx, `☘ ${luckPct(plot.luck)}`, x + w * 0.7, y + h * 0.8, { size: h * 0.12, color: '#5cff6e', maxWidth: w * 0.5 })
}

export function PlotBoards() {
  const plots = useNet((s) => s.plots)
  const { canvas, texture } = useAtlas(1024, 256)
  const geometry = useMemo(() => atlasPlanes(PLOT_BOARDS, PLOT_COLS, PLOT_ROWS), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    const ctx = canvas.getContext('2d')
    const w = canvas.width / PLOT_COLS
    const h = canvas.height / PLOT_ROWS
    for (let i = 0; i < PLOT_BOARDS.length; i += 1) {
      drawPlot(ctx, (i % PLOT_COLS) * w, Math.floor(i / PLOT_COLS) * h, w, h, i, plots[i])
    }
    texture.needsUpdate = true
  }, [plots, canvas, texture])

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  )
}

/**
 * Each sign twice, back to back (front facing +z, back facing -z), both mapped to the
 * same atlas cell: the owner's name reads the right way round from either side.
 */
function twoSidedPlanes(boards, cols, rows) {
  const parts = []
  boards.forEach((b, i) => {
    const cx = i % cols
    const cy = Math.floor(i / cols)
    for (const back of [false, true]) {
      const geo = new PlaneGeometry(b.w, b.h)
      const uv = geo.getAttribute('uv')
      for (let k = 0; k < uv.count; k += 1) {
        uv.setXY(k, (cx + uv.getX(k)) / cols, 1 - (cy + 1 - uv.getY(k)) / rows)
      }
      if (back) geo.rotateY(Math.PI)
      geo.translate(b.x, b.y, b.z + (back ? -0.1 : 0.1))
      parts.push(geo)
    }
  })
  const merged = mergeGeometries(parts)
  parts.forEach((g) => g.dispose())
  return merged
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawNameSign(ctx, x, y, w, h, index, plot, mine) {
  const tint = PLOT_TINTS[index % PLOT_TINTS.length]
  ctx.clearRect(x, y, w, h)
  // Wooden plank board with a tinted inner panel.
  ctx.fillStyle = '#3a2a1e'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = Math.max(1, h * 0.02)
  for (let k = 1; k < 3; k += 1) {
    ctx.beginPath()
    ctx.moveTo(x, y + (h * k) / 3)
    ctx.lineTo(x + w, y + (h * k) / 3)
    ctx.stroke()
  }
  const m = h * 0.09
  const grad = ctx.createLinearGradient(0, y + m, 0, y + h - m)
  grad.addColorStop(0, mine ? '#3a2c06' : '#0f1b30')
  grad.addColorStop(1, mine ? '#1e1602' : '#08101e')
  roundRect(ctx, x + m, y + m, w - m * 2, h - m * 2, h * 0.14)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.lineWidth = h * 0.045
  ctx.strokeStyle = mine ? '#ffd23a' : tint
  ctx.stroke()
  // Nail heads in the corners.
  ctx.fillStyle = '#c9b28a'
  for (const [nx, ny] of [[0.04, 0.12], [0.96, 0.12], [0.04, 0.88], [0.96, 0.88]]) {
    ctx.beginPath()
    ctx.arc(x + w * nx, y + h * ny, h * 0.035, 0, Math.PI * 2)
    ctx.fill()
  }

  if (!plot) {
    outlinedText(ctx, 'FREE PLOT', x + w / 2, y + h * 0.42, { size: h * 0.38, color: '#8890a6', maxWidth: w * 0.84 })
    ctx.font = `700 ${h * 0.15}px ${UI_FONT}`
    ctx.fillStyle = '#5a6078'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`PLOT ${index + 1}`, x + w / 2, y + h * 0.77)
    return
  }
  ctx.font = `700 ${h * 0.14}px ${UI_FONT}`
  ctx.fillStyle = mine ? '#ffe58a' : '#cfe9ff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(mine ? '\u2605 YOUR GARDEN \u2605' : 'GARDEN OF', x + w / 2, y + h * 0.27)
  outlinedText(ctx, plot.owner.toUpperCase(), x + w / 2, y + h * 0.6, {
    size: h * 0.4,
    color: mine ? '#ffd23a' : '#ffffff',
    maxWidth: w * 0.86,
  })
}

/**
 * Big name signs over every garden's entrance: whose garden it is, in letters you can
 * read from across the base. One canvas atlas and one merged mesh for all eight.
 */
export function PlotNameBoards() {
  const plots = useNet((s) => s.plots)
  const myPlot = useNet((s) => s.me?.plot ?? -1)
  const { canvas, texture } = useAtlas(1024, 512)
  const geometry = useMemo(() => twoSidedPlanes(PLOT_NAME_BOARDS, NAME_COLS, NAME_ROWS), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    const ctx = canvas.getContext('2d')
    const w = canvas.width / NAME_COLS
    const h = canvas.height / NAME_ROWS
    for (let i = 0; i < PLOT_NAME_BOARDS.length; i += 1) {
      drawNameSign(ctx, (i % NAME_COLS) * w, Math.floor(i / NAME_COLS) * h, w, h, i, plots[i], i === myPlot)
    }
    texture.needsUpdate = true
  }, [plots, myPlot, canvas, texture])

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  )
}
