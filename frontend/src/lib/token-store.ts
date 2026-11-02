import { safeStorage } from './storage'

const TOKEN_KEY = 'survey-app.access-token'

type Listener = (token: string | null) => void

let memoryToken: string | null = null
const listeners = new Set<Listener>()

function notify(token: string | null): void {
  for (const listener of listeners) listener(token)
}

/**
 * Holds the API access token (a JWT issued by the backend). The API client reads it on every
 * request; the auth feature writes it on login and clears it on logout or a 401.
 */
export const tokenStore = {
  get(): string | null {
    return memoryToken ?? safeStorage.get(TOKEN_KEY)
  },
  set(token: string): void {
    memoryToken = token
    safeStorage.set(TOKEN_KEY, token)
    notify(token)
  },
  clear(): void {
    const hadToken = this.get() !== null
    memoryToken = null
    safeStorage.remove(TOKEN_KEY)
    if (hadToken) notify(null)
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

// Keep tabs in sync: logging out in one tab logs out the others.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== TOKEN_KEY) return
    memoryToken = event.newValue
    notify(event.newValue)
  })
}
