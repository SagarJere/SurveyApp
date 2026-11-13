/** Phase T2 for employees: the pass mark up front, the score screen, retakes and My trainings. */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as respondApi from '@/features/respond/api'
import type { AttemptResult, MySurvey, RespondentSurvey } from '@/features/respond/api'
import type { Draft } from '@/features/survey-logic/types'
import { ApiError } from '@/lib/api'
import { TEST_USERS } from '@/test/auth'
import { SURVEY_ID } from '@/test/builder'
import { renderRoute } from '@/test/render'
import { mockRespondDefaults } from '@/test/respond'

const QUIZ: Draft = {
  title: 'Fire safety basics',
  description: '',
  settings: {
    layout: 'all',
    show_navigator: false,
    auto_next: false,
    one_response: true,
    allow_edit: false,
    anonymous: false,
    opens_at: null,
    closes_at: null,
  },
  theme: {
    cover: null,
    background_style: 'none',
    background: null,
    background_color: '#E8EEF3',
    blur: true,
    overlay: 25,
    accent: '#0E7A6A',
  },
  sections: [{ key: 's1', title: 'Quiz', description: '', condition: null }],
  questions: [
    {
      key: 'q1',
      section_key: 's1',
      type: 'single',
      text: 'What should you do first?',
      help: '',
      required: false,
      options: [
        { key: 'a', label: 'Raise the alarm' },
        { key: 'b', label: 'Run' },
      ],
      config: {},
      condition: null,
    },
  ],
}

function result(overrides: Partial<AttemptResult> = {}): AttemptResult {
  return {
    attempt_no: 1,
    score: 60,
    points: 3,
    max_points: 5,
    passed: false,
    pass_mark: 80,
    attempts_used: 1,
    attempts_left: 2,
    review: null,
    ...overrides,
  }
}

function training(overrides: Partial<RespondentSurvey> = {}): RespondentSurvey {
  return {
    survey_id: SURVEY_ID,
    kind: 'training',
    version_no: 1,
    ...QUIZ,
    assets: {},
    videos: {},
    video_progress: {},
    training: {
      pass_mark: 80,
      retakes: 'limit',
      max_attempts: 3,
      attempts_used: 0,
      attempts_left: 3,
      last_result: null,
    },
    participation: {
      status: 'not_started',
      answers: {},
      can_edit: false,
      can_respond_again: false,
      draft_updated: false,
    },
    ...overrides,
  }
}

beforeEach(() => {
  mockRespondDefaults()
})

describe('taking a scored training', () => {
  it('shows the pass mark, scores on the server, and offers a retake', async () => {
    const user = userEvent.setup()
    vi.spyOn(respondApi, 'getRespondentSurvey').mockResolvedValue(training())
    const submit = vi.spyOn(respondApi, 'submitAnswers').mockResolvedValue({
      status: 'submitted',
      submitted_at: '2026-11-13T10:00:00Z',
      can_edit: false,
      can_respond_again: true,
      training: result(),
    })
    renderRoute(`/s/${SURVEY_ID}`, { user: TEST_USERS.employee })

    expect(await screen.findByText('Pass mark 80% · Attempt 1 of 3')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Run' }))
    await user.click(screen.getByRole('button', { name: 'Submit response' }))

    expect(submit).toHaveBeenCalledWith(SURVEY_ID, { q1: 'b' })
    expect(await screen.findByRole('heading', { name: 'Not passed yet' })).toHaveFocus()
    expect(screen.getByRole('img', { name: 'Score 60%' })).toBeInTheDocument()
    expect(screen.getByText('3 of 5 points · Pass mark 80% · Attempt 1 of 3')).toBeInTheDocument()
    expect(screen.getByText('2 attempts left.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to My trainings' })).toHaveAttribute(
      'href',
      '/trainings',
    )

    await user.click(screen.getByRole('button', { name: 'Retake now' }))
    expect(screen.getByText('Pass mark 80% · Attempt 2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Run' })).not.toBeChecked()
  })

  it('shows the answer review when the server includes it', async () => {
    vi.spyOn(respondApi, 'getRespondentSurvey').mockResolvedValue(
      training({
        participation: {
          status: 'submitted',
          answers: {},
          can_edit: false,
          can_respond_again: false,
          draft_updated: false,
        },
        training: {
          pass_mark: 80,
          retakes: 'limit',
          max_attempts: 3,
          attempts_used: 3,
          attempts_left: 0,
          last_result: result({
            attempt_no: 3,
            attempts_used: 3,
            attempts_left: 0,
            review: [
              {
                question_key: 'q1',
                text: 'What should you do first?',
                correct: false,
                points: 2,
                your_answer: 'Run',
                correct_answer: 'Raise the alarm',
              },
            ],
          }),
        },
      }),
    )
    renderRoute(`/s/${SURVEY_ID}`, { user: TEST_USERS.employee })

    expect(await screen.findByRole('heading', { name: 'Not passed' })).toBeInTheDocument()
    expect(screen.getByText('No attempts left.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retake now' })).toBeNull()
    const review = screen.getByRole('heading', { name: 'Your answers' }).closest('section')!
    const item = within(review).getByRole('listitem')
    expect(item).toHaveTextContent('Wrong: What should you do first?')
    expect(item).toHaveTextContent('Your answer: Run')
    expect(item).toHaveTextContent('Correct answer: Raise the alarm')
    expect(item).toHaveTextContent('0/2 pts')
  })

  it('a hidden score just confirms the submission', async () => {
    const user = userEvent.setup()
    vi.spyOn(respondApi, 'getRespondentSurvey').mockResolvedValue(
      training({
        training: {
          pass_mark: null,
          retakes: 'none',
          max_attempts: 3,
          attempts_used: 0,
          attempts_left: 1,
          last_result: null,
        },
      }),
    )
    vi.spyOn(respondApi, 'submitAnswers').mockResolvedValue({
      status: 'submitted',
      submitted_at: '2026-11-13T10:00:00Z',
      can_edit: false,
      can_respond_again: false,
      training: result({
        score: null,
        points: null,
        max_points: null,
        passed: null,
        pass_mark: null,
        attempts_left: 0,
      }),
    })
    renderRoute(`/s/${SURVEY_ID}`, { user: TEST_USERS.employee })

    expect(await screen.findByText('One attempt')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit response' }))

    expect(await screen.findByRole('heading', { name: 'Answers submitted' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Score/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retake now' })).toBeNull()
  })

  it('reloads when the server says no attempts are left', async () => {
    const user = userEvent.setup()
    const load = vi.spyOn(respondApi, 'getRespondentSurvey').mockResolvedValue(training())
    vi.spyOn(respondApi, 'submitAnswers').mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'NO_ATTEMPTS_LEFT',
        message: "You've used all your attempts at this training.",
      }),
    )
    renderRoute(`/s/${SURVEY_ID}`, { user: TEST_USERS.employee })

    await user.click(await screen.findByRole('button', { name: 'Submit response' }))

    expect(await screen.findByText("You've used all your attempts at this training.")).toBeVisible()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('My trainings results', () => {
  function mine(overrides: Partial<MySurvey>): MySurvey {
    return {
      id: SURVEY_ID,
      title: 'Fire safety basics',
      description: '',
      status: 'submitted',
      open: true,
      closes_at: null,
      minutes: 5,
      progress: null,
      accent: '#0E7A6A',
      cover: null,
      submitted_at: '2026-11-12T10:00:00Z',
      videos_total: 1,
      videos_done: 1,
      attempts_used: 1,
      attempts_left: 0,
      best_score: 92,
      passed: true,
      ...overrides,
    }
  }

  it('shows passed with the best score, or not passed with a retake', async () => {
    vi.spyOn(respondApi, 'listMyTrainings').mockResolvedValue([
      mine({}),
      mine({ id: 'other', title: 'Data privacy', best_score: 60, passed: false, attempts_left: 2 }),
    ])
    renderRoute('/trainings', { user: TEST_USERS.employee })

    expect(await screen.findByText('Passed · 92%')).toBeInTheDocument()
    expect(screen.getByText('Not passed · 60%')).toBeInTheDocument()
    expect(screen.getByText('2 attempts left')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View: Fire safety basics' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Retake: Data privacy' })).toHaveAttribute(
      'href',
      '/s/other',
    )
  })
})
