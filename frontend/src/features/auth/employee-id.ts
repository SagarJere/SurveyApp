/**
 * Mirror of backend/app/services/employee_ids.py. The backend is the authority; this gives
 * instant feedback on the form. Trim and uppercase; leading zeros are kept.
 */
export const MAX_EMPLOYEE_ID_LENGTH = 30

export function normalizeEmployeeId(raw: string): string {
  return raw.trim().toUpperCase()
}

/** Returns a message to show, or null when the ID is acceptable. */
export function employeeIdProblem(raw: string): string | null {
  const value = normalizeEmployeeId(raw)
  if (!value) return 'Enter your employee ID.'
  if (/\s/.test(value)) return "Employee IDs can't contain spaces."
  if (value.length > MAX_EMPLOYEE_ID_LENGTH) {
    return `Employee IDs can't be longer than ${MAX_EMPLOYEE_ID_LENGTH} characters.`
  }
  return null
}
