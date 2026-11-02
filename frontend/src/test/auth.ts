import { vi } from 'vitest'

import * as authApi from '@/features/auth/api'
import type { AuthUser, Role } from '@/features/auth/types'
import { tokenStore } from '@/lib/token-store'

export const TEST_USERS = {
  admin: { employee_id: 'E1001', name: 'Asha Rao', role: 'admin' },
  hr: { employee_id: 'E1002', name: 'Vikram Mehta', role: 'hr' },
  employee: { employee_id: 'E2001', name: 'Priya Nair', role: 'employee' },
} as const satisfies Record<Role, AuthUser>

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** An unsigned JWT-shaped token. The frontend only reads `exp`; the server is mocked. */
export function fakeToken(user: AuthUser, expiresInSeconds = 3600): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      sub: user.employee_id,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    }),
  )
  return `${header}.${payload}.signature`
}

/** Put a session in storage and make /auth/me answer with this user. */
export function signInAs(user: AuthUser, expiresInSeconds = 3600) {
  tokenStore.set(fakeToken(user, expiresInSeconds))
  return vi.spyOn(authApi, 'fetchMe').mockResolvedValue(user)
}
