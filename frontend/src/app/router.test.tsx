import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as healthApi from '@/features/health/api'
import { renderRoute } from '@/test/render'

beforeEach(() => {
  vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue({
    status: 'ok',
    database: 'ok',
    environment: 'test',
    version: '0.1.0',
  })
})

describe('routes', () => {
  it('renders My surveys at / inside the app shell', async () => {
    renderRoute('/')

    expect(await screen.findByRole('heading', { level: 1, name: 'My surveys' })).toBeInTheDocument()
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My surveys' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(document.title).toBe('My surveys · Pulse')
  })

  it('renders the surveys home for /admin/surveys', async () => {
    renderRoute('/admin/surveys')

    expect(await screen.findByRole('heading', { level: 1, name: 'Surveys' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Surveys' })).toHaveAttribute('aria-current', 'page')
  })

  it.each(['/admin/surveys/abc/edit', '/admin/surveys/abc/results'])(
    'shows survey-not-found for %s',
    async (path) => {
      renderRoute(path)

      expect(await screen.findByText("We couldn't find that survey")).toBeInTheDocument()
    },
  )

  it('lazy-loads the respondent route without the main navigation', async () => {
    renderRoute('/s/some-survey')

    expect(await screen.findByText("This survey isn't available to you.")).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('shows a not-found page for unknown paths', async () => {
    renderRoute('/nowhere')

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('navigates between sections with the main nav', async () => {
    const { router } = renderRoute('/')

    await userEvent.click(await screen.findByRole('link', { name: 'Surveys' }))

    expect(router.state.location.pathname).toBe('/admin/surveys')
    expect(await screen.findByRole('heading', { level: 1, name: 'Surveys' })).toBeInTheDocument()
  })

  it('offers a skip link to the main content as the first focus stop', async () => {
    renderRoute('/')
    await screen.findByRole('heading', { level: 1, name: 'My surveys' })

    await userEvent.tab()

    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
  })
})
