import { describe, expect, it } from 'vitest'

import { afterSignIn, loginPath, safeNextPath } from './redirect'

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

describe('loginPath with an owner', () => {
  it('remembers whose page it was, only when there is a page to go back to', () => {
    expect(loginPath('/admin/surveys', 'expired', 'E1002')).toBe(
      '/login?next=%2Fadmin%2Fsurveys&reason=expired&for=E1002',
    )
    expect(loginPath('/', null, 'E1002')).toBe('/login')
    expect(loginPath(undefined, 'expired', 'E1002')).toBe('/login?reason=expired')
  })
})

describe('afterSignIn', () => {
  it('reopens the page for the person it belongs to', () => {
    expect(afterSignIn('/admin/surveys', 'E1002', 'E1002')).toBe('/admin/surveys')
    expect(afterSignIn('/admin/surveys', 'e1002', 'E1002')).toBe('/admin/surveys')
  })

  it('sends anyone else home', () => {
    expect(afterSignIn('/admin/surveys', 'E1002', 'E2001')).toBe('/')
  })

  it('follows a shared link when nobody owned the page', () => {
    expect(afterSignIn('/s/abc', null, 'E2001')).toBe('/s/abc')
  })

  it('still refuses unsafe paths', () => {
    expect(afterSignIn('https://evil.example', null, 'E2001')).toBe('/')
  })
})
