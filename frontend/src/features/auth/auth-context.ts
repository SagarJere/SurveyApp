import { createContext } from 'react'

import type { SignOutReason } from './redirect'
import type { AuthUser, LoginResponse } from './types'

export type AuthStatus = 'signed-out' | 'loading' | 'signed-in' | 'error'

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  /** Why the last session ended, when it wasn't the person's choice. */
  signOutReason: SignOutReason | null
  /**
   * When the session ended without the person choosing to (expiry, 401): who it belonged to.
   * Null after "Sign out", which also forgets the page they were on.
   */
  endedSessionOf: string | null
  /** True after the person chose "Sign out": the next sign-in starts at the home page. */
  signedOutByChoice: boolean
  /** Store the session from a successful login. */
  completeSignIn: (response: LoginResponse) => void
  signOut: () => void
  /** Try loading the user again after a network error. */
  retry: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export const authQueryKeys = {
  me: ['auth', 'me'] as const,
}
