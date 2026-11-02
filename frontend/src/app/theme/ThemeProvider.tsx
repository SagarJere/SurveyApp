import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { safeStorage } from '@/lib/storage'

import {
  isTheme,
  THEME_STORAGE_KEY,
  ThemeContext,
  type ResolvedTheme,
  type Theme,
  type ThemeContextValue,
} from './theme-context'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

function readStoredTheme(fallback: Theme): Theme {
  const stored = safeStorage.get(THEME_STORAGE_KEY)
  return isTheme(stored) ? stored : fallback
}

function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: Theme
}

/** Light / dark / system colour theme, saved per browser. index.html applies it before paint. */
export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme(defaultTheme))
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      setSystem(media.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', onChange)
    return () => {
      media.removeEventListener('change', onChange)
    }
  }, [])

  // Another tab changed the theme.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && isTheme(event.newValue)) setThemeState(event.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const resolvedTheme: ResolvedTheme = theme === 'system' ? system : theme

  useEffect(() => {
    applyTheme(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback((next: Theme) => {
    safeStorage.set(THEME_STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
