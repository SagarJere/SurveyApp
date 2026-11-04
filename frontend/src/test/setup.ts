import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach } from 'vitest'

import { tokenStore } from '@/lib/token-store'

import { installMatchMedia, resetMatchMedia } from './match-media'

installMatchMedia()

// jsdom doesn't implement these; the builder scrolls cards into view and Radix menus use
// pointer capture.
Element.prototype.scrollIntoView = () => undefined
window.scrollTo = () => undefined
Element.prototype.hasPointerCapture = () => false
Element.prototype.setPointerCapture = () => undefined
Element.prototype.releasePointerCapture = () => undefined
globalThis.ResizeObserver = class {
  observe() {
    return undefined
  }
  unobserve() {
    return undefined
  }
  disconnect() {
    return undefined
  }
}

beforeEach(() => {
  tokenStore.clear()
  window.localStorage.clear()
  resetMatchMedia()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  cleanup()
  toast.dismiss()
})
