/**
 * Where Boxity is, as the platform tells this page: prod, stage or local. The one place
 * Boxity URLs come from - never worked out from a hostname, the referrer or a build flag,
 * and never baked into the build.
 *
 * The SDK knows once it has loaded (from window.BLOXITY_ENV, which Boxity injects into
 * the pages it serves, or from the portal's handshake when embedded). Before that,
 * window.BLOXITY_ENV itself. Told nothing, production - which is what a page Boxity
 * doesn't serve (a separate CrazyGames build, say) should use.
 */
const PROD = {
  env: 'prod',
  apiUrl: 'https://api.bloxity.io',
  playUrl: 'https://play.bloxity.io',
  portalUrl: 'https://bloxity.io',
  staticUrl: 'https://static.bloxity.io',
}

/** `{ env, apiUrl, playUrl, portalUrl, staticUrl }` for the environment this page is in. */
export function boxityEnv() {
  try {
    const sdk = typeof window !== 'undefined' ? window.Legion?.SDK : null
    if (sdk?.environment) return sdk.environment()
  } catch {
    // Fall through to what the page was told.
  }
  const told = typeof window !== 'undefined' ? window.BLOXITY_ENV : null
  return told && told.apiUrl ? { ...PROD, ...told } : PROD
}

/** Whether this page was told its environment at all (Boxity serves it, or a dev server says). */
export const toldEnvironment = () => typeof window !== 'undefined' && Boolean(window.BLOXITY_ENV?.apiUrl)

/** The avatar CDN: models, items and skins. */
export const avatarCdn = () => `${boxityEnv().staticUrl}/avatars`
