/**
 * localStorage wrapper that never throws. Storage can be unavailable (private mode, blocked
 * site data, quota), and the app must keep working when it is.
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // Storage unavailable: the value lives only for this page load.
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Storage unavailable: nothing to remove.
    }
  },
}
