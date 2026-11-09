/**
 * Read a JWT's expiry without verifying it. The server verifies every request; this only
 * lets the app drop a token it already knows is expired instead of sending it.
 */
function readClaims(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const claims: unknown = JSON.parse(json)
    return typeof claims === 'object' && claims !== null
      ? (claims as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function tokenExpiresAt(token: string): number | null {
  const exp = readClaims(token)?.exp
  return typeof exp === 'number' ? exp * 1000 : null
}

/** The employee ID the token was issued to (its `sub`), or null if unreadable. */
export function tokenSubject(token: string): string | null {
  const sub = readClaims(token)?.sub
  return typeof sub === 'string' && sub ? sub : null
}

/** Treat tokens as expired slightly early, so a request never leaves with a dying token. */
export const TOKEN_EXPIRY_MARGIN_MS = 10_000

/** True when the token is unreadable or within the safety margin of its expiry. */
export function isTokenExpired(token: string, now: number = Date.now()): boolean {
  const expiresAt = tokenExpiresAt(token)
  return expiresAt === null || expiresAt - TOKEN_EXPIRY_MARGIN_MS <= now
}
