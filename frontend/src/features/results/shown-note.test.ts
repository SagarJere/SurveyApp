import { describe, expect, it } from 'vitest'

import type { QuestionResult } from './api'
import { conditionText } from './shown-note'

function question(overrides: Partial<QuestionResult>): QuestionResult {
  return {
    key: 'src',
    number: 2,
    type: 'number',
    text: 'How many people are coming?',
    required: false,
    condition: null,
    shown: 10,
    answered: 10,
    ...overrides,
  }
}

describe('who saw a conditional question', () => {
  const people = new Map([['src', question({ unit: 'people' })]])

  it.each([
    ['gte', 'answered at least 3 people'],
    ['lte', 'answered at most 3 people'],
    ['gt', 'answered more than 3 people'],
    ['lt', 'answered less than 3 people'],
    ['is', 'answered exactly 3 people'],
    ['not', "didn't answer 3 people"],
  ])('%s', (op, words) => {
    expect(conditionText({ src: 'src', op, val: 3 }, people)).toBe(`people who ${words} to Q2`)
  })

  it('formats money amounts and keeps quotes for choices', () => {
    const money = new Map([['src', question({ type: 'money', currency: 'INR' })]])
    expect(conditionText({ src: 'src', op: 'gt', val: 50000 }, money)).toBe(
      'people who answered more than ₹50,000 to Q2',
    )
    const choice = new Map([
      [
        'src',
        question({ type: 'single', options: [{ key: 'r', label: 'Remote', n: 1, share: 1 }] }),
      ],
    ])
    expect(conditionText({ src: 'src', op: 'is', val: 'r' }, choice)).toBe(
      'people who answered “Remote” to Q2',
    )
  })
})
