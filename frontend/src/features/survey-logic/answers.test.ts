import { describe, expect, it } from 'vitest'

import { answerProblem, rangeError } from './answers'
import type { Question } from './types'

function money(config: Partial<Question['config']>, required = false): Question {
  return {
    key: 'm',
    section_key: 's',
    type: 'money',
    text: 'Amount',
    help: '',
    required,
    options: [],
    config: { currency: 'INR', min: null, max: null, decimals: false, ...config },
    condition: null,
  }
}

describe('rangeError', () => {
  it('uses the docs wording with Indian grouping', () => {
    expect(rangeError(money({ max: 500000 }), 500001)).toBe('Enter ₹5,00,000 or less.')
    expect(rangeError(money({ min: 1000 }), 999)).toBe('Enter at least ₹1,000.')
  })

  it('accepts the limits themselves and other currencies', () => {
    expect(rangeError(money({ min: 1000, max: 500000 }), 500000)).toBeNull()
    expect(rangeError(money({ min: 1000, max: 500000 }), 1000)).toBeNull()
    expect(rangeError(money({ currency: 'USD', max: 1000 }), 1500)).toBe('Enter $1,000 or less.')
  })

  it('ignores empty answers and other types', () => {
    expect(rangeError(money({ max: 10 }), null)).toBeNull()
    expect(rangeError({ ...money({ max: 10 }), type: 'rating' }, 50)).toBeNull()
  })
})

describe('answerProblem', () => {
  it('reports required and range problems', () => {
    expect(answerProblem(money({}, true), null)).toBe('required')
    expect(answerProblem(money({ max: 10 }, true), 20)).toBe('range')
    expect(answerProblem(money({ max: 10 }, true), 5)).toBeNull()
    expect(answerProblem(money({}, false), null)).toBeNull()
  })
})
