/** Phase T2 in the builder: correct answers on questions, the Quiz tab, and Preview's score. */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { duplicateQuestion, removeOption } from '@/features/builder/draft-ops'
import type { Draft } from '@/features/survey-logic/types'
import * as surveysApi from '@/features/surveys/api'
import { TEST_USERS } from '@/test/auth'
import { lastSavedDraft, mockBuilderApi, pulseDraft, SURVEY_ID } from '@/test/builder'
import { renderRoute } from '@/test/render'

import { DEFAULT_QUIZ } from './training-rules'

function trainingDraft(): Draft {
  const draft = pulseDraft()
  draft.settings = { ...draft.settings, quiz: { ...DEFAULT_QUIZ } }
  return draft
}

async function openBuilder(draft: Draft, kind: 'survey' | 'training' = 'training', search = '') {
  const api = mockBuilderApi(draft, { kind })
  vi.spyOn(surveysApi, 'listVideos').mockResolvedValue([])
  const rendered = renderRoute(`/admin/surveys/${SURVEY_ID}/edit${search}`, {
    user: TEST_USERS.hr,
  })
  await screen.findByRole('button', { name: /Publish/ })
  return { ...api, ...rendered }
}

const savedQuestion = (saveDraft: Parameters<typeof lastSavedDraft>[0], key: string) =>
  lastSavedDraft(saveDraft).questions.find((q) => q.key === key)

describe('correct answers on questions', () => {
  it('marks a single-choice question with one correct option and points', async () => {
    const user = userEvent.setup()
    const draft = trainingDraft()
    const question = draft.questions[1]!
    const hybrid = question.options[1]!
    const { saveDraft } = await openBuilder(draft)

    await user.click(screen.getByRole('button', { name: /Which work mode do you follow/ }))
    const key = screen.getByRole('group', { name: 'Correct answer for Q2' })
    expect(within(key).getByText('Not scored: collects answers only.')).toBeInTheDocument()
    await user.click(within(key).getByRole('switch', { name: 'Marked question' }))
    await user.click(within(key).getByRole('button', { name: 'Remote' }))
    await user.click(within(key).getByRole('button', { name: 'Hybrid' }))
    const points = within(key).getByLabelText('Points')
    await user.clear(points)
    await user.type(points, '2')

    // Single choice: ticking another option moves the tick.
    expect(within(key).getByRole('button', { name: 'Hybrid' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(key).getByRole('button', { name: 'Remote' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await waitFor(
      () => {
        expect(savedQuestion(saveDraft, question.key)?.quiz).toEqual({
          points: 2,
          correct_options: [hybrid.key],
          correct_min: null,
          correct_max: null,
        })
      },
      { timeout: 3000 },
    )
  })

  it('checkboxes can have several correct options, in option order', async () => {
    const user = userEvent.setup()
    const draft = trainingDraft()
    const question = draft.questions[3]!
    const { saveDraft } = await openBuilder(draft)

    await user.click(screen.getByRole('button', { name: /What would make remote work easier/ }))
    const key = screen.getByRole('group', { name: 'Correct answer for Q4' })
    await user.click(within(key).getByRole('switch', { name: 'Marked question' }))
    expect(
      within(key).getByText('Tick every correct answer (all are needed to score)'),
    ).toBeInTheDocument()
    await user.click(within(key).getByRole('button', { name: 'Faster VPN' }))
    await user.click(within(key).getByRole('button', { name: 'Better laptop' }))

    await waitFor(
      () => {
        expect(savedQuestion(saveDraft, question.key)?.quiz?.correct_options).toEqual([
          question.options[0]!.key,
          question.options[2]!.key,
        ])
      },
      { timeout: 3000 },
    )
  })

  it('a number answer is an exact value or a range', async () => {
    const user = userEvent.setup()
    const draft = trainingDraft()
    draft.questions[4] = { ...draft.questions[4]!, type: 'number', config: { number_min: 0 } }
    const key = draft.questions[4].key
    const { saveDraft } = await openBuilder(draft)

    await user.click(screen.getByRole('button', { name: /Roughly how much have you spent/ }))
    const group = screen.getByRole('group', { name: 'Correct answer for Q5' })
    await user.click(within(group).getByRole('switch', { name: 'Marked question' }))
    await user.type(within(group).getByLabelText('Correct from'), '3')

    // The first value fills both boxes: an exact answer.
    expect(within(group).getByLabelText('to')).toHaveValue('3')
    await user.clear(within(group).getByLabelText('to'))
    await user.type(within(group).getByLabelText('to'), '5')
    await waitFor(
      () => {
        expect(savedQuestion(saveDraft, key)?.quiz).toMatchObject({
          correct_min: 3,
          correct_max: 5,
        })
      },
      { timeout: 3000 },
    )
  })

  it('rating and text questions, and surveys, have no correct answers', async () => {
    const user = userEvent.setup()
    await openBuilder(pulseDraft(), 'survey')
    await user.click(screen.getByRole('button', { name: /Which work mode do you follow/ }))
    expect(screen.queryByRole('group', { name: /Correct answer/ })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Quiz' })).toBeNull()
  })

  it('keeps answer keys pointing at the right options', () => {
    const draft = trainingDraft()
    const source = draft.questions[3]!
    const marked: Draft = {
      ...draft,
      questions: draft.questions.map((q) =>
        q.key === source.key
          ? {
              ...q,
              quiz: { points: 1, correct_options: [q.options[0]!.key, q.options[2]!.key] },
            }
          : q,
      ),
    }

    const [, copy] = duplicateQuestion(marked, source.key)
    const removed = removeOption(marked, source.key, source.options[0]!.key)

    expect(copy?.quiz?.correct_options).toEqual([copy!.options[0]!.key, copy!.options[2]!.key])
    expect(removed.questions[3]!.quiz?.correct_options).toEqual([source.options[2]!.key])
  })
})

describe('the Quiz tab', () => {
  it('sets the pass mark, what people see, retakes and a due date', async () => {
    const user = userEvent.setup()
    const { saveDraft } = await openBuilder(trainingDraft())

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Questions', 'Quiz', 'Theme', 'Settings', 'Audience'])
    await user.click(screen.getByRole('tab', { name: 'Quiz' }))
    expect(screen.getByText(/No question is marked yet/)).toBeInTheDocument()
    expect(screen.getByLabelText('Pass mark in percent')).toHaveValue('80')

    await user.click(screen.getByRole('radio', { name: 'After every attempt' }))
    await user.click(screen.getByRole('radio', { name: 'Up to a number of attempts' }))
    await user.selectOptions(screen.getByLabelText('Attempts in total'), '5')
    await user.type(screen.getByLabelText('Due'), '2026-12-01')

    await waitFor(
      () => {
        const saved = lastSavedDraft(saveDraft).settings
        expect(saved.quiz).toEqual({
          ...DEFAULT_QUIZ,
          show_answers: 'always',
          retakes: 'limit',
          max_attempts: 5,
        })
        expect(saved.due_date).toBe('2026-12-01')
      },
      { timeout: 3000 },
    )
  })

  it('"until they pass" needs a pass mark', async () => {
    const user = userEvent.setup()
    await openBuilder(trainingDraft(), 'training', '?tab=quiz')

    await user.click(screen.getByRole('radio', { name: 'Until they pass' }))
    await user.click(screen.getByRole('switch', { name: 'Pass mark' }))

    expect(screen.getByRole('alert')).toHaveTextContent('“Until they pass” needs a pass mark.')
    expect(screen.queryByLabelText('Pass mark in percent')).toBeNull()
  })
})

describe('Preview of a training', () => {
  it('scores an attempt with the draft answer key and offers a retake', async () => {
    const user = userEvent.setup()
    const draft = trainingDraft()
    const question = draft.questions[1]!
    draft.questions[1] = {
      ...question,
      quiz: { points: 1, correct_options: [question.options[1]!.key] },
    }
    draft.settings = { ...draft.settings, layout: 'all' }
    draft.questions = draft.questions.map((q) => ({ ...q, required: false }))
    await openBuilder(draft, 'training', '?mode=preview')

    expect(screen.getByText('Pass mark 80% · Attempt 1 of 3')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Remote' }))
    await user.click(screen.getByRole('button', { name: 'Submit response' }))

    expect(await screen.findByRole('heading', { name: 'Not passed yet' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Score 0%' })).toBeInTheDocument()
    expect(screen.getByText('0 of 1 point · Pass mark 80% · Attempt 1 of 3')).toBeInTheDocument()
    expect(screen.getByText('2 attempts left.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your answers' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Retake now' }))
    expect(screen.getByText('Pass mark 80% · Attempt 2 of 3')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Hybrid' }))
    await user.click(screen.getByRole('button', { name: 'Submit response' }))

    expect(await screen.findByRole('heading', { name: 'You passed' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retake now' })).toBeNull()
    const review = screen.getByRole('heading', { name: 'Your answers' }).closest('section')!
    expect(within(review).getByText('Your answer: Hybrid')).toBeInTheDocument()
  })
})
