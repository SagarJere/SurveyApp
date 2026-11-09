import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { configureApiHandlers } from '@/lib/api'
import { isTokenExpired, TOKEN_EXPIRY_MARGIN_MS, tokenExpiresAt, tokenSubject } from '@/lib/jwt'
import { tokenStore } from '@/lib/token-store'

import { fetchMe } from './api'
import { AuthContext, authQueryKeys, type AuthContextValue, type AuthStatus } from './auth-context'
import type { SignOutReason } from './redirect'
import type { LoginResponse } from './types'

// setTimeout can't wait longer than ~24.8 days; tokens never live that long, but be safe.
const MAX_TIMER_MS = 2 ** 31 - 1

function subscribe(listener: () => void): () => void {
  return tokenStore.subscribe(() => {
    listener()
  })
}

function readToken(): string | null {
  return tokenStore.get()
}

function initialSignOutReason(): SignOutReason | null {
  const stored = tokenStore.get()
  return stored && isTokenExpired(stored) ? 'expired' : null
}

/** Whose session a token left over from an earlier visit belonged to, if it has expired. */
function initialEndedSessionOf(): string | null {
  const stored = tokenStore.get()
  return stored && isTokenExpired(stored) ? tokenSubject(stored) : null
}

/**
 * Holds the session: the access token (in tokenStore) and the signed-in user (from /auth/me).
 * Signs out automatically when the token expires or the API answers 401.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const token = useSyncExternalStore(subscribe, readToken, () => null)
  // A token left over from an earlier visit may already have expired.
  const [signOutReason, setSignOutReason] = useState<SignOutReason | null>(initialSignOutReason)
  const [endedSessionOf, setEndedSessionOf] = useState<string | null>(initialEndedSessionOf)
  const [signedOutByChoice, setSignedOutByChoice] = useState(false)

  const usableToken = token && !isTokenExpired(token) ? token : null

  // Remember whose session ends, however it ends (expiry, a 401, another tab), so the page they
  // were on is only reopened for them. A deliberate "Sign out" forgets the page regardless.
  useEffect(() => {
    const stored = tokenStore.get()
    let owner = stored ? tokenSubject(stored) : null
    return tokenStore.subscribe((next) => {
      if (next) {
        owner = tokenSubject(next)
        return
      }
      setEndedSessionOf(owner)
      owner = null
    })
  }, [])

  // Never keep a token we know has expired.
  useEffect(() => {
    if (token && !usableToken) tokenStore.clear()
  }, [token, usableToken])

  // Sign out at the moment the token expires, even if the person is idle.
  useEffect(() => {
    if (!usableToken) return undefined
    const expiresAt = tokenExpiresAt(usableToken)
    if (expiresAt === null) return undefined
    const timer = window.setTimeout(
      () => {
        setSignOutReason('expired')
        tokenStore.clear()
      },
      // Fire when isTokenExpired starts saying yes, so both agree on the moment.
      Math.min(Math.max(expiresAt - TOKEN_EXPIRY_MARGIN_MS - Date.now(), 0), MAX_TIMER_MS),
    )
    return () => {
      window.clearTimeout(timer)
    }
  }, [usableToken])

  // Any 401 from the API ends the session. The router then shows the sign-in page.
  useEffect(
    () =>
      configureApiHandlers({
        onUnauthorized: (error) => {
          setSignOutReason(error.code === 'TOKEN_EXPIRED' ? 'expired' : null)
          queryClient.clear()
        },
      }),
    [queryClient],
  )

  // Drop cached data from the previous person when the session ends (e.g. in another tab).
  useEffect(() => {
    if (!usableToken) queryClient.removeQueries({ queryKey: authQueryKeys.me })
  }, [usableToken, queryClient])

  const me = useQuery({
    queryKey: authQueryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    enabled: usableToken !== null,
    staleTime: 5 * 60_000,
  })

  const completeSignIn = useCallback(
    (response: LoginResponse) => {
      queryClient.clear()
      queryClient.setQueryData(authQueryKeys.me, response.user)
      setSignOutReason(null)
      setEndedSessionOf(null)
      setSignedOutByChoice(false)
      tokenStore.set(response.access_token)
    },
    [queryClient],
  )

  const signOut = useCallback(() => {
    setSignOutReason(null)
    setEndedSessionOf(null)
    // The page they were on is theirs; whoever signs in next starts at the home page.
    setSignedOutByChoice(true)
    tokenStore.clear()
    queryClient.clear()
  }, [queryClient])

  const { refetch } = me
  const retry = useCallback(() => {
    void refetch()
  }, [refetch])

  let status: AuthStatus
  if (!usableToken) status = 'signed-out'
  else if (me.data) status = 'signed-in'
  else if (me.isError) status = 'error'
  else status = 'loading'

  const user = usableToken ? (me.data ?? null) : null

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      signOutReason,
      endedSessionOf,
      signedOutByChoice,
      completeSignIn,
      signOut,
      retry,
    }),
    [
      status,
      user,
      signOutReason,
      endedSessionOf,
      signedOutByChoice,
      completeSignIn,
      signOut,
      retry,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
