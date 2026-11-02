/**
 * Read a JWT's expiry without verifying it. The server verifies every request; this only
 * lets the app drop a token it already knows is expired instead of sending it.
 */
export function tokenExpiresAt(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const claims: unknown = JSON.parse(json)
    if (typeof claims !== 'object' || claims === null) return null
    const exp = (claims as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

/** Treat tokens as expired slightly early, so a request never leaves with a dying token. */
export const TOKEN_EXPIRY_MARGIN_MS = 10_000

/** True when the token is unreadable or within the safety margin of its expiry. */
export function isTokenExpired(token: string, now: number = Date.now()): boolean {
  const expiresAt = tokenExpiresAt(token)
  return expiresAt === null || expiresAt - TOKEN_EXPIRY_MARGIN_MS <= now
}
