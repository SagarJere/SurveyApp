import { describe, expect, it } from 'vitest'

import {
  amountInputDisplay,
  amountInWords,
  formatAmount,
  formatAmountInput,
  groupDigits,
} from './money'
import { sharedCases } from '@/test/shared-cases'
import type { Currency } from './types'

interface MoneyCase {
  currency: Currency
  amount: string
  formatted: string
  words: string
}

const { cases } = sharedCases('money.json') as { cases: MoneyCase[] }

describe('shared money cases (same file as the backend)', () => {
  it.each(cases.map((c) => [`${c.currency} ${c.amount}`, c] as const))('%s', (_, c) => {
    expect(formatAmount(Number(c.amount), c.currency)).toBe(c.formatted)
    expect(amountInWords(Number(c.amount), c.currency)).toBe(c.words)
  })
})

describe('money helpers', () => {
  it('rejects negative and oversized amounts', () => {
    expect(() => formatAmount(-1, 'INR')).toThrow(RangeError)
    expect(() => amountInWords(10_000_000_000_000, 'INR')).toThrow(RangeError)
  })

  it.each([
    ['1', true, '1'],
    ['1000', true, '1,000'],
    ['12345678', true, '1,23,45,678'],
    ['1234567', false, '1,234,567'],
  ])('groups %s (indian: %s)', (digits, indian, expected) => {
    expect(groupDigits(digits, indian)).toBe(expected)
  })

  it('shows stored amounts in inputs without the symbol', () => {
    expect(amountInputDisplay(125000, 'INR')).toBe('1,25,000')
    expect(amountInputDisplay(1234.5, 'USD')).toBe('1,234.50')
    expect(amountInputDisplay(null, 'INR')).toBe('')
  })
})

describe('formatAmountInput (formats while typing)', () => {
  it('groups INR the Indian way and keeps the caret at the end', () => {
    expect(formatAmountInput('1234567', 7, 'INR', false)).toEqual({
      display: '12,34,567',
      value: 1234567,
      caret: 9,
    })
  })

  it('groups other currencies in threes', () => {
    expect(formatAmountInput('1234567', 7, 'USD', false).display).toBe('1,234,567')
  })

  it('keeps the caret after the same digit when typing in the middle', () => {
    // "1,25,000" with "9" typed after the "2": "1,295,000" -> digits 1295000
    const result = formatAmountInput('1,295,000', 4, 'INR', false)
    expect(result.display).toBe('12,95,000')
    expect(result.display.slice(0, result.caret).replace(/,/g, '')).toBe('129')
  })

  it('drops letters and symbols', () => {
    expect(formatAmountInput('₹1a2b3', 6, 'INR', false)).toMatchObject({
      display: '123',
      value: 123,
    })
  })

  it('allows up to two decimals only when decimals are on', () => {
    expect(formatAmountInput('12.345', 6, 'INR', true)).toMatchObject({
      display: '12.34',
      value: 12.34,
    })
    expect(formatAmountInput('12.34', 5, 'INR', false)).toMatchObject({ display: '12', value: 12 })
    expect(formatAmountInput('1.2.3', 5, 'USD', true)).toMatchObject({ display: '1.23' })
  })

  it('keeps a trailing decimal point while typing', () => {
    expect(formatAmountInput('1000.', 5, 'INR', true)).toMatchObject({
      display: '1,000.',
      value: 1000,
    })
    expect(formatAmountInput('.', 1, 'INR', true)).toMatchObject({ display: '0.', value: 0 })
  })

  it('strips leading zeros', () => {
    expect(formatAmountInput('000123', 6, 'INR', false)).toMatchObject({ display: '123' })
    expect(formatAmountInput('0', 1, 'INR', false)).toMatchObject({ display: '0', value: 0 })
  })

  it('limits the whole part to 13 digits', () => {
    expect(formatAmountInput('12345678901234', 14, 'USD', false).value).toBe(1234567890123)
  })

  it('returns null for an empty field', () => {
    expect(formatAmountInput('', 0, 'INR', true)).toEqual({ display: '', value: null, caret: 0 })
    expect(formatAmountInput('abc', 3, 'INR', true).value).toBeNull()
  })
})
