import { api } from '@/lib/api'

import type { AuthUser, LoginResponse } from './types'

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
