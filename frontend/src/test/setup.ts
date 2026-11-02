import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

import { installMatchMedia, resetMatchMedia } from './match-media'

installMatchMedia()

beforeEach(() => {
  window.localStorage.clear()
  resetMatchMedia()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  cleanup()
})
