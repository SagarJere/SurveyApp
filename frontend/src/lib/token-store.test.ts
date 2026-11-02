import { afterEach, describe, expect, it, vi } from 'vitest'

import { tokenStore } from './token-store'

describe('tokenStore', () => {
  afterEach(() => {
    tokenStore.clear()
  })

  it('stores, reads and clears the token', () => {
    tokenStore.set('abc')
    expect(tokenStore.get()).toBe('abc')
    expect(window.localStorage.getItem('survey-app.access-token')).toBe('abc')

    tokenStore.clear()
    expect(tokenStore.get()).toBeNull()
  })

  it('notifies subscribers and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = tokenStore.subscribe(listener)

    tokenStore.set('abc')
    tokenStore.clear()
    unsubscribe()
    tokenStore.set('def')

    expect(listener.mock.calls).toEqual([['abc'], [null]])
  })

  it('keeps working when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })

    tokenStore.set('abc')

    expect(tokenStore.get()).toBe('abc')
  })

  it('follows changes made in another tab', () => {
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'survey-app.access-token', newValue: 'from-other-tab' }),
    )

    expect(tokenStore.get()).toBe('from-other-tab')
  })
})
