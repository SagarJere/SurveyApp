import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as surveysApi from '@/features/surveys/api'
import { AxiosError } from 'axios'

import { api, ApiError } from '@/lib/api'
import { tokenStore } from '@/lib/token-store'
import { fakeToken, TEST_USERS } from '@/test/auth'
import { renderRoute } from '@/test/render'
import { mockRespondDefaults, NOT_AVAILABLE } from '@/test/respond'

import * as authApi from './api'
import type { AuthUser } from './types'

/** Sign in on the sign-in page as `person` (the login request is mocked). */
async function signInAs(user: ReturnType<typeof userEvent.setup>, person: AuthUser) {
  vi.spyOn(authApi, 'fetchDevPeople').mockResolvedValue({ items: [], total: 0 })
  vi.spyOn(authApi, 'fetchMe').mockResolvedValue(person)
  vi.spyOn(authApi, 'login').mockResolvedValue({
    access_token: fakeToken(person),
    token_type: 'bearer',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    user: person,
  })
  await user.type(await screen.findByLabelText('Employee ID'), person.employee_id)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  mockRespondDefaults()
  vi.spyOn(surveysApi, 'listSurveys').mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('protected routes', () => {
  it.each(['/', '/admin/surveys', '/s/abc'])(
    'send signed-out visitors from %s to sign in',
    async (path) => {
      const { router } = renderRoute(path)

      expect(await screen.findByLabelText('Employee ID')).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/login')
      expect(router.state.location.search).toBe(
        path === '/' ? '' : `?next=${encodeURIComponent(path)}`,
      )
    },
  )

  it('drops an expired stored token and says why', async () => {
    tokenStore.set(fakeToken(TEST_USERS.hr, -60))
    const fetchMe = vi.spyOn(authApi, 'fetchMe')
    const { router } = renderRoute('/admin/surveys')

    expect(
      await screen.findByText('Your session has expired. Please sign in again.'),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(tokenStore.get()).toBeNull()
    expect(fetchMe).not.toHaveBeenCalled()
  })

  it('shows a retry screen when the account fails to load', async () => {
    tokenStore.set(fakeToken(TEST_USERS.hr))
    const fetchMe = vi
      .spyOn(authApi, 'fetchMe')
      .mockRejectedValueOnce(new ApiError({ status: null, code: 'NETWORK_ERROR', message: 'x' }))
      .mockResolvedValue(TEST_USERS.hr)
    renderRoute('/')

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: 'My surveys' })).toBeInTheDocument()
    expect(fetchMe).toHaveBeenCalledTimes(2)
  })
})

describe('role-based navigation', () => {
  it('shows HR the Surveys link', async () => {
    renderRoute('/', { user: TEST_USERS.hr })

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Surveys' })).toBeInTheDocument()
  })

  it('shows admins the Surveys link', async () => {
    renderRoute('/', { user: TEST_USERS.admin })

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Surveys' })).toBeInTheDocument()
  })

  it('hides the Surveys link from employees', async () => {
    renderRoute('/', { user: TEST_USERS.employee })

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'My surveys' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Surveys' })).not.toBeInTheDocument()
  })

  it.each(['/admin/surveys', '/admin/surveys/1/edit', '/admin/surveys/1/results'])(
    'blocks employees from %s',
    async (path) => {
      renderRoute(path, { user: TEST_USERS.employee })

      expect(
        await screen.findByRole('heading', { name: "You don't have access to this page" }),
      ).toBeInTheDocument()
    },
  )

  it('lets employees open a survey link', async () => {
    renderRoute('/s/abc', { user: TEST_USERS.employee })

    expect(await screen.findByText(NOT_AVAILABLE)).toBeInTheDocument()
  })
})

describe('account menu and sign out', () => {
  it('shows who is signed in', async () => {
    renderRoute('/', { user: TEST_USERS.hr })

    await userEvent.click(await screen.findByRole('button', { name: 'Account: Vikram Mehta' }))

    expect(await screen.findByText('E1002 · HR')).toBeInTheDocument()
  })

  it('uses the employee ID when there is no name', async () => {
    renderRoute('/', { user: { employee_id: 'X77', name: null, role: 'employee' } })

    expect(await screen.findByRole('button', { name: 'Account: X77' })).toBeInTheDocument()
  })

  it('signs out and returns to the sign-in page', async () => {
    const { router } = renderRoute('/', { user: TEST_USERS.hr })

    await userEvent.click(await screen.findByRole('button', { name: 'Account: Vikram Mehta' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(router.state.location.search).toBe('')
    expect(tokenStore.get()).toBeNull()
  })

  it('forgets the page on sign-out, so the next person starts at their home page', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/admin/surveys', { user: TEST_USERS.hr })

    await user.click(await screen.findByRole('button', { name: 'Account: Vikram Mehta' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(router.state.location.search).toBe('')

    await signInAs(user, TEST_USERS.employee)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'My surveys' })).toBeVisible()
  })

  it('follows a sign-out in another tab', async () => {
    const { router } = renderRoute('/admin/surveys', { user: TEST_USERS.hr })
    await screen.findByRole('heading', { level: 1, name: 'Surveys' })

    act(() => {
      tokenStore.clear()
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Fsurveys&for=E1002')
  })
})

describe('session ending', () => {
  async function expireOn(path: string) {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    tokenStore.set(fakeToken(TEST_USERS.hr, 30))
    const rendered = renderRoute(path, { user: TEST_USERS.hr })
    tokenStore.set(fakeToken(TEST_USERS.hr, 30))
    await screen.findByRole('heading', { level: 1, name: 'Surveys' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })
    await waitFor(() => {
      expect(rendered.router.state.location.pathname).toBe('/login')
    })
    vi.useRealTimers()
    return rendered
  }

  it('reopens the page when the same person signs back in after their session expired', async () => {
    const { router } = await expireOn('/admin/surveys')
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Fsurveys&reason=expired&for=E1002')

    await signInAs(userEvent.setup(), TEST_USERS.hr)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/surveys')
    })
  })

  it("sends someone else to their own home page, not the expired person's page", async () => {
    const { router } = await expireOn('/admin/surveys')

    await signInAs(userEvent.setup(), TEST_USERS.employee)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })

  it('signs out when the token expires while the page is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { router } = renderRoute('/', { user: TEST_USERS.hr })
    tokenStore.set(fakeToken(TEST_USERS.hr, 30))
    await screen.findByRole('heading', { name: 'My surveys' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(router.state.location.search).toContain('reason=expired')
  })

  it('signs out on a 401 from any request and explains an expired session', async () => {
    const { router } = renderRoute('/admin/surveys', { user: TEST_USERS.hr })
    await screen.findByRole('heading', { level: 1, name: 'Surveys' })
    const adapter = api.defaults.adapter
    api.defaults.adapter = (config) =>
      Promise.reject(
        new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config,
          data: {
            error: { code: 'TOKEN_EXPIRED', message: 'Your session has expired.', details: {} },
          },
        }),
      )

    try {
      await act(async () => {
        await api.get('/anything').catch(() => undefined)
      })
    } finally {
      api.defaults.adapter = adapter
    }

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Fsurveys&reason=expired&for=E1002')
    expect(tokenStore.get()).toBeNull()
    expect(screen.getByText('Your session has expired. Please sign in again.')).toBeInTheDocument()
  })
})
