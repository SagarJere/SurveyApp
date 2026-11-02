import { describe, expect, it } from 'vitest'

import { ApiError } from './api'
import { shouldRetry } from './query-client'

const make = (status: number | null) => new ApiError({ status, code: 'X', message: 'x' })

describe('shouldRetry', () => {
  it('retries network and server errors up to the limit', () => {
    expect(shouldRetry(0, make(null))).toBe(true)
    expect(shouldRetry(1, make(503))).toBe(true)
    expect(shouldRetry(2, make(503))).toBe(false)
  })

  it('never retries client errors', () => {
    expect(shouldRetry(0, make(400))).toBe(false)
    expect(shouldRetry(0, make(404))).toBe(false)
  })

  it('does not retry unknown errors', () => {
    expect(shouldRetry(0, new Error('x'))).toBe(false)
  })
})
