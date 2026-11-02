import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { setPrefersDark } from '@/test/match-media'

import { ThemeProvider } from './ThemeProvider'
import { ThemeToggle } from './ThemeToggle'
import { useTheme } from './use-theme'

function Probe() {
  const { theme, resolvedTheme } = useTheme()
  return (
    <p>
      {theme}/{resolvedTheme}
    </p>
  )
}

function renderTheme() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
      <Probe />
    </ThemeProvider>,
  )
}

async function pick(label: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Colour theme' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: label }))
}

describe('ThemeProvider', () => {
  it('follows the device setting by default', () => {
    setPrefersDark(true)

    renderTheme()

    expect(screen.getByText('system/dark')).toBeInTheDocument()
    expect(document.documentElement).toHaveClass('dark')
  })

  it('switches to dark and remembers the choice', async () => {
    renderTheme()

    await pick('Dark')

    expect(screen.getByText('dark/dark')).toBeInTheDocument()
    expect(document.documentElement).toHaveClass('dark')
    expect(window.localStorage.getItem('survey-app.theme')).toBe('dark')
  })

  it('switches back to light', async () => {
    window.localStorage.setItem('survey-app.theme', 'dark')
    renderTheme()

    await pick('Light')

    expect(document.documentElement).not.toHaveClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('reacts when the device setting changes while on "Match device"', () => {
    renderTheme()
    expect(document.documentElement).not.toHaveClass('dark')

    act(() => {
      setPrefersDark(true)
    })

    expect(document.documentElement).toHaveClass('dark')
  })

  it('ignores an invalid stored value', () => {
    window.localStorage.setItem('survey-app.theme', 'purple')

    renderTheme()

    expect(screen.getByText('system/light')).toBeInTheDocument()
  })

  it('throws a clear error outside the provider', () => {
    // React logs the thrown render error; that output is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const swallow = (event: ErrorEvent) => {
      event.preventDefault()
    }
    window.addEventListener('error', swallow)
    try {
      expect(() => render(<Probe />)).toThrow('useTheme must be used inside <ThemeProvider>')
    } finally {
      window.removeEventListener('error', swallow)
    }
  })
})
