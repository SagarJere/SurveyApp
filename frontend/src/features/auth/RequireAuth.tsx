import { CloudOffIcon } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router'

import { EmptyState } from '@/components/empty-state'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'

import { loginPath } from './redirect'
import { useAuth } from './use-auth'

/** Route guard: everything below it needs a signed-in user. */
export function RequireAuth() {
  const { status, signOutReason, endedSessionOf, signedOutByChoice, retry } = useAuth()
  const location = useLocation()

  if (status === 'signed-out') {
    // After "Sign out", don't remember the page: the next person to sign in may be someone else.
    if (signedOutByChoice) return <Navigate to="/login" replace />
    const next = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={loginPath(next, signOutReason, endedSessionOf)} replace />
  }

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          level={1}
          icon={CloudOffIcon}
          title="We couldn't load your account"
          description="Check your connection, then try again."
          action={<Button onClick={retry}>Try again</Button>}
        />
      </div>
    )
  }

  if (status === 'loading') return <PageLoader label="Loading your account…" />

  return <Outlet />
}
