import { describe, expect, it } from 'vitest'

import { questionConditionProblem } from '@/features/survey-logic/conditions'
import type { Draft } from '@/features/survey-logic/types'
import { sharedCases } from '@/test/shared-cases'

import {
  addOption,
  addQuestion,
  addSection,
  changeType,
  defaultCondition,
  deleteQuestion,
  deleteSection,
  duplicateQuestion,
  moveQuestion,
  moveSection,
  newSection,
  normalize,
  removeOption,
  restoreQuestion,
  setCondition,
  updateMoneyConfig,
  updateQuestion,
} from './draft-ops'

const pulse = (sharedCases('workplace-pulse.json') as { draft: Draft }).draft
const keys = (d: Draft) => d.questions.map((q) => q.key)
const q = (n: number) => pulse.questions[n - 1]!.key
const [S1, S2, S3] = pulse.sections.map((s) => s.key) as [string, string, string]

function emptyDraft(): Draft {
  return { ...pulse, sections: [newSection()], questions: [] }
}

describe('adding and editing questions', () => {
  it('adds a choice question with two options to the given section', () => {
    const draft = emptyDraft()
    const [next, question] = addQuestion(draft, 'single', draft.sections[0]!.key)

    expect(next.questions).toEqual([question])
    expect(question.options.map((o) => o.label)).toEqual(['Option 1', 'Option 2'])
    expect(question.required).toBe(false)
    expect(draft.questions).toEqual([]) // input not mutated
  })

  it('adds money questions with default settings', () => {
    const draft = emptyDraft()
    const [, question] = addQuestion(draft, 'money', draft.sections[0]!.key)

    expect(question.config).toEqual({ currency: 'INR', min: null, max: null, decimals: false })
  })

  it('keeps questions grouped when adding to an earlier section', () => {
    const [next, question] = addQuestion(pulse, 'short', S2)

    expect(keys(next).indexOf(question.key)).toBe(8) // after Q8, before section 3's Q9
  })

  it('only replaces the edited question object', () => {
    const next = updateQuestion(pulse, q(2), { text: 'Changed' })

    expect(next.questions[1]!.text).toBe('Changed')
    expect(next.questions[0]).toBe(pulse.questions[0])
  })

  it('keeps options and money settings when changing type and back', () => {
    const toRating = changeType(pulse, q(2), 'rating')
    const back = changeType(toRating, q(2), 'single')

    expect(back.questions[1]!.options).toEqual(pulse.questions[1]!.options)
    const money = changeType(changeType(pulse, q(5), 'short'), q(5), 'money')
    expect(money.questions[4]!.config).toEqual(pulse.questions[4]!.config)
  })

  it('gives a new choice question two options when it had none', () => {
    const next = changeType(pulse, q(1), 'dropdown')

    expect(next.questions[0]!.options).toHaveLength(2)
  })

  it('updates money settings', () => {
    const next = updateMoneyConfig(pulse, q(5), { currency: 'USD', decimals: true })

    expect(next.questions[4]!.config).toMatchObject({
      currency: 'USD',
      decimals: true,
      max: 500000,
    })
  })

  it('adds and removes options but never the last one', () => {
    const [withOption, option] = addOption(pulse, q(3))
    expect(withOption.questions[2]!.options.at(-1)).toEqual(option)

    let draft = removeOption(pulse, q(3), pulse.questions[2]!.options[0]!.key)
    expect(draft.questions[2]!.options).toHaveLength(1)
    draft = removeOption(draft, q(3), draft.questions[2]!.options[0]!.key)
    expect(draft.questions[2]!.options).toHaveLength(1)
  })
})

describe('moving questions', () => {
  it('swaps within a section', () => {
    const next = moveQuestion(pulse, q(2), 1)

    expect(keys(next).slice(0, 3)).toEqual([q(1), q(3), q(2)])
  })

  it('moving Q2 below Q3 breaks Q3’s condition', () => {
    const next = moveQuestion(pulse, q(2), 1)

    expect(questionConditionProblem(next, q(3))).toBe('source_after')
  })

  it('moves into the next section at the last question of a section', () => {
    const next = moveQuestion(pulse, q(6), 1)

    expect(next.questions.find((x) => x.key === q(6))!.section_key).toBe(S2)
    expect(keys(next).slice(5, 8)).toEqual([q(6), q(7), q(8)])
  })

  it('moves into the previous section at the first question of a section', () => {
    const next = moveQuestion(pulse, q(9), -1)

    expect(next.questions.find((x) => x.key === q(9))!.section_key).toBe(S2)
    expect(keys(next).slice(6)).toEqual([q(7), q(8), q(9)])
  })

  it('moves into an empty section', () => {
    const emptyS3 = { ...pulse, questions: pulse.questions.slice(0, 8) }
    const next = moveQuestion(emptyS3, q(8), 1)

    expect(next.questions.at(-1)!.section_key).toBe(S3)
  })

  it('does nothing at the very top or bottom', () => {
    expect(moveQuestion(pulse, q(1), -1)).toBe(pulse)
    expect(moveQuestion(pulse, q(9), 1)).toBe(pulse)
  })
})

describe('duplicate, delete and undo', () => {
  it('duplicates below with new keys and "(copy)"', () => {
    const [next, copy] = duplicateQuestion(pulse, q(4))

    expect(copy).not.toBeNull()
    expect(keys(next).indexOf(copy!.key)).toBe(4)
    expect(copy!.text).toBe('What would make remote work easier for you? (copy)')
    expect(copy!.options.map((o) => o.label)).toEqual(
      pulse.questions[3]!.options.map((o) => o.label),
    )
    expect(
      copy!.options.some((o) => pulse.questions[3]!.options.some((p) => p.key === o.key)),
    ).toBe(false)
    expect(copy!.condition).toEqual(pulse.questions[3]!.condition)
  })

  it('deleting a source breaks its dependents; undo restores the position', () => {
    const [deleted, info] = deleteQuestion(pulse, q(2))
    expect(questionConditionProblem(deleted, q(3))).toBe('source_missing')

    const restored = restoreQuestion(deleted, info!)

    expect(keys(restored)).toEqual(keys(pulse))
    expect(questionConditionProblem(restored, q(3))).toBeNull()
  })

  it('undo keeps edits made after the delete', () => {
    const [deleted, info] = deleteQuestion(pulse, q(2))
    const edited = updateQuestion(deleted, q(1), { text: 'Edited after delete' })

    const restored = restoreQuestion(edited, info!)

    expect(restored.questions[0]!.text).toBe('Edited after delete')
    expect(restored.questions[1]!.key).toBe(q(2))
  })
})

describe('sections', () => {
  it('names the first section "Section 1" when adding the second', () => {
    const draft = emptyDraft()
    const [next, section] = addSection(draft)

    expect(next.sections.map((s) => s.title)).toEqual(['Section 1', ''])
    expect(next.sections[1]).toBe(section)
  })

  it('keeps a first section title that was already set', () => {
    const draft = { ...emptyDraft(), sections: [{ ...newSection(), title: 'Intro' }] }

    expect(addSection(draft)[0].sections[0]!.title).toBe('Intro')
  })

  it('moves sections and keeps questions grouped', () => {
    const next = moveSection(pulse, S3, -1)

    expect(next.sections.map((s) => s.key)).toEqual([S1, S3, S2])
    expect(keys(next)).toEqual([q(1), q(2), q(3), q(4), q(5), q(6), q(9), q(7), q(8)])
  })

  it('deleting a section moves its questions to the previous section', () => {
    const [next, info] = deleteSection(pulse, S2)

    expect(info).toMatchObject({ movedCount: 2 })
    expect(info!.movedTo.key).toBe(S1)
    expect(next.sections.map((s) => s.key)).toEqual([S1, S3])
    expect(keys(next)).toEqual(keys(pulse))
    expect(next.questions[6]!.section_key).toBe(S1)
  })

  it('deleting the first section moves its questions to the next one', () => {
    const [next, info] = deleteSection(pulse, S1)

    expect(info!.movedTo.key).toBe(S2)
    expect(next.questions.every((x) => x.section_key !== S1)).toBe(true)
  })

  it('never deletes the last section', () => {
    const draft = emptyDraft()
    expect(deleteSection(draft, draft.sections[0]!.key)).toEqual([draft, null])
  })

  it('normalize is a no-op on a grouped draft', () => {
    expect(normalize(pulse)).toBe(pulse)
  })
})

describe('conditions', () => {
  it('defaults to the nearest earlier eligible question', () => {
    expect(defaultCondition(pulse, { question: q(9) })).toEqual({
      src: q(8),
      op: 'is',
      val: pulse.questions[7]!.options[0]!.key,
    })
  })

  it('defaults money conditions to 50,000', () => {
    // Q6's nearest earlier eligible question is the money question Q5.
    expect(defaultCondition(pulse, { question: q(6) })).toEqual({
      src: q(5),
      op: 'gte',
      val: 50000,
    })
  })

  it('defaults rating conditions to "is at least 1"', () => {
    expect(defaultCondition(pulse, { question: q(2) })).toEqual({ src: q(1), op: 'gte', val: 1 })
  })

  it('has no default when nothing earlier can be a source', () => {
    expect(defaultCondition(pulse, { question: q(1) })).toBeNull()
  })

  it('section conditions use questions from earlier sections', () => {
    expect(defaultCondition(pulse, { section: S1 })).toBeNull()
    expect(defaultCondition(pulse, { section: S3 })?.src).toBe(q(8))
  })

  it('sets and removes conditions', () => {
    const set = setCondition(pulse, { kind: 'section', key: S3 }, { src: q(1), op: 'gte', val: 4 })
    expect(set.sections[2]!.condition).toEqual({ src: q(1), op: 'gte', val: 4 })

    const removed = setCondition(set, { kind: 'question', key: q(3) }, null)
    expect(removed.questions[2]!.condition).toBeNull()
  })
})
