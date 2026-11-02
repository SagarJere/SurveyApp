/**
 * Where to go after signing in. Only same-site paths are allowed, so a crafted
 * `/login?next=https://evil.example` link can't send people elsewhere.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next?.startsWith('/')) return fallback
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback
  if (hasControlCharacters(next)) return fallback
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return fallback
  return next
}

export function loginPath(next?: string, reason?: SignOutReason | null): string {
  const params = new URLSearchParams()
  if (next && next !== '/') params.set('next', next)
  if (reason) params.set('reason', reason)
  const query = params.toString()
  return query ? `/login?${query}` : '/login'
}

export type SignOutReason = 'expired'

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}
