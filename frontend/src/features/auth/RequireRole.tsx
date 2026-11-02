import { Outlet } from 'react-router'

import { ForbiddenPage } from '@/app/pages/ForbiddenPage'

import type { Role } from './types'
import { useAuth } from './use-auth'

/** Route guard: only the given roles may see what's below. Place it inside RequireAuth. */
export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) return <ForbiddenPage />
  return <Outlet />
}
