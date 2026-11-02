import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import { tokenStore } from '@/lib/token-store'
import { fakeToken, TEST_USERS } from '@/test/auth'
import { renderRoute } from '@/test/render'

import * as authApi from './api'
import type { AuthUser } from './types'

function loginSucceedsAs(user: AuthUser) {
  vi.spyOn(authApi, 'fetchMe').mockResolvedValue(user)
  return vi.spyOn(authApi, 'login').mockResolvedValue({
    access_token: fakeToken(user),
    token_type: 'bearer',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    user,
  })
}

async function signIn(id: string) {
  await userEvent.type(await screen.findByLabelText('Employee ID'), id)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('LoginPage', () => {
  it('shows the employee ID form with a hint', async () => {
    renderRoute('/login')

    const field = await screen.findByLabelText('Employee ID')
    expect(field).toHaveFocus()
    expect(field).toHaveAccessibleDescription(
      'This test environment signs you in with your employee ID only.',
    )
    expect(document.title).toBe('Sign in · Pulse')
  })

  it('sends the normalised ID and lands on My surveys', async () => {
    const login = loginSucceedsAs(TEST_USERS.employee)
    const { router } = renderRoute('/login')

    await signIn('  e2001 ')

    expect(login).toHaveBeenCalledWith('E2001')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(await screen.findByRole('heading', { name: 'My surveys' })).toBeInTheDocument()
    expect(tokenStore.get()).not.toBeNull()
  })

  it('returns to the page you asked for', async () => {
    loginSucceedsAs(TEST_USERS.hr)
    const { router } = renderRoute('/login?next=%2Fadmin%2Fsurveys')

    await signIn('E1002')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/surveys')
    })
  })

  it('ignores a next link to another site', async () => {
    loginSucceedsAs(TEST_USERS.hr)
    const { router } = renderRoute('/login?next=https%3A%2F%2Fevil.example')

    await signIn('E1002')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })

  it('validates on the form before calling the API', async () => {
    const login = vi.spyOn(authApi, 'login')
    renderRoute('/login')

    await signIn('E 12')

    expect(await screen.findByRole('alert')).toHaveTextContent("Employee IDs can't contain spaces.")
    expect(screen.getByLabelText('Employee ID')).toHaveAttribute('aria-invalid', 'true')
    expect(login).not.toHaveBeenCalled()
  })

  it('asks for an ID when the field is empty', async () => {
    renderRoute('/login')

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your employee ID.')
  })

  it('shows the server field error', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'The request has 1 invalid field.',
        details: { issues: [{ field: 'employee_id', message: 'Server says no.' }] },
      }),
    )
    renderRoute('/login')

    await signIn('E1')

    expect(await screen.findByRole('alert')).toHaveTextContent('Server says no.')
  })

  it('shows a form-level error when the server is unreachable', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiError({ status: null, code: 'NETWORK_ERROR', message: "Can't reach the server." }),
    )
    renderRoute('/login')

    await signIn('E1')

    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server.")
    expect(tokenStore.get()).toBeNull()
  })

  it('explains an expired session', async () => {
    renderRoute('/login?reason=expired')

    expect(await screen.findByText('Your session has expired. Please sign in again.')).toBeVisible()
  })

  it('sends signed-in people straight on', async () => {
    const { router } = renderRoute('/login', { user: TEST_USERS.hr })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })
})
