import { describe, expect, it } from 'vitest'

import { NUMERIC_OPS, conditionOpsFor } from '@/features/survey-logic/conditions'
import type { Draft, Question } from '@/features/survey-logic/types'
import { pulseDraft } from '@/test/builder'

import { conditionSummary, opLabel } from './condition-text'

describe('condition comparisons', () => {
  it('offers six comparisons for every numeric question type', () => {
    for (const type of ['number', 'money', 'rating']) {
      expect(conditionOpsFor(type).map((op) => opLabel(op, type))).toEqual([
        'is at least',
        'is at most',
        'is greater than',
        'is less than',
        'is equal to',
        'is not equal to',
      ])
    }
    expect(conditionOpsFor('number')).toEqual(NUMERIC_OPS)
  })

  it('keeps "is" and "is not" for choice questions', () => {
    for (const type of ['single', 'multi', 'dropdown']) {
      expect(conditionOpsFor(type).map((op) => opLabel(op, type))).toEqual(['is', 'is not'])
    }
  })

  it('describes number conditions with the unit', () => {
    const draft: Draft = pulseDraft()
    const source: Question = {
      ...draft.questions[0]!,
      type: 'number',
      config: { number_min: 0, number_max: null, number_decimals: false, number_unit: 'people' },
    }
    draft.questions = [source, ...draft.questions.slice(1)]

    expect(conditionSummary(draft, { src: source.key, op: 'gt', val: 3 })).toBe(
      'Shown when Q1 is greater than 3 people',
    )
    expect(conditionSummary(draft, { src: source.key, op: 'not', val: 0 })).toBe(
      'Shown when Q1 is not equal to 0 people',
    )
  })
})
