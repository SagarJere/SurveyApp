import { describe, expect, it } from 'vitest'

import type { ResultsSummary } from './api'
import { takeaway } from './takeaway'

const base = {
  small_group: false,
  responses: 412,
  respondents: 412,
  invited: 480,
  response_rate: 0.8583,
  headline: {
    question_key: 'q',
    text: 'How satisfied are you with your work setup?',
    average: 3.46,
  },
} as ResultsSummary

describe('takeaway', () => {
  it('builds the sentence from the data', () => {
    expect(takeaway(base, false)).toBe(
      '412 people have responded, 86% of those invited. The average answer to “How satisfied are you with your work setup” is 3.5 out of 5.',
    )
  })

  it('leaves out the rate when the survey is open to all', () => {
    expect(takeaway({ ...base, response_rate: null, invited: null, headline: null }, false)).toBe(
      '412 people have responded.',
    )
  })

  it('never mentions the average for a small group', () => {
    expect(takeaway({ ...base, small_group: true, respondents: 1, response_rate: 0.5 }, true)).toBe(
      '1 person has responded, 50% of those invited.',
    )
  })

  it('handles no responses', () => {
    expect(takeaway({ ...base, respondents: 0 }, false)).toBe('Nobody has responded yet.')
    expect(takeaway({ ...base, respondents: 0 }, true)).toBe(
      'Nobody in this group has responded yet.',
    )
  })
})
