import { describe, expect, it } from 'vitest'

import { employeeIdProblem, normalizeEmployeeId } from './employee-id'

describe('employee IDs (mirror of the backend rule)', () => {
  it.each([
    [' e123 ', 'E123'],
    ['E0042', 'E0042'],
    ['ab-12_x.y', 'AB-12_X.Y'],
  ])('normalises %j to %j', (raw, expected) => {
    expect(normalizeEmployeeId(raw)).toBe(expected)
    expect(employeeIdProblem(raw)).toBeNull()
  })

  it.each([
    ['', 'Enter your employee ID.'],
    ['   ', 'Enter your employee ID.'],
    ['E 123', "Employee IDs can't contain spaces."],
    ['x'.repeat(31), "Employee IDs can't be longer than 30 characters."],
  ])('rejects %j', (raw, message) => {
    expect(employeeIdProblem(raw)).toBe(message)
  })

  it('accepts exactly 30 characters', () => {
    expect(employeeIdProblem('x'.repeat(30))).toBeNull()
  })
})
