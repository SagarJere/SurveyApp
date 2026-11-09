import { api } from '@/lib/api'

import type { AuthUser, LoginResponse, Role } from './types'

export async function login(employeeId: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>(
    '/auth/login',
    { employee_id: employeeId },
    // A failed login is shown on the form, not as a redirect or a toast.
    { skipAuthRedirect: true, skipErrorToast: true },
  )
  return response.data
}

export async function fetchMe(signal?: AbortSignal): Promise<AuthUser> {
  const response = await api.get<AuthUser>('/auth/me', { signal })
  return response.data
}

export interface DevPerson {
  employee_id: string
  name: string | null
  role: Role
  department: string | null
  location: string | null
  /** How many survey audiences this person is in. */
  surveys: number
}

export interface DevPeople {
  items: DevPerson[]
  total: number
}

/** People to pick from on the dev sign-in page (AUTH_MODE=dev only). */
export async function fetchDevPeople(search: string, signal?: AbortSignal): Promise<DevPeople> {
  const response = await api.get<DevPeople>('/auth/dev-people', {
    params: { search: search || undefined, limit: 20 },
    signal,
    // The picker shows its own message; typing an ID by hand still works.
    skipErrorToast: true,
    skipAuthRedirect: true,
  })
  return response.data
}
