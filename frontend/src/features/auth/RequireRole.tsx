import { Outlet } from 'react-router'

import { ForbiddenPage } from '@/app/pages/ForbiddenPage'

import type { Role } from './types'
import { useAuth } from './use-auth'

interface RequireRoleProps {
  roles: readonly Role[]
  /** Set when the route has no page layout around it, so the message gets its own spacing. */
  standalone?: boolean
}

/** Route guard: only the given roles may see what's below. Place it inside RequireAuth. */
export function RequireRole({ roles, standalone = false }: RequireRoleProps) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) {
    return standalone ? (
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-10">
        <ForbiddenPage />
      </main>
    ) : (
      <ForbiddenPage />
    )
  }
  return <Outlet />
}
