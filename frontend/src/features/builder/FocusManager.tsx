import { useLayoutEffect } from 'react'

import { useBuilderStore } from './store'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function findTarget(request: string): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(request)
  if (element instanceof HTMLButtonElement && element.disabled) {
    // A card moved to the very top/bottom: its arrow is now disabled, so use the other one.
    const other = request.replace(/"(up|down):/, (_, dir: string) =>
      dir === 'up' ? '"down:' : '"up:',
    )
    return document.querySelector<HTMLElement>(other)
  }
  return element
}

function focus(element: HTMLElement) {
  element.focus({ preventScroll: true })
  element.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
}

/**
 * Moves focus after the builder re-renders: to a new question's text, a new option, or the
 * arrow button of a moved card. Runs right after React updates the page, so there is no gap
 * in which the person's own click could be overridden.
 */
export function FocusManager() {
  const request = useBuilderStore((s) => s.focusRequest)
  const clear = useBuilderStore((s) => s.requestFocus)

  useLayoutEffect(() => {
    if (!request) return undefined
    const element = findTarget(request)
    if (element) {
      focus(element)
      clear(null)
      return undefined
    }
    // Not on the page yet (rare): try once more on the next frame, unless the person has
    // moved focus somewhere themselves in the meantime.
    const focusedNow = document.activeElement
    const frame = window.requestAnimationFrame(() => {
      const later = findTarget(request)
      if (later && document.activeElement === focusedNow) focus(later)
      clear(null)
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [request, clear])

  return null
}
