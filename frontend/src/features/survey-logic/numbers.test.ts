import { describe, expect, it } from 'vitest'

import { sharedCases } from '@/test/shared-cases'

import { formatNumber, numberRangeError, parseNumberInput } from './numbers'

interface Cases {
  format: { value: number; unit?: string; expected: string }[]
  range_errors: {
    name: string
    config: Record<string, unknown>
    value: number
    expected: string | null
  }[]
}

const CASES = sharedCases('number.json') as Cases

describe('formatNumber (shared cases)', () => {
  it.each(CASES.format)('$value $unit → $expected', ({ value, unit, expected }) => {
    expect(formatNumber(value, unit)).toBe(expected)
  })
})

describe('numberRangeError (shared cases)', () => {
  it.each(CASES.range_errors)('$name', ({ config, value, expected }) => {
    expect(numberRangeError(config, value)).toBe(expected)
  })
})

describe('parseNumberInput', () => {
  const whole = { decimals: false, negative: false }
  const any = { decimals: true, negative: true }

  it('reads numbers and ignores grouping commas', () => {
    expect(parseNumberInput('12,34,567', whole)).toEqual({ text: '1234567', value: 1234567 })
    expect(parseNumberInput('2.5', any)).toEqual({ text: '2.5', value: 2.5 })
    expect(parseNumberInput('-3', any)).toEqual({ text: '-3', value: -3 })
  })

  it('keeps half-typed numbers without a value yet', () => {
    expect(parseNumberInput('', whole)).toEqual({ text: '', value: null })
    expect(parseNumberInput('-', any)).toEqual({ text: '-', value: null })
    expect(parseNumberInput('4.', any)).toEqual({ text: '4.', value: 4 })
  })

  it('refuses what the question does not accept', () => {
    expect(parseNumberInput('2.5', whole)).toBeNull()
    expect(parseNumberInput('-3', whole)).toBeNull()
    expect(parseNumberInput('1.234', any)).toBeNull()
    expect(parseNumberInput('12a', any)).toBeNull()
    expect(parseNumberInput('1234567890123', any)).toBeNull() // 13 digits
    expect(parseNumberInput('123456789012', any)).toEqual({
      text: '123456789012',
      value: 123456789012,
    })
  })
})
