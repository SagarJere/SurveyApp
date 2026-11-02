import { describe, expect, it } from 'vitest'

import {
  countDependents,
  eligibleSourcesForQuestion,
  eligibleSourcesForSection,
  evaluate,
  isAnswered,
  questionConditionProblem,
  sectionConditionProblem,
  type LogicDraft,
} from './conditions'
import { sharedCases } from '@/test/shared-cases'
import type { Answers, Draft } from './types'
import { validateDraft, type Issue } from './validation'

interface Cases {
  visibility: {
    name: string
    survey: LogicDraft
    answers: Answers
    visible_sections: string[]
    visible_questions: string[]
    kept_answers: Answers
    missing_required: string[]
  }[]
  problems: {
    name: string
    survey: LogicDraft
    kind: 'question' | 'section'
    key: string
    problem: string | null
  }[]
  validation: { name: string; survey: LogicDraft; issues: Issue[] }[]
}

const cases = sharedCases('survey-logic.json') as Cases
const pulse = (sharedCases('workplace-pulse.json') as { draft: Draft }).draft

describe('visibility (shared cases)', () => {
  it.each(cases.visibility.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const result = evaluate(c.survey, c.answers)
    expect(result.visibleSections).toEqual(c.visible_sections)
    expect(result.visibleQuestions).toEqual(c.visible_questions)
    expect(result.keptAnswers).toEqual(c.kept_answers)
    expect(result.missingRequired).toEqual(c.missing_required)
  })
})

describe('condition problems (shared cases)', () => {
  it.each(cases.problems.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const check = c.kind === 'question' ? questionConditionProblem : sectionConditionProblem
    expect(check(c.survey, c.key)).toBe(c.problem)
  })
})

describe('publish validation (shared cases)', () => {
  it.each(cases.validation.map((c) => [c.name, c] as const))('%s', (_, c) => {
    expect(validateDraft(c.survey)).toEqual(c.issues)
  })
})

describe('the Workplace pulse sample', () => {
  const q = (n: number) => pulse.questions[n - 1]!.key

  it('has no publish issues', () => {
    expect(validateDraft(pulse)).toEqual([])
  })

  it('offers only earlier choice, rating and money questions as sources', () => {
    expect(eligibleSourcesForQuestion(pulse, q(3)).map((x) => x.key)).toEqual([q(1), q(2)])
    expect(eligibleSourcesForQuestion(pulse, q(1))).toEqual([])
    const section3 = pulse.sections[2]!.key
    expect(eligibleSourcesForSection(pulse, section3).map((x) => x.key)).toEqual([
      q(1),
      q(2),
      q(3),
      q(4),
      q(5),
      q(6),
      q(7),
      q(8),
    ])
    expect(eligibleSourcesForSection(pulse, pulse.sections[0]!.key)).toEqual([])
  })

  it('counts conditions that depend on a question', () => {
    expect(countDependents(pulse, q(2))).toBe(3)
    expect(countDependents(pulse, q(6))).toBe(1) // section 2
    expect(countDependents(pulse, q(9))).toBe(0)
  })

  it('shows the manager section only to managers', () => {
    const manager = pulse.questions[5]!.options[0]!.key
    const notManager = pulse.questions[5]!.options[1]!.key
    expect(evaluate(pulse, { [q(6)]: manager }).visibleQuestions).toContain(q(7))
    expect(evaluate(pulse, { [q(6)]: notManager }).visibleQuestions).not.toContain(q(7))
  })
})

describe('isAnswered', () => {
  it.each([
    [null, false],
    [undefined, false],
    ['', false],
    ['  ', false],
    [[], false],
    [0, true],
    ['a', true],
    [['x'], true],
  ])('%j -> %s', (value, expected) => {
    expect(isAnswered(value)).toBe(expected)
  })
})
