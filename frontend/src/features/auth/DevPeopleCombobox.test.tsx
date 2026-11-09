import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { fakeToken } from '@/test/auth'
import { renderRoute } from '@/test/render'

import * as authApi from './api'
import type { DevPerson } from './api'
import type { AuthUser } from './types'

const PEOPLE: DevPerson[] = [
  {
    employee_id: 'E1001',
    name: 'Asha Rao',
    role: 'admin',
    department: null,
    location: null,
    surveys: 0,
  },
  {
    employee_id: 'E1002',
    name: 'Vikram Mehta',
    role: 'hr',
    department: null,
    location: null,
    surveys: 0,
  },
  {
    employee_id: 'T3001',
    name: 'Test person 3001',
    role: 'employee',
    department: 'Sales',
    location: 'Pune',
    surveys: 2,
  },
]

function mockLogin() {
  return vi.spyOn(authApi, 'login').mockImplementation((employeeId) => {
    const person = PEOPLE.find((p) => p.employee_id === employeeId)
    const user: AuthUser = {
      employee_id: employeeId,
      name: person?.name ?? null,
      role: person?.role ?? 'employee',
    }
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue(user)
    return Promise.resolve({
      access_token: fakeToken(user),
      token_type: 'bearer',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      user,
    })
  })
}

let search: MockInstance<typeof authApi.fetchDevPeople>

beforeEach(() => {
  search = vi.spyOn(authApi, 'fetchDevPeople').mockImplementation((term) => {
    const t = term.toLowerCase()
    const items = PEOPLE.filter(
      (p) => p.employee_id.toLowerCase().includes(t) || (p.name ?? '').toLowerCase().includes(t),
    )
    return Promise.resolve({ items, total: t ? items.length : 431 })
  })
})

describe('Dev sign-in picker', () => {
  it('lists people with their role, department and surveys', async () => {
    const user = userEvent.setup()
    renderRoute('/login')
    const field = await screen.findByRole('combobox', { name: 'Employee ID' })
    expect(field).toHaveAttribute('aria-expanded', 'false')

    await user.click(field)

    const list = await screen.findByRole('listbox', { name: 'Employees' })
    expect(field).toHaveAttribute('aria-expanded', 'true')
    const options = await within(list).findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      'Asha RaoAdminE1001',
      'Vikram MehtaHRE1002',
      'Test person 3001T3001 · Sales · in 2 surveys',
    ])
    expect(screen.getByText('Showing 3 of 431. Type a name or ID to narrow it down.')).toBeVisible()
  })

  it('searches as you type and signs in when you pick someone', async () => {
    const login = mockLogin()
    const user = userEvent.setup()
    const { router } = renderRoute('/login')

    await user.type(await screen.findByRole('combobox', { name: 'Employee ID' }), 'vik')
    await waitFor(() => {
      expect(search).toHaveBeenLastCalledWith('vik', expect.anything())
    })
    await user.click(await screen.findByRole('option', { name: /Vikram Mehta/ }))

    expect(login).toHaveBeenCalledWith('E1002')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })

  it('works with the keyboard: arrows to highlight, Enter to sign in, Escape to close', async () => {
    const login = mockLogin()
    const user = userEvent.setup()
    renderRoute('/login')
    const field = await screen.findByRole('combobox', { name: 'Employee ID' })

    await user.keyboard('{ArrowDown}')
    await screen.findAllByRole('option')
    await user.keyboard('{Escape}')
    expect(field).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    const active = field.getAttribute('aria-activedescendant')
    expect(active && document.getElementById(active)).toHaveTextContent('Vikram Mehta')
    await user.keyboard('{Enter}')

    expect(login).toHaveBeenCalledWith('E1002')
  })

  it('still signs in with an ID that is not in the list', async () => {
    const login = mockLogin()
    const user = userEvent.setup()
    renderRoute('/login')

    await user.type(await screen.findByRole('combobox', { name: 'Employee ID' }), 'x77')
    expect(
      await screen.findByText('No one matches. You can still sign in with any ID.'),
    ).toBeInTheDocument()
    await user.keyboard('{Enter}')

    expect(login).toHaveBeenCalledWith('X77')
  })
})
