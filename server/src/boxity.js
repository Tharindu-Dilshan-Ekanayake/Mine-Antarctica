import { matchMaker } from 'colyseus'

import { BOXITY_BOARDS, GAME_ID } from '../../shared/boxity.js'

/**
 * Boxity, as hosting told this pod: which environment it runs in (prod, stage or local)
 * and where Boxity's services are. The only place Boxity URLs come from on the server:
 * never guessed, and production only when nothing was told (local development).
 */
export const boxity = {
  env: process.env.BLOXITY_ENV || 'prod',
  apiUrl: (process.env.BLOXITY_API_URL || 'https://api.bloxity.io').replace(/\/$/, ''),
  matchmakerUrl: (process.env.BLOXITY_MATCHMAKER_URL || 'https://play.bloxity.io').replace(/\/$/, ''),
  portalUrl: (process.env.BLOXITY_PORTAL_URL || 'https://bloxity.io').replace(/\/$/, ''),
  staticUrl: (process.env.BLOXITY_STATIC_URL || 'https://static.bloxity.io').replace(/\/$/, ''),
  gameId: process.env.BLOXITY_GAME_ID || '',
  /** The game's slug on Boxity: its hosting id, unless told otherwise. */
  gameSlug: process.env.BLOXITY_GAME_SLUG || process.env.BLOXITY_GAME_ID || GAME_ID,
  reportToken: process.env.BLOXITY_REPORT_TOKEN || '',
  webhookSecret: process.env.LEGION_WEBHOOK_SECRET || '',
}

/**
 * The game's Boxity-hosted pages in this environment, for CORS: <id>.play.<portal host>
 * and its dev channel (prod: <id>.play.bloxity.io, stage: <id>.play.stage.bloxity.io).
 */
export function hostedOrigins() {
  const id = boxity.gameId || GAME_ID
  const host = new URL(boxity.portalUrl).host
  return [boxity.portalUrl, `https://${id}.play.${host}`, `https://${id}.dev.play.${host}`]
}

/** A player's Boxity identity as reports want it: legion_<id>, any #m mode suffix gone. */
export const legionId = (userId) => `legion_${String(userId).replace(/^legion_/, '').replace(/#m.*$/, '')}`

/**
 * Checks a player's Boxity token with Boxity. Resolves `{ user, carriedFrom }` (the
 * Boxity guest ids this browser played as before signing in) when it's genuine, else
 * null. Never throws: a Boxity outage must not stop anyone playing.
 */
export async function verifyPlayerToken(token) {
  if (!token || typeof token !== 'string' || token.length > 4096) return null
  try {
    const res = await fetch(`${boxity.apiUrl}/v1/auth/game-token/verify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ gameSlug: boxity.gameSlug }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const body = await res.json()
    const user = body?.user ?? (body?._id ? body : null)
    if (body?.valid === false || !user?._id) return null
    return { user, carriedFrom: Array.isArray(body.carriedFrom) ? body.carriedFrom.map(String).slice(0, 5) : [] }
  } catch (err) {
    console.warn('[boxity] could not verify a token:', err?.message || err)
    return null
  }
}

/**
 * Boxity's cross-pod room directory: this pod's live rooms, pushed to the matchmaker
 * every 2 s, so "Open Rooms" on the game page, friend joins and join-by-id work across
 * pods. A no-op unless Boxity hosting deployed us (it sets MATCHMAKER_REPORT_URL,
 * BLOXITY_REPORT_TOKEN and BLOXITY_GAME_ID), so it's safe locally. Private rooms are
 * never listed.
 */
export function installRoomReporter() {
  const base = process.env.MATCHMAKER_REPORT_URL
  const podName = process.env.POD_NAME || process.env.HOSTNAME || ''
  if (!base || !boxity.reportToken || !boxity.gameId) return
  const url = `${base.replace(/\/$/, '')}/${boxity.gameId}/rooms`
  const tick = async () => {
    try {
      const listings = await matchMaker.query({})
      const rooms = listings.map((listing) => ({
        colyseusRoomId: listing.roomId,
        name: listing.name || undefined,
        clients: listing.clients ?? 0,
        maxClients: listing.maxClients ?? 0,
        locked: !!listing.locked,
        private: !!listing.private,
        started: true,
        metadata: listing.metadata || undefined,
      }))
      const players = rooms.reduce((total, room) => total + (room.clients || 0), 0)
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${boxity.reportToken}` },
        body: JSON.stringify({ podName, players, rooms }),
        signal: AbortSignal.timeout(4000),
      })
    } catch {
      // Best effort: the directory tolerates gaps.
    }
  }
  setInterval(() => void tick(), 2000).unref()
  void tick()
}

// --- Leaderboards ----------------------------------------------------------------------

/** How often scores go to Boxity. */
const SCORE_EVERY_MS = 20_000
/** Scores per request, Boxity's limit. */
const SCORE_BATCH = 200

/**
 * Scores waiting to go to Boxity, by player: the most crystals each has mined (a board
 * that keeps every player's best). Kept until Boxity has them, so a failed request
 * loses nothing.
 */
const pending = new Map()

/** Notes a verified player's score, from state this server owns - never a client message. */
export function noteScore(userId, crystalsMined) {
  if (!userId) return
  const id = legionId(userId)
  const score = Math.max(pending.get(id)?.crystals ?? 0, Math.floor(crystalsMined || 0))
  if (score > 0) pending.set(id, { crystals: score })
}

/** The waiting scores as Boxity takes them: one per board per player. */
function scoreRows() {
  const rows = []
  for (const [userId, row] of pending) {
    for (const board of BOXITY_BOARDS) {
      const score = row[board.id]
      if (Number.isFinite(score) && score > 0) rows.push({ board: board.id, userId, score })
    }
  }
  return rows
}

/** Sends the waiting scores to Boxity (with the boards' declarations); never throws. */
export async function flushScores() {
  if (!boxity.reportToken || !boxity.gameId || pending.size === 0) return
  const rows = scoreRows()
  const sent = new Map(pending)
  try {
    for (let i = 0; i < rows.length; i += SCORE_BATCH) {
      const res = await fetch(`${boxity.apiUrl}/v1/leaderboards/hosted/${boxity.gameId}/report`, {
        method: 'POST',
        headers: { authorization: `Bearer ${boxity.reportToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ boards: BOXITY_BOARDS, scores: rows.slice(i, i + SCORE_BATCH) }),
        signal: AbortSignal.timeout(8000),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        console.warn(`[boxity] leaderboard report refused (${res.status})`, body)
        // A request Boxity will never take (bad token, bad data) isn't retried.
        if (res.status >= 400 && res.status < 500) break
        return
      }
      const dropped = body?.dropped && Object.entries(body.dropped).filter(([, n]) => n > 0)
      if (dropped?.length) console.warn('[boxity] leaderboard scores dropped:', Object.fromEntries(dropped))
    }
    // Only what was sent goes; a better score noted meanwhile stays for the next report.
    for (const [userId, row] of sent) {
      if (pending.get(userId)?.crystals === row.crystals) pending.delete(userId)
    }
  } catch (err) {
    console.warn('[boxity] leaderboard report failed:', err?.message || err)
  }
}

/**
 * Reports scores every SCORE_EVERY_MS, gathering them first from everyone playing on
 * this pod (`collect`). A no-op without BLOXITY_REPORT_TOKEN (local development).
 */
export function installScoreReporter(collect) {
  if (!boxity.reportToken || !boxity.gameId) return
  setInterval(() => {
    try {
      collect()
    } catch (err) {
      console.warn('[boxity] could not gather scores:', err?.message || err)
    }
    void flushScores()
  }, SCORE_EVERY_MS).unref()
}
