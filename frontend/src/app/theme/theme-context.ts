import { createContext } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeContextValue {
  /** What the user picked. */
  theme: Theme
  /** What is actually showing (system resolved to light or dark). */
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export const THEME_STORAGE_KEY = 'survey-app.theme'
export const THEMES: readonly Theme[] = ['light', 'dark', 'system']

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}
