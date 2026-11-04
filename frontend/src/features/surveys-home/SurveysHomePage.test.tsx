import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as healthApi from '@/features/health/api'
import * as surveysApi from '@/features/surveys/api'
import type { SurveyListItem } from '@/features/surveys/types'
import { shortDate } from '@/lib/format'
import { TEST_USERS } from '@/test/auth'
import { mockBuilderApi, pulseDraft, surveyDetail, SURVEY_ID } from '@/test/builder'
import { renderRoute } from '@/test/render'

function item(overrides: Partial<SurveyListItem> = {}): SurveyListItem {
  return {
    id: SURVEY_ID,
    title: 'Workplace pulse, Q4 2026',
    status: 'draft',
    version_no: null,
    response_count: 0,
    audience_count: 0,
    response_rate: null,
    opens_at: '2026-11-10',
    closes_at: '2026-11-24',
    has_unpublished_changes: false,
    my_role: 'owner',
    can_edit: true,
    can_delete: true,
    updated_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    ...overrides,
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

describe('Surveys home', () => {
  it('lists surveys with status, last edit and dates', async () => {
    vi.spyOn(surveysApi, 'listSurveys').mockResolvedValue([
      item(),
      item({ id: 'b', title: '', can_delete: false, opens_at: null, closes_at: null }),
    ])

    renderRoute('/admin/surveys', { user: TEST_USERS.hr })

    await screen.findByRole('link', { name: 'Workplace pulse, Q4 2026' })
    const rows = screen.getAllByRole('listitem')
    expect(
      within(rows[0]!).getByRole('link', { name: 'Workplace pulse, Q4 2026' }),
    ).toHaveAttribute('href', `/admin/surveys/${SURVEY_ID}/edit`)
    expect(within(rows[0]!).getByText('Draft')).toBeInTheDocument()
    expect(
      // Dates follow the browser's locale, so compare with the same formatter.
      within(rows[0]!).getByText(
        `Edited 2 hours ago · ${shortDate('2026-11-10')} – ${shortDate('2026-11-24')}`,
      ),
    ).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Untitled survey')).toBeInTheDocument()
    expect(within(rows[1]!).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
  })

  it('offers "New survey" in the empty state and opens the builder', async () => {
    const user = userEvent.setup()
    vi.spyOn(surveysApi, 'listSurveys').mockResolvedValue([])
    const create = vi
      .spyOn(surveysApi, 'createSurvey')
      .mockResolvedValue(surveyDetail(pulseDraft()))
    mockBuilderApi(pulseDraft())
    const { router } = renderRoute('/admin/surveys', { user: TEST_USERS.hr })

    expect(await screen.findByText('No surveys yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New survey' }))

    expect(create).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/admin/surveys/${SURVEY_ID}/edit`)
    })
    expect(await screen.findByLabelText('Survey title')).toBeInTheDocument()
  })

  it('duplicates a survey and opens the copy', async () => {
    const user = userEvent.setup()
    vi.spyOn(surveysApi, 'listSurveys').mockResolvedValue([item()])
    const copy = surveyDetail(
      { ...pulseDraft(), title: 'Workplace pulse, Q4 2026 (copy)' },
      { id: 'copy-id' },
    )
    vi.spyOn(surveysApi, 'duplicateSurvey').mockResolvedValue(copy)
    mockBuilderApi(copy.draft, { id: 'copy-id' })
    const { router } = renderRoute('/admin/surveys', { user: TEST_USERS.hr })

    await user.click(
      await screen.findByRole('button', { name: 'Duplicate Workplace pulse, Q4 2026' }),
    )

    expect(
      await screen.findByText('Made a copy of “Workplace pulse, Q4 2026”.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/surveys/copy-id/edit')
    })
  })

  it('asks before deleting, and can be cancelled', async () => {
    const user = userEvent.setup()
    vi.spyOn(surveysApi, 'listSurveys').mockResolvedValue([item()])
    const remove = vi.spyOn(surveysApi, 'deleteSurvey').mockResolvedValue()
    renderRoute('/admin/surveys', { user: TEST_USERS.hr })

    await user.click(await screen.findByRole('button', { name: 'Delete Workplace pulse, Q4 2026' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Delete “Workplace pulse, Q4 2026”?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Keep survey' }))

    expect(remove).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('deletes after confirming', async () => {
    const user = userEvent.setup()
    const list = vi.spyOn(surveysApi, 'listSurveys').mockResolvedValue([item()])
    const remove = vi.spyOn(surveysApi, 'deleteSurvey').mockResolvedValue()
    renderRoute('/admin/surveys', { user: TEST_USERS.hr })

    await user.click(await screen.findByRole('button', { name: 'Delete Workplace pulse, Q4 2026' }))
    list.mockResolvedValue([])
    await user.click(await screen.findByRole('button', { name: 'Delete survey' }))

    expect(remove).toHaveBeenCalledWith(SURVEY_ID)
    expect(await screen.findByText('Deleted “Workplace pulse, Q4 2026”.')).toBeInTheDocument()
    expect(await screen.findByText('No surveys yet')).toBeInTheDocument()
  })

  it('closes a published survey after confirming', async () => {
    const user = userEvent.setup()
    vi.spyOn(surveysApi, 'listSurveys').mockResolvedValue([
      item({ status: 'published', version_no: 2, can_delete: false }),
    ])
    const close = vi
      .spyOn(surveysApi, 'closeSurvey')
      .mockResolvedValue({ status: 'closed', closed_at: '2026-11-03T09:00:00+00:00' })
    renderRoute('/admin/surveys', { user: TEST_USERS.hr })

    expect(await screen.findByText('Published v2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close Workplace pulse, Q4 2026' }))
    await user.click(await screen.findByRole('button', { name: 'Close survey' }))

    expect(close).toHaveBeenCalledWith(SURVEY_ID)
    expect(
      await screen.findByText(
        'Closed “Workplace pulse, Q4 2026”. No new responses will be accepted.',
      ),
    ).toBeInTheDocument()
  })

  it('shows a retry when the list fails to load', async () => {
    vi.spyOn(surveysApi, 'listSurveys').mockRejectedValue(new Error('offline'))

    renderRoute('/admin/surveys', { user: TEST_USERS.hr })

    expect(await screen.findByText("We couldn't load your surveys")).toBeInTheDocument()
  })
})
