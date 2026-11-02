import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

import { tokenStore } from '@/lib/token-store'

import { installMatchMedia, resetMatchMedia } from './match-media'

installMatchMedia()

beforeEach(() => {
  tokenStore.clear()
  window.localStorage.clear()
  resetMatchMedia()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  cleanup()
})
