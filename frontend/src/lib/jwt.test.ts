import { describe, expect, it } from 'vitest'

import { fakeToken, TEST_USERS } from '@/test/auth'

import { isTokenExpired, tokenExpiresAt } from './jwt'

describe('token expiry', () => {
  it('reads exp in milliseconds', () => {
    const token = fakeToken(TEST_USERS.hr, 60)
    const expiresAt = tokenExpiresAt(token)

    expect(expiresAt).not.toBeNull()
    expect(Math.abs((expiresAt ?? 0) - (Date.now() + 60_000))).toBeLessThan(2000)
  })

  it('treats live tokens as valid and old ones as expired', () => {
    expect(isTokenExpired(fakeToken(TEST_USERS.hr, 3600))).toBe(false)
    expect(isTokenExpired(fakeToken(TEST_USERS.hr, -1))).toBe(true)
  })

  it('expires tokens a little early', () => {
    expect(isTokenExpired(fakeToken(TEST_USERS.hr, 5))).toBe(true)
  })

  it.each(['', 'abc', 'a.b.c', 'a.e30.c'])('treats unreadable token %j as expired', (token) => {
    expect(tokenExpiresAt(token)).toBeNull()
    expect(isTokenExpired(token)).toBe(true)
  })
})
