export type Role = 'admin' | 'hr' | 'employee'

export interface AuthUser {
  employee_id: string
  name: string | null
  role: Role
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  expires_at: string
  user: AuthUser
}

/** HR and admins build surveys and see results. Admins can do everything HR can. */
export const SURVEY_MANAGER_ROLES: readonly Role[] = ['hr', 'admin']

export function canManageSurveys(user: AuthUser | null | undefined): boolean {
  return !!user && SURVEY_MANAGER_ROLES.includes(user.role)
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  hr: 'HR',
  employee: 'Employee',
}
