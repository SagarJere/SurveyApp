import { vi } from 'vitest'

/** jsdom has no matchMedia. Tests flip the OS dark-mode preference with `setPrefersDark`. */
const state = { prefersDark: false }
const listeners = new Set<(event: MediaQueryListEvent) => void>()

export function setPrefersDark(value: boolean): void {
  state.prefersDark = value
  for (const listener of listeners) {
    listener({ matches: value, media: '(prefers-color-scheme: dark)' } as MediaQueryListEvent)
  }
}

export function resetMatchMedia(): void {
  state.prefersDark = false
  listeners.clear()
}

export function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) =>
      ({
        get matches() {
          return query.includes('dark') ? state.prefersDark : false
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener)
        },
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener)
        },
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  })
}
