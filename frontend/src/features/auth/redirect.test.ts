import { describe, expect, it } from 'vitest'

import { loginPath, safeNextPath } from './redirect'

describe('safeNextPath', () => {
  it.each(['/admin/surveys', '/s/abc?x=1', '/admin/surveys/1/results#top'])(
    'keeps same-site path %s',
    (next) => {
      expect(safeNextPath(next)).toBe(next)
    },
  )

  it.each([
    null,
    undefined,
    '',
    'admin',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/login',
    '/login?next=/x',
    '/a\nb',
  ])('falls back to / for %j', (next) => {
    expect(safeNextPath(next)).toBe('/')
  })
})

describe('loginPath', () => {
  it('builds the sign-in link', () => {
    expect(loginPath()).toBe('/login')
    expect(loginPath('/')).toBe('/login')
    expect(loginPath('/admin/surveys')).toBe('/login?next=%2Fadmin%2Fsurveys')
    expect(loginPath('/s/1', 'expired')).toBe('/login?next=%2Fs%2F1&reason=expired')
  })
})
