/** Use the fallback when a VITE_* variable is missing or blank (an empty line in .env). */
function valueOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : fallback
}

export type AuthMode = 'dev' | 'sso'

function authMode(value: string | undefined): AuthMode {
  return valueOr(value, 'dev') === 'sso' ? 'sso' : 'dev'
}

/** Typed access to build-time configuration (VITE_* variables from the repo-root .env). */
export const env = {
  apiBaseUrl: valueOr(import.meta.env.VITE_API_BASE_URL, '/api'),
  appName: valueOr(import.meta.env.VITE_APP_NAME, 'Pulse'),
  /** Must match the backend's AUTH_MODE. "dev" signs in with an employee ID only. */
  authMode: authMode(import.meta.env.VITE_AUTH_MODE),
} as const
