/** Phase T3: training figures, the completion report, and the training home and lists. */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as respondApi from '@/features/respond/api'
import type { MySurvey } from '@/features/respond/api'
import { dueText, homeKpis } from '@/features/surveys-home/home-stats'
import * as surveysApi from '@/features/surveys/api'
import type { SurveyListItem } from '@/features/surveys/types'
import { TEST_USERS } from '@/test/auth'
import { renderRoute } from '@/test/render'
import { mockRespondDefaults } from '@/test/respond'

import * as resultsApi from './api'
import type { CompletionReport, ResultsSummary, TrainingFigures } from './api'

const SURVEY_ID = '7b0f7c1e-5d55-4c2a-9a59-0d7e1d2c3b4a'
const URL = `/admin/surveys/${SURVEY_ID}/results`

function isoDay(offset: number): string {
  const day = new Date()
  day.setDate(day.getDate() + offset)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

const SUMMARY: ResultsSummary = {
  small_group: false,
  responses: 380,
  respondents: 380,
  invited: 421,
  response_rate: 0.9026,
  responses_this_week: 40,
  last_response_at: '2026-11-04T09:00:00Z',
  headline: null,
  money: null,
  title: 'Fire safety basics',
  status: 'published',
  anonymous: false,
  open_to_all: false,
  versions: [{ version_no: 1, published_at: '2026-10-21T09:00:00Z', responses: 380 }],
  compatible_versions: true,
  version_applied: null,
  filter_options: { departments: ['Engineering', 'Sales'], locations: ['Pune'] },
  can_download_non_responders: true,
  closes_at: null,
  kind: 'training',
}

const FIGURES: TrainingFigures = {
  completed: 380,
  invited: 421,
  pass_mark: 70,
  passed: 300,
  pass_rate: 0.7895,
  average_score: 74.3,
  average_attempts: 1.6,
  attempts_to_pass: [
    { attempts: 1, label: '1', people: 200 },
    { attempts: 2, label: '2', people: 80 },
    { attempts: 3, label: '3', people: 20 },
    { attempts: 4, label: '4', people: 0 },
    { attempts: 5, label: '5 or more', people: 0 },
  ],
  questions: [
    {
      key: 'q3',
      number: 3,
      text: 'How far away is the assembly point?',
      shown: 380,
      correct: 190,
      share: 0.5,
      needs_attention: true,
    },
    {
      key: 'q1',
      number: 1,
      text: 'What should you do first?',
      shown: 380,
      correct: 342,
      share: 0.9,
      needs_attention: false,
    },
  ],
  videos: [{ section_key: 's1', title: 'Preventing fires', watched: 395 }],
  due_date: '2026-11-08',
}

function report(overrides: Partial<CompletionReport> = {}): CompletionReport {
  return {
    total: 421,
    counts: { passed: 300, not_passed: 80, completed: 0, in_progress: 20, not_started: 21 },
    late: 35,
    matching: 421,
    page: 1,
    page_size: 50,
    has_pass_mark: true,
    due_date: '2026-11-08',
    rows: [
      {
        employee_id: 'L4001',
        name: 'Asha Rao',
        department: 'Engineering',
        location: 'Pune',
        status: 'passed',
        best_score: 92,
        attempts: 2,
        completed_at: '2026-11-06T10:00:00Z',
        late: false,
      },
      {
        employee_id: 'L4002',
        name: null,
        department: 'Sales',
        location: null,
        status: 'not_started',
        best_score: null,
        attempts: 0,
        completed_at: null,
        late: true,
      },
    ],
    ...overrides,
  }
}

function mockResults() {
  vi.spyOn(resultsApi, 'getSummary').mockResolvedValue(SUMMARY)
  vi.spyOn(resultsApi, 'getTimeline').mockResolvedValue({ days: [], reminders: [] })
  vi.spyOn(resultsApi, 'getParticipation').mockResolvedValue({
    open_to_all: false,
    departments: [],
  })
  vi.spyOn(resultsApi, 'getQuestions').mockResolvedValue({
    small_group: false,
    responses: 380,
    sections: [],
  })
  vi.spyOn(resultsApi, 'getTrainingFigures').mockResolvedValue(FIGURES)
  return vi.spyOn(resultsApi, 'getCompletion').mockResolvedValue(report())
}

beforeEach(() => {
  mockRespondDefaults()
})

describe('training results', () => {
  it('shows completed, passed, scores, % correct (lowest first), attempts and videos', async () => {
    mockResults()
    renderRoute(URL, { user: TEST_USERS.hr })

    const tiles = await screen.findByText('Completed')
    const grid = tiles.closest('dl')!
    expect(within(grid).getByText('380')).toBeInTheDocument()
    expect(within(grid).getByText('of 421 invited (90%)')).toBeInTheDocument()
    expect(within(grid).getByText('79%')).toBeInTheDocument()
    expect(within(grid).getByText(/300 of 380 completed · pass mark 70%/)).toBeInTheDocument()
    expect(within(grid).getByText('74.3%')).toBeInTheDocument()
    expect(within(grid).getByText('1.6')).toBeInTheDocument()

    const correct = screen.getByRole('list', { name: 'Correct answers per question' })
    const items = within(correct).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Q3 How far away is the assembly point?')
    expect(items[0]).toHaveTextContent('50% · 190 of 380')
    expect(items[0]).toHaveTextContent('Needs attention')
    expect(items[1]).not.toHaveTextContent('Needs attention')
    expect(screen.getByText(/1 question needs attention/)).toBeInTheDocument()

    const attempts = screen.getByRole('list', { name: 'Attempts needed to pass' })
    expect(within(attempts).getAllByRole('listitem')[0]).toHaveTextContent('First attempt')
    expect(within(attempts).getAllByRole('listitem')[0]).toHaveTextContent('67% · 200')
    expect(screen.getByRole('list', { name: 'Videos watched to the end' })).toHaveTextContent(
      'Preventing fires94% · 395',
    )
    expect(screen.getByRole('button', { name: 'Best attempts' })).toBeInTheDocument()
  })

  it('lists everyone on the Completion tab, filters by status and downloads', async () => {
    const user = userEvent.setup()
    const completion = mockResults()
    const download = vi.spyOn(resultsApi, 'downloadCompletion').mockResolvedValue()
    renderRoute(`${URL}?tab=completion`, { user: TEST_USERS.hr })

    expect(await screen.findByRole('heading', { name: 'Completion report' })).toBeInTheDocument()
    expect(screen.getByText(/35 late or overdue/)).toBeInTheDocument()
    const status = screen.getByRole('group', { name: 'Status' })
    expect(
      within(status)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Everyone421', 'Passed300', 'Not passed80', 'In progress20', 'Not started21'])
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Asha Rao')
    expect(rows[1]).toHaveTextContent('Passed')
    expect(rows[1]).toHaveTextContent('92%')
    expect(rows[2]).toHaveTextContent('L4002')
    expect(rows[2]).toHaveTextContent('Not started')
    expect(rows[2]).toHaveTextContent('Overdue')

    await user.click(within(status).getByRole('button', { name: /Not started/ }))
    expect(completion).toHaveBeenLastCalledWith(
      SURVEY_ID,
      expect.anything(),
      { status: 'not_started', page: 1 },
      expect.anything(),
    )
    await user.click(screen.getByRole('button', { name: 'Download (Excel)' }))
    expect(download).toHaveBeenCalledWith(
      SURVEY_ID,
      expect.anything(),
      'Fire safety basics',
      'not_started',
    )
  })
})

describe('the Trainings home and My trainings', () => {
  function item(overrides: Partial<SurveyListItem>): SurveyListItem {
    return {
      id: SURVEY_ID,
      title: 'Fire safety basics',
      kind: 'training',
      status: 'published',
      version_no: 1,
      response_count: 40,
      responses_this_week: 12,
      audience_count: 50,
      response_rate: 0.8,
      opens_at: null,
      closes_at: null,
      has_unpublished_changes: false,
      my_role: 'owner',
      can_edit: true,
      can_delete: false,
      open_to_all: false,
      updated_at: new Date().toISOString(),
      passed_count: 30,
      pass_rate: 0.75,
      due_date: isoDay(3),
      ...overrides,
    }
  }

  it('averages pass rates over live trainings', () => {
    const kpis = homeKpis([
      item({}),
      item({ id: 'b', pass_rate: 0.25 }),
      item({ id: 'c', pass_rate: null }),
      item({ id: 'd', status: 'closed', pass_rate: 0 }),
    ])
    expect(kpis.averagePassRate).toBe(0.5)
  })

  it('words due dates', () => {
    const today = '2026-11-13'
    expect(dueText('2026-11-12', today)).toMatch(/^Overdue since/)
    expect(dueText('2026-11-13', today)).toBe('Due today')
    expect(dueText('2026-11-14', today)).toBe('Due tomorrow')
    expect(dueText('2026-11-17', today)).toBe('Due in 4 days')
    expect(dueText('2026-12-20', today)).toMatch(/^Due \d+ Dec|^Due Dec \d+/)
  })

  it('shows completed this week, pass rates and due dates on the Trainings home', async () => {
    vi.spyOn(surveysApi, 'listSurveys').mockResolvedValue([item({})])
    renderRoute('/admin/trainings', { user: TEST_USERS.hr })

    expect(await screen.findByText('Completed this week')).toBeInTheDocument()
    expect(screen.getByText('Average pass rate')).toBeInTheDocument()
    expect(screen.getByText('75% passed')).toBeInTheDocument()
    expect(screen.getByText('(30 of 40)', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Due in 3 days')).toBeInTheDocument()
  })

  it('shows due dates on My trainings until completed', async () => {
    const mine = (overrides: Partial<MySurvey>): MySurvey => ({
      id: SURVEY_ID,
      title: 'Fire safety basics',
      description: '',
      status: 'pending',
      open: true,
      closes_at: null,
      minutes: 5,
      progress: null,
      accent: '#0E7A6A',
      cover: null,
      submitted_at: null,
      videos_total: 0,
      videos_done: 0,
      due_date: isoDay(4),
      ...overrides,
    })
    vi.spyOn(respondApi, 'listMyTrainings').mockResolvedValue([
      mine({}),
      mine({ id: 'late', title: 'Data privacy', due_date: isoDay(-2) }),
      mine({ id: 'done', title: 'First aid', status: 'submitted', due_date: isoDay(-2) }),
    ])
    renderRoute('/trainings', { user: TEST_USERS.employee })

    expect(await screen.findByText('Due in 4 days')).toBeInTheDocument()
    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getAllByText(/Due|Overdue/)).toHaveLength(2)
  })
})
