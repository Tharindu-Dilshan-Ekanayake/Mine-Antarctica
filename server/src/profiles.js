import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Player saves.
 *
 * On Boxity hosting every game gets its own managed MongoDB (MONGODB_URI, injected at
 * deploy): saves live there, so they survive pod restarts, scale-to-zero and deploys,
 * and every pod sees the same players. Without MONGODB_URI (local development) a JSON
 * file next to the server does the same job for a single process.
 *
 * Either way, a profile is read into memory when its player joins (`fetchProfile`, in
 * onAuth), used synchronously while they play, and written back in batches.
 */

// DATA_DIR lets a container point the file store somewhere its (non-root) user may write.
const DATA_DIR = process.env.DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const FILE = path.join(DATA_DIR, 'profiles.json')
const FLUSH_MS = 5_000
const TOP_REFRESH_MS = 30_000
/** Profiles kept in memory per pod before saved, inactive ones are let go. */
const CACHE_SOFT_LIMIT = 500

/** key -> profile, for everyone this pod has loaded (or, in file mode, everyone). */
const cache = new Map()
/** Keys changed since the last flush. */
const dirty = new Set()
/** The Mongo `profiles` collection, or null in file mode. */
let collection = null
/** Whether a key belongs to someone playing on this pod (set by the room). */
let isActive = () => false
/** The best players across every pod, from Mongo: refreshed in the background. */
let topCache = []

/** Opens storage. Call once before the server starts listening. */
export async function openStorage() {
  const uri = process.env.MONGODB_URI
  if (uri) {
    const { MongoClient } = await import('mongodb')
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, appName: 'mine-antarctica' })
    await client.connect()
    // The URI names this game's own database; with none, the driver's default is used.
    collection = client.db().collection('profiles')
    await collection.createIndex({ crystalsMined: -1 }).catch(() => {})
    await collection.createIndex({ cash: -1 }).catch(() => {})
    console.log('[storage] using MongoDB')
    await refreshTop()
    setInterval(() => void refreshTop(), TOP_REFRESH_MS).unref()
  } else {
    try {
      const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'))
      for (const [key, value] of Object.entries(saved)) cache.set(key, value)
    } catch {
      // No file yet: a fresh start.
    }
    console.log(`[storage] using ${FILE} (set MONGODB_URI to use MongoDB)`)
  }
  setInterval(() => void flushProfiles(), FLUSH_MS).unref()
}

/** The room tells storage who is playing here, so their profiles stay in memory. */
export function setActivePredicate(fn) {
  isActive = fn
}

/**
 * Reads a profile from the database into memory (always fresh: another pod may have
 * saved it since). Returns it, or null for a new player. Never throws - a database
 * hiccup must not stop anyone playing - but then the player starts from what's cached.
 */
export async function fetchProfile(key) {
  if (!key) return null
  if (collection) {
    try {
      const doc = await collection.findOne({ _id: key })
      if (doc) {
        const { _id, ...profile } = doc
        // Keep a newer unsaved copy of our own over what the database has.
        if (!dirty.has(key)) cache.set(key, profile)
      }
    } catch (err) {
      console.warn('[storage] could not read a profile:', err?.message || err)
    }
  }
  return cache.get(key) ?? null
}

/** A profile already in memory (see fetchProfile). */
export function loadProfile(key) {
  return cache.get(key) ?? null
}

export function saveProfile(key, data) {
  if (!key) return
  // A guest save once carried into an account stays marked, so it's never carried twice.
  const carriedTo = cache.get(key)?.carriedTo
  const profile = carriedTo ? { ...data, carriedTo, savedAt: Date.now() } : { ...data, savedAt: Date.now() }
  cache.set(key, profile)
  dirty.add(key)
}

/**
 * Boxity guest progress: when a browser that played as Boxity guests signs in to an
 * account with no progress here yet, the first of those guests' saves (`guestKeys`)
 * that was never carried before becomes the account's, and that guest save is marked
 * used so it can never be copied into a second account. An account that already has
 * progress is left untouched. Fetch the account's and the guests' profiles first.
 * Returns the key carried from, or null.
 */
export function adoptGuest(key, guestKeys) {
  if (!key || cache.has(key)) return null
  for (const guestKey of guestKeys) {
    const guest = cache.get(guestKey)
    if (!guest || guest.carriedTo || guestKey === key) continue
    const { savedAt: _savedAt, carriedTo: _carriedTo, ...progress } = guest
    cache.set(key, { ...progress, carriedFrom: guestKey, savedAt: Date.now() })
    cache.set(guestKey, { ...guest, carriedTo: key })
    dirty.add(key)
    dirty.add(guestKey)
    return guestKey
  }
  return null
}

/** The best players for the all-time boards: everyone in memory, plus the top of the database. */
export function allProfiles() {
  const rows = new Map()
  for (const row of topCache) rows.set(`db:${row.name}:${row.savedAt}`, row)
  for (const [key, p] of cache) if (!p.carriedTo) rows.set(key, p)
  return [...rows.values()]
}

async function refreshTop() {
  if (!collection) return
  try {
    const fields = { projection: { name: 1, crystalsMined: 1, cash: 1, savedAt: 1, carriedTo: 1 } }
    const [byCrystals, byCash] = await Promise.all([
      collection.find({ carriedTo: { $exists: false } }, fields).sort({ crystalsMined: -1 }).limit(8).toArray(),
      collection.find({ carriedTo: { $exists: false } }, fields).sort({ cash: -1 }).limit(8).toArray(),
    ])
    topCache = [...byCrystals, ...byCash].map(({ _id, ...row }) => row)
  } catch (err) {
    console.warn('[storage] could not refresh the boards:', err?.message || err)
  }
}

/** Writes everything changed to the database (or the file). Never throws. */
export async function flushProfiles() {
  if (!dirty.size) return
  const keys = [...dirty]
  dirty.clear()
  try {
    if (collection) {
      await collection.bulkWrite(
        keys.map((key) => ({ replaceOne: { filter: { _id: key }, replacement: { ...cache.get(key), _id: key }, upsert: true } })),
        { ordered: false },
      )
    } else {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      // Write-then-rename, so a crash mid-write can't leave a truncated file.
      const tmp = `${FILE}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(cache)))
      fs.renameSync(tmp, FILE)
    }
  } catch (err) {
    // Try again at the next flush.
    for (const key of keys) dirty.add(key)
    console.warn('[storage] could not save profiles:', err?.message || err)
    return
  }
  // Saved profiles of people no longer here don't need to sit in memory.
  if (collection && cache.size > CACHE_SOFT_LIMIT) {
    for (const key of keys) if (!dirty.has(key) && !isActive(key)) cache.delete(key)
  }
}

process.on('exit', () => {
  // Last resort in file mode (a normal shutdown flushes before this).
  if (!collection && dirty.size) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(cache)))
    } catch {
      // Nothing more can be done.
    }
  }
})
