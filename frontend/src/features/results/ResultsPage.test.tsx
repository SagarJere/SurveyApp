import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as healthApi from '@/features/health/api'
import { ApiError } from '@/lib/api'
import { TEST_USERS } from '@/test/auth'
import { renderRoute } from '@/test/render'

import * as resultsApi from './api'
import type {
  CommentsResult,
  ParticipationResult,
  QuestionsResult,
  ResultsSummary,
  Timeline,
} from './api'
import { SMALL_GROUP_MESSAGE } from './SmallGroupNotice'

const SURVEY_ID = '7b0f7c1e-5d55-4c2a-9a59-0d7e1d2c3b4a'
const URL = `/admin/surveys/${SURVEY_ID}/results`
const Q = {
  rating: '00000000-0000-4000-8000-000000000001',
  mode: '00000000-0000-4000-8000-000000000002',
  tools: '00000000-0000-4000-8000-000000000003',
  budget: '00000000-0000-4000-8000-000000000004',
  comment: '00000000-0000-4000-8000-000000000005',
}
const REMOTE = '00000000-0000-4000-8000-0000000000a3'

function summary(overrides: Partial<ResultsSummary> = {}): ResultsSummary {
  return {
    small_group: false,
    responses: 412,
    respondents: 412,
    invited: 480,
    response_rate: 0.8583,
    responses_this_week: 57,
    last_response_at: '2026-11-04T09:00:00Z',
    headline: {
      question_key: Q.rating,
      text: 'How satisfied are you with your work setup?',
      average: 3.46,
    },
    money: {
      question_key: Q.budget,
      text: 'Home office budget',
      currency: 'INR',
      median: 25750,
      median_formatted: '₹25,750',
      median_words: 'Twenty-five thousand seven hundred fifty rupees only',
    },
    title: 'Workplace pulse',
    status: 'published',
    anonymous: false,
    open_to_all: false,
    versions: [{ version_no: 1, published_at: '2026-10-21T09:00:00Z', responses: 412 }],
    compatible_versions: true,
    version_applied: null,
    filter_options: { departments: ['Engineering', 'Legal', 'Sales'], locations: ['Pune'] },
    can_download_non_responders: true,
    closes_at: '2026-11-24',
    ...overrides,
  }
}

const timeline: Timeline = {
  days: [
    { day: '2026-11-02', n: 120 },
    { day: '2026-11-03', n: 200 },
    { day: '2026-11-04', n: 92 },
  ],
  reminders: [],
}

const participation: ParticipationResult = {
  open_to_all: false,
  departments: [
    { department: 'Engineering', invited: 300, responded: 270, rate: 0.9 },
    { department: 'Sales', invited: 177, responded: 139, rate: 0.7853 },
    { department: 'Legal', invited: 3, responded: 1, rate: 0.3333 },
  ],
}

const questions: QuestionsResult = {
  small_group: false,
  responses: 412,
  sections: [
    {
      key: 's1',
      title: 'Your work setup',
      description: '',
      condition: null,
      questions: [
        {
          key: Q.rating,
          number: 1,
          type: 'rating',
          text: 'How satisfied are you with your work setup?',
          required: true,
          condition: null,
          shown: 412,
          answered: 412,
          average: 3.46,
          distribution: [1, 2, 3, 4, 5].map((value) => ({ value, n: 10 * value, share: 0.05 })),
        },
        {
          key: Q.mode,
          number: 2,
          type: 'single',
          text: 'Which work mode suits you?',
          required: true,
          condition: null,
          shown: 412,
          answered: 412,
          options: [
            { key: 'o1', label: 'Office', n: 99, share: 0.2403 },
            { key: 'o2', label: 'Hybrid', n: 213, share: 0.517 },
            { key: REMOTE, label: 'Remote', n: 100, share: 0.2427 },
          ],
        },
        {
          key: Q.tools,
          number: 3,
          type: 'multi',
          text: 'What would help at home?',
          required: false,
          condition: { src: Q.mode, op: 'is', val: REMOTE },
          shown: 100,
          answered: 94,
          options: [
            { key: 't1', label: 'Monitor', n: 60, share: 0.6 },
            { key: 't2', label: 'Chair', n: 42, share: 0.42 },
          ],
        },
        {
          key: Q.budget,
          number: 4,
          type: 'money',
          text: 'Home office budget',
          required: false,
          condition: null,
          shown: 412,
          answered: 300,
          currency: 'INR',
          stats: {
            total: 8097000,
            average: 35204,
            median: 25750,
            min: 2000,
            max: 222500,
            average_words: 'Thirty-five thousand two hundred four rupees only',
            median_words: 'Twenty-five thousand seven hundred fifty rupees only',
          },
          ranges: [{ label: 'Under ₹10,000', n: 34, share: 0.1133 }],
        },
        {
          key: Q.comment,
          number: 5,
          type: 'long',
          text: 'Anything else?',
          required: false,
          condition: null,
          shown: 412,
          answered: 41,
        },
      ],
    },
  ],
}

const comments: CommentsResult = {
  small_group: false,
  total: 1,
  page: 1,
  page_size: 20,
  items: [
    {
      question_key: Q.comment,
      number: 5,
      text: 'The VPN drops several times a day.',
      department: 'Engineering',
      location: 'Pune',
      submitted_on: '2026-11-03',
      employee: null,
    },
  ],
}

function mockResults(data: ResultsSummary = summary()) {
  return {
    summary: vi.spyOn(resultsApi, 'getSummary').mockResolvedValue(data),
    timeline: vi.spyOn(resultsApi, 'getTimeline').mockResolvedValue(timeline),
    participation: vi.spyOn(resultsApi, 'getParticipation').mockResolvedValue(participation),
    questions: vi.spyOn(resultsApi, 'getQuestions').mockResolvedValue(questions),
    comments: vi.spyOn(resultsApi, 'getComments').mockResolvedValue(comments),
  }
}

beforeEach(() => {
  vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue({
    status: 'ok',
    database: 'ok',
    environment: 'test',
    version: '0.1.0',
  })
})

describe('Results dashboard', () => {
  it('shows the takeaway, headline tiles and every widget type', async () => {
    mockResults()
    renderRoute(URL, { user: TEST_USERS.hr })

    expect(await screen.findByRole('heading', { level: 1, name: 'Workplace pulse' })).toBeVisible()
    expect(
      screen.getByText(/412 people have responded, 86% of those invited\./),
    ).toBeInTheDocument()
    expect(screen.getByText(/is 3\.5 out of 5\./)).toBeInTheDocument()

    const tiles = screen.getAllByRole('definition')
    expect(tiles.map((t) => t.textContent)).toEqual(
      expect.arrayContaining(['412', 'of 480 invited', '86%', '3.5 / 5', '₹25,750']),
    )

    // Single choice: label, "share · count", ordered as in the survey.
    const mode = await screen.findByRole('list', { name: 'Answers to question 2' })
    const rows = within(mode).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      'Office24% · 99',
      'Hybrid52% · 213',
      'Remote24% · 100',
    ])

    // Checkboxes: out of the people shown, with the "more than one" note and the condition.
    const tools = screen.getByRole('article', { name: /What would help at home/ })
    expect(
      within(tools).getByText(/Only shown to people who answered “Remote” to Q2: 100 people\./),
    ).toBeInTheDocument()
    expect(within(tools).getByText(/shares add up to more than 100%/)).toBeInTheDocument()
    expect(within(tools).getByText('60% · 60')).toBeInTheDocument()

    // Rating: average plus distribution.
    const rating = screen.getByRole('article', { name: /How satisfied/ })
    expect(within(rating).getByText('3.5')).toBeInTheDocument()
    expect(within(rating).getByText('5 (highest)')).toBeInTheDocument()

    // Money: stat boxes with words, then ranges.
    const money = screen.getByRole('article', { name: /Home office budget/ })
    expect(within(money).getByText('₹80,97,000')).toBeInTheDocument()
    expect(
      within(money).getByText('Thirty-five thousand two hundred four rupees only'),
    ).toBeInTheDocument()
    expect(within(money).getByText('Under ₹10,000')).toBeInTheDocument()

    // Paragraph: count of comments and the list.
    const comment = screen.getByRole('article', { name: /Anything else/ })
    expect(within(comment).getByText('41 of 412 people left a comment.')).toBeInTheDocument()
    expect(await within(comment).findByText('The VPN drops several times a day.')).toBeVisible()
  })

  it('flags low participation with a label, not just colour', async () => {
    mockResults()
    renderRoute(URL, { user: TEST_USERS.hr })
    const table = await screen.findByRole('table', { name: /by department/ })
    const legal = within(table).getByRole('row', { name: /Legal/ })
    expect(within(legal).getByText('Low')).toBeInTheDocument()
    const engineering = within(table).getByRole('row', { name: /Engineering/ })
    expect(within(engineering).queryByText('Low')).not.toBeInTheDocument()
  })

  it('filters the whole page by department when a row is selected', async () => {
    const mocks = mockResults()
    const user = userEvent.setup()
    const { router } = renderRoute(URL, { user: TEST_USERS.hr })

    await user.click(await screen.findByRole('button', { name: /^Sales, filter by/ }))

    await waitFor(() => {
      expect(router.state.location.search).toBe('?department=Sales')
    })
    await waitFor(() => {
      expect(mocks.questions).toHaveBeenLastCalledWith(
        SURVEY_ID,
        expect.objectContaining({ department: 'Sales' }),
        expect.anything(),
      )
    })
    expect(screen.getByLabelText('Department')).toHaveValue('Sales')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
  })

  it('hides answers for a group of fewer than 5 and shows the notice', async () => {
    const mocks = mockResults(
      summary({
        small_group: true,
        responses: 1,
        respondents: 1,
        invited: 3,
        response_rate: 0.3333,
        headline: null,
        money: null,
      }),
    )
    renderRoute(`${URL}?department=Legal`, { user: TEST_USERS.hr })

    expect(await screen.findByText(SMALL_GROUP_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('Department')).toHaveValue('Legal')
    // Participation still shows; no question cards or averages.
    expect(await screen.findByRole('table', { name: /by department/ })).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByText(/out of 5/)).not.toBeInTheDocument()
    expect(mocks.comments).not.toHaveBeenCalled()
  })

  it('lists individual responses and opens one', async () => {
    mockResults()
    vi.spyOn(resultsApi, 'getResponses').mockResolvedValue({
      total: 1,
      page: 1,
      page_size: 25,
      items: [
        {
          id: 'r1',
          employee_id: 'E2001',
          name: 'Priya Nair',
          department: 'Engineering',
          location: 'Pune',
          submitted_at: '2026-11-03T10:15:00Z',
          version_no: 1,
        },
      ],
    })
    vi.spyOn(resultsApi, 'getResponse').mockResolvedValue({
      id: 'r1',
      employee_id: 'E2001',
      name: 'Priya Nair',
      department: 'Engineering',
      location: 'Pune',
      submitted_at: '2026-11-03T10:15:00Z',
      version_no: 1,
      answers: [
        {
          key: Q.mode,
          number: 2,
          type: 'single',
          text: 'Which work mode suits you?',
          answer: 'Hybrid',
        },
      ],
    })
    const user = userEvent.setup()
    const { router } = renderRoute(URL, { user: TEST_USERS.hr })

    await user.click(await screen.findByRole('button', { name: 'Individual responses' }))
    expect(router.state.location.search).toBe('?tab=responses')
    await user.click(await screen.findByRole('button', { name: /Priya Nair/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Priya Nair' })
    expect(await within(dialog).findByText('Hybrid')).toBeInTheDocument()
    expect(within(dialog).getByText(/Which work mode suits you/)).toBeInTheDocument()
  })

  it('has no individual responses for anonymous surveys', async () => {
    mockResults(summary({ anonymous: true }))
    const getResponses = vi.spyOn(resultsApi, 'getResponses')
    renderRoute(`${URL}?tab=responses`, { user: TEST_USERS.hr })

    expect(await screen.findByText('Anonymous')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Individual responses' })).not.toBeInTheDocument()
    expect(await screen.findByRole('article', { name: /Which work mode/ })).toBeInTheDocument()
    expect(getResponses).not.toHaveBeenCalled()
  })

  it('says there are no results before the first publish', async () => {
    vi.spyOn(resultsApi, 'getSummary').mockRejectedValue(
      new ApiError({ status: 409, code: 'NOT_PUBLISHED', message: 'Not published' }),
    )
    renderRoute(URL, { user: TEST_USERS.hr })
    expect(await screen.findByRole('heading', { name: 'No results yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the builder' })).toHaveAttribute(
      'href',
      `/admin/surveys/${SURVEY_ID}/edit`,
    )
  })

  it('shows not found for a survey that is not shared with you', async () => {
    vi.spyOn(resultsApi, 'getSummary').mockRejectedValue(
      new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Not Found' }),
    )
    renderRoute(URL, { user: TEST_USERS.hr })
    expect(
      await screen.findByRole('heading', { name: "We couldn't find that survey" }),
    ).toBeInTheDocument()
  })

  it.each([
    ['Responses (Excel)', 'responses'],
    ['Responses with analytics (Excel)', 'analytics'],
  ] as const)('downloads %s with the current filters', async (label, kind) => {
    mockResults()
    const download = vi.spyOn(resultsApi, 'downloadExport').mockResolvedValue()
    const user = userEvent.setup()
    renderRoute(`${URL}?location=Pune`, { user: TEST_USERS.hr })

    await user.click(await screen.findByRole('button', { name: 'Download' }))
    expect(screen.getByText("Downloads use the filters you've set.")).toBeInTheDocument()
    await user.click(
      screen.getByRole('menuitem', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')}`) }),
    )

    expect(download).toHaveBeenCalledWith(
      SURVEY_ID,
      expect.objectContaining({ location: 'Pune', department: null }),
      'Workplace pulse',
      kind,
    )
    expect(await screen.findByText(`${label} downloaded.`)).toBeInTheDocument()
  })
})
