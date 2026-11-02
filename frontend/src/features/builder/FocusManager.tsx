import { useEffect } from 'react'

import { useBuilderStore } from './store'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Moves focus after the builder re-renders: to a new question's text, a new option, or the
 * arrow button of a moved card (or the other arrow when it reached the top or bottom).
 */
export function FocusManager() {
  const request = useBuilderStore((s) => s.focusRequest)
  const clear = useBuilderStore((s) => s.requestFocus)

  useEffect(() => {
    if (!request) return undefined
    const frame = window.requestAnimationFrame(() => {
      let element = document.querySelector<HTMLElement>(request)
      if (element instanceof HTMLButtonElement && element.disabled) {
        // A card moved to the very top/bottom: its arrow is now disabled, so use the other one.
        const other = request.replace(/"(up|down):/, (_, dir: string) =>
          dir === 'up' ? '"down:' : '"up:',
        )
        element = document.querySelector<HTMLElement>(other)
      }
      if (element) {
        element.focus({ preventScroll: true })
        element.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
      }
      clear(null)
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [request, clear])

  return null
}
