import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import { TEST_USERS } from '@/test/auth'
import { pulseDraft, SURVEY_ID } from '@/test/builder'
import { renderRoute } from '@/test/render'

import * as respondApi from './api'
import type { RespondentParticipation, RespondentSurvey } from './api'

const draft = pulseDraft()
const Q = draft.questions.map((q) => q.key)
const OFFICE = draft.questions[1]!.options[0]!.key
const NOT_MANAGER = draft.questions[5]!.options[1]!.key

function respondent(
  participation: Partial<RespondentParticipation> = {},
  settings: Partial<RespondentSurvey['settings']> = {},
): RespondentSurvey {
  return {
    survey_id: SURVEY_ID,
    kind: 'survey',
    videos: {},
    video_progress: {},
    version_no: 1,
    title: draft.title,
    description: draft.description,
    settings: { ...draft.settings, layout: 'step', ...settings },
    theme: draft.theme,
    sections: draft.sections,
    questions: draft.questions,
    assets: {},
    participation: {
      status: 'not_started',
      answers: {},
      can_edit: false,
      can_respond_again: false,
      draft_updated: false,
      ...participation,
    },
  }
}

const PATH = `/s/${SURVEY_ID}`

function open(survey: RespondentSurvey) {
  vi.spyOn(respondApi, 'getRespondentSurvey').mockResolvedValue(survey)
  const saveDraft = vi
    .spyOn(respondApi, 'saveRespondentDraft')
    .mockResolvedValue({ saved_at: '2026-11-04T10:00:00Z' })
  const submit = vi.spyOn(respondApi, 'submitAnswers').mockResolvedValue({
    status: 'submitted',
    submitted_at: '2026-11-04T10:05:00Z',
    can_edit: false,
    can_respond_again: false,
  })
  vi.spyOn(respondApi, 'listMySurveys').mockResolvedValue([])
  const view = renderRoute(PATH, { user: TEST_USERS.employee })
  return { ...view, saveDraft, submit }
}

beforeEach(() => {
  vi.spyOn(respondApi, 'listMySurveys').mockResolvedValue([])
})

describe('access messages', () => {
  it.each([
    [
      'NOT_IN_AUDIENCE',
      403,
      "This survey isn't available to you. If you think that's a mistake, contact HR.",
    ],
    ['NOT_OPEN_YET', 410, 'This survey opens on 10 Nov.'],
    ['SURVEY_CLOSED', 410, 'This survey closed on 24 Nov. Thanks for your interest.'],
  ])('shows the %s message', async (code, status, message) => {
    vi.spyOn(respondApi, 'getRespondentSurvey').mockRejectedValue(
      new ApiError({ status, code, message }),
    )

    renderRoute(PATH, { user: TEST_USERS.employee })

    expect(await screen.findByRole('heading', { name: message })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to My surveys' })).toHaveAttribute('href', '/')
  })

  it('offers a retry when the network fails', async () => {
    vi.spyOn(respondApi, 'getRespondentSurvey').mockRejectedValue(
      new ApiError({ status: null, code: 'NETWORK_ERROR', message: 'x' }),
    )

    renderRoute(PATH, { user: TEST_USERS.employee })

    expect(
      await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 }),
    ).toBeInTheDocument()
  })
})

describe('answering', () => {
  it('resumes a draft at the first unanswered question', async () => {
    open(respondent({ status: 'in_progress', answers: { [Q[0]!]: 4 } }))

    expect(await screen.findByText('Question 2 of 4')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Which work mode/ })).toBeInTheDocument()
  })

  it('autosaves answers about 1.5 s after the last change', async () => {
    const user = userEvent.setup()
    const { saveDraft } = open(respondent())

    await user.click(await screen.findByRole('radio', { name: '4' }))

    expect(saveDraft).not.toHaveBeenCalled()
    await waitFor(
      () => {
        expect(saveDraft).toHaveBeenCalledWith(SURVEY_ID, { [Q[0]!]: 4 })
      },
      { timeout: 3000 },
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('submits and shows the thank-you screen', async () => {
    const user = userEvent.setup()
    const { submit } = open(
      respondent(
        { status: 'in_progress', answers: { [Q[0]!]: 4, [Q[1]!]: OFFICE, [Q[5]!]: NOT_MANAGER } },
        { layout: 'all' },
      ),
    )

    await user.click(await screen.findByRole('button', { name: 'Submit response' }))

    expect(submit).toHaveBeenCalledWith(SURVEY_ID, {
      [Q[0]!]: 4,
      [Q[1]!]: OFFICE,
      [Q[5]!]: NOT_MANAGER,
    })
    expect(await screen.findByRole('heading', { name: 'Response recorded' })).toBeInTheDocument()
    // A way back to their home page.
    const home = screen.getByRole('link', { name: 'Go to My surveys' })
    expect(home).toHaveAttribute('href', '/')
    await user.click(home)
    expect(await screen.findByRole('heading', { level: 1, name: 'My surveys' })).toBeVisible()
  })

  it('shows problems from the server next to the question', async () => {
    const user = userEvent.setup()
    const { submit } = open(
      respondent(
        { status: 'in_progress', answers: { [Q[0]!]: 4, [Q[1]!]: OFFICE, [Q[5]!]: NOT_MANAGER } },
        { layout: 'all' },
      ),
    )
    submit.mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Check 1 answer before submitting.',
        details: { issues: [{ question_key: Q[1], message: 'Choose one of the options.' }] },
      }),
    )

    await user.click(await screen.findByRole('button', { name: 'Submit response' }))

    expect(await screen.findByText('Choose one of the options.')).toBeInTheDocument()
    expect(screen.getByText('Check 1 answer before submitting.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Response recorded' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Remote' }))
    expect(screen.queryByText('Choose one of the options.')).not.toBeInTheDocument()
  })

  it('treats "already submitted" as done', async () => {
    const user = userEvent.setup()
    const { submit } = open(
      respondent(
        { status: 'in_progress', answers: { [Q[0]!]: 4, [Q[1]!]: OFFICE, [Q[5]!]: NOT_MANAGER } },
        { layout: 'all' },
      ),
    )
    submit.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'ALREADY_SUBMITTED',
        message: "You've already responded.",
      }),
    )

    await user.click(await screen.findByRole('button', { name: 'Submit response' }))

    expect(await screen.findByRole('heading', { name: 'Response recorded' })).toBeInTheDocument()
  })

  it('tells people when the survey changed under their draft', async () => {
    open(respondent({ status: 'in_progress', answers: {}, draft_updated: true }))

    expect(
      await screen.findByText(
        'This survey was updated. Your answers have been kept where possible.',
      ),
    ).toBeInTheDocument()
  })
})

describe('after submitting', () => {
  it('shows the thank-you screen when they come back', async () => {
    const { saveDraft } = open(respondent({ status: 'submitted' }))

    expect(await screen.findByRole('heading', { name: 'Response recorded' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit response' })).not.toBeInTheDocument()
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('lets them edit until the survey closes, with their answers', async () => {
    const user = userEvent.setup()
    open(
      respondent(
        {
          status: 'submitted',
          can_edit: true,
          answers: { [Q[0]!]: 2, [Q[1]!]: OFFICE, [Q[5]!]: NOT_MANAGER },
        },
        { layout: 'all', allow_edit: true },
      ),
    )

    await user.click(await screen.findByRole('button', { name: 'Edit response' }))

    const rating = screen.getByRole('radiogroup', { name: /current work setup/ })
    expect(within(rating).getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Office, full-time' })).toBeChecked()
  })

  it('offers another response when one response per person is off', async () => {
    const user = userEvent.setup()
    open(respondent({ status: 'submitted', can_respond_again: true }, { one_response: false }))

    await user.click(await screen.findByRole('button', { name: 'Start another response' }))

    expect(screen.getByText('Question 1 of 4')).toBeInTheDocument()
  })
})
