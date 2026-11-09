import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TEST_USERS } from '@/test/auth'
import { renderRoute } from '@/test/render'

import * as respondApi from './api'
import type { MySurvey } from './api'

function iso(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function survey(overrides: Partial<MySurvey>): MySurvey {
  return {
    id: 'a',
    title: 'Workplace pulse',
    description: '',
    status: 'pending',
    open: true,
    closes_at: iso(20),
    minutes: 2,
    progress: null,
    accent: '#0E7A6A',
    cover: null,
    submitted_at: null,
    ...overrides,
  }
}

function render(items: MySurvey[]) {
  vi.spyOn(respondApi, 'listMySurveys').mockResolvedValue(items)
  return renderRoute('/', { user: TEST_USERS.employee })
}

describe('My surveys', () => {
  it('groups surveys into To do, In progress and Completed', async () => {
    render([
      survey({ id: 'a', title: 'Pulse', closes_at: iso(3) }),
      survey({ id: 'b', title: 'Benefits', status: 'in_progress', progress: 0.5 }),
      survey({
        id: 'c',
        title: 'Onboarding',
        status: 'submitted',
        open: false,
        submitted_at: '2026-11-01T10:00:00Z',
      }),
    ])

    const todo = await screen.findByRole('region', { name: 'To do' })
    expect(within(todo).getByText('Closes in 3 days')).toHaveClass('text-warn')
    expect(within(todo).getByText('About 2 minutes')).toBeInTheDocument()
    expect(within(todo).getByRole('link', { name: 'Start: Pulse' })).toHaveAttribute('href', '/s/a')

    const progress = screen.getByRole('region', { name: 'In progress' })
    expect(
      within(progress).getByRole('progressbar', { name: 'Benefits progress' }),
    ).toHaveAttribute('aria-valuenow', '50')
    expect(within(progress).getByRole('link', { name: 'Continue: Benefits' })).toBeInTheDocument()

    const done = screen.getByRole('region', { name: 'Completed' })
    expect(within(done).getByText('Closed')).toBeInTheDocument()
    expect(within(done).queryByRole('link')).not.toBeInTheDocument()
  })

  it('says when you are all caught up', async () => {
    render([survey({ status: 'submitted', open: true })])

    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View: Workplace pulse' })).toBeInTheDocument()
  })

  it.each([
    [0, 'Closes today'],
    [1, 'Closes tomorrow'],
    [6, 'Closes in 6 days'],
  ])('shows closing in %i days as "%s"', async (days, text) => {
    render([survey({ closes_at: iso(days) })])

    expect(await screen.findByText(text)).toBeInTheDocument()
  })
})
