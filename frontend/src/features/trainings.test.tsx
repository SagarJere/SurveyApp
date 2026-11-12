/** Phase T1: the Trainings home, My trainings, and taking a training with a video. */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as respondApi from '@/features/respond/api'
import type { MySurvey, RespondentSurvey } from '@/features/respond/api'
import * as surveysApi from '@/features/surveys/api'
import type { SurveyListItem } from '@/features/surveys/types'
import { TEST_USERS } from '@/test/auth'
import { surveyDetail, pulseDraft, SURVEY_ID } from '@/test/builder'
import { fakeMedia } from '@/test/media'
import { renderRoute } from '@/test/render'
import { mockRespondDefaults } from '@/test/respond'

function training(overrides: Partial<SurveyListItem> = {}): SurveyListItem {
  return {
    id: SURVEY_ID,
    title: 'Fire safety basics',
    kind: 'training',
    status: 'published',
    version_no: 1,
    response_count: 346,
    responses_this_week: 40,
    audience_count: 480,
    response_rate: 0.72,
    opens_at: null,
    closes_at: null,
    has_unpublished_changes: false,
    my_role: 'owner',
    can_edit: true,
    can_delete: false,
    open_to_all: false,
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function mine(overrides: Partial<MySurvey> = {}): MySurvey {
  return {
    id: SURVEY_ID,
    title: 'Fire safety basics',
    description: '',
    status: 'in_progress',
    open: true,
    closes_at: null,
    minutes: 20,
    progress: 0,
    accent: '#0E7A6A',
    cover: null,
    submitted_at: null,
    videos_total: 2,
    videos_done: 1,
    ...overrides,
  }
}

beforeEach(() => {
  mockRespondDefaults()
})

describe('Trainings home', () => {
  it('lists trainings and creates a new one', async () => {
    const user = userEvent.setup()
    const list = vi.spyOn(surveysApi, 'listSurveys').mockResolvedValue([training()])
    const create = vi
      .spyOn(surveysApi, 'createSurvey')
      .mockResolvedValue(surveyDetail(pulseDraft(), { kind: 'training' }))
    vi.spyOn(surveysApi, 'getSurvey').mockResolvedValue(
      surveyDetail(pulseDraft(), { kind: 'training' }),
    )
    vi.spyOn(surveysApi, 'listVideos').mockResolvedValue([])
    const { router } = renderRoute('/admin/trainings', { user: TEST_USERS.hr })

    expect(await screen.findByRole('heading', { level: 1, name: 'Trainings' })).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith('training', expect.anything())
    expect(screen.getByRole('link', { name: 'Trainings' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText('Live trainings')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fire safety basics' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New training' }))
    expect(create).toHaveBeenCalledWith('training')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/admin/surveys/${SURVEY_ID}/edit`)
    })
  })

  it('shows My trainings to everyone and Trainings only to HR', async () => {
    renderRoute('/', { user: TEST_USERS.employee })
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'My trainings' })).toHaveAttribute(
      'href',
      '/trainings',
    )
    expect(within(nav).queryByRole('link', { name: 'Trainings' })).toBeNull()
  })
})

describe('My trainings', () => {
  it('lists trainings with how many videos are watched', async () => {
    vi.spyOn(respondApi, 'listMyTrainings').mockResolvedValue([mine()])
    renderRoute('/trainings', { user: TEST_USERS.employee })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'My trainings' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('1 of 2 videos watched')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue: Fire safety basics' })).toHaveAttribute(
      'href',
      `/s/${SURVEY_ID}`,
    )
  })
})

describe('taking a training', () => {
  it('saves video progress, and finishing opens the questions', async () => {
    const draft = pulseDraft()
    const first = draft.sections[0]!
    const survey: RespondentSurvey = {
      survey_id: SURVEY_ID,
      kind: 'training',
      version_no: 1,
      title: 'Fire safety basics',
      description: '',
      settings: { ...draft.settings, layout: 'all' },
      theme: draft.theme,
      sections: draft.sections,
      questions: draft.questions,
      assets: {},
      videos: {
        [first.key]: {
          url: '/api/files/videos/v1?exp=1&sig=x',
          allow_seek: false,
          allow_speed: false,
          duration_seconds: 300,
        },
      },
      video_progress: {},
      participation: {
        status: 'not_started',
        answers: {},
        can_edit: false,
        can_respond_again: false,
        draft_updated: false,
      },
    }
    vi.spyOn(respondApi, 'getRespondentSurvey').mockResolvedValue(survey)
    const save = vi
      .spyOn(respondApi, 'saveVideoProgress')
      .mockResolvedValue({ furthest_seconds: 300, completed: true })
    renderRoute(`/s/${SURVEY_ID}`, { user: TEST_USERS.employee })

    const video = await screen.findByLabelText<HTMLVideoElement>(`Video: ${first.title}`)
    const firstQuestion = draft.questions.find((q) => q.section_key === first.key)!
    expect(
      screen.queryByRole('heading', { name: new RegExp(firstQuestion.text.slice(0, 20)) }),
    ).toBeNull()

    const media = fakeMedia(video, 300)
    media.playTo(15)
    expect(save).toHaveBeenLastCalledWith(SURVEY_ID, first.key, 15, false)
    media.end()

    expect(save).toHaveBeenLastCalledWith(SURVEY_ID, first.key, 300, true)
    expect(
      await screen.findByRole('heading', { name: new RegExp(firstQuestion.text.slice(0, 20)) }),
    ).toBeInTheDocument()
  })
})
