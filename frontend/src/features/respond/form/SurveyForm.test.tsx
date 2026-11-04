import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Draft, Layout } from '@/features/survey-logic/types'
import { pulseDraft } from '@/test/builder'

import { SurveyForm } from './SurveyForm'
import type { AssetResolver } from './theme-utils'

const noAssets: AssetResolver = () => null

function survey(layout: Layout, overrides: Partial<Draft['settings']> = {}): Draft {
  const draft = pulseDraft()
  draft.settings = { ...draft.settings, layout, ...overrides }
  return draft
}

function renderForm(draft: Draft, assets: AssetResolver = noAssets) {
  const onSubmit = vi.fn()
  const onReset = vi.fn()
  render(<SurveyForm survey={draft} assets={assets} onSubmit={onSubmit} onReset={onReset} />)
  return { onSubmit, onReset }
}

const progress = () => screen.getByRole('progressbar').nextElementSibling!.textContent
const choose = (user: UserEvent, name: string) => user.click(screen.getByRole('radio', { name }))
const next = () => screen.getByRole('button', { name: 'Next' })

describe('one question at a time', () => {
  it('counts only visible questions and updates as answers reveal more', async () => {
    const user = userEvent.setup()
    renderForm(survey('step'))

    // Q1, Q2, Q6, Q9 are visible before any answers.
    expect(progress()).toBe('Question 1 of 4')
    expect(screen.getByText('Answer this to continue')).toBeInTheDocument()
    expect(next()).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: '4' }))
    await user.click(next())
    await choose(user, 'Hybrid')

    // Hybrid reveals Q3 (days in office) and Q5 (money, "is not Office").
    expect(progress()).toBe('Question 2 of 6')
  })

  it('moves focus to the next question heading', async () => {
    const user = userEvent.setup()
    renderForm(survey('step'))

    await user.click(screen.getByRole('radio', { name: '5, Very satisfied' }))
    await user.click(next())

    expect(screen.getByRole('heading', { name: /Which work mode/ })).toHaveFocus()
  })

  it('locks the navigator after the first unanswered required question', async () => {
    const user = userEvent.setup()
    renderForm(survey('step'))
    const nav = () => within(screen.getByRole('navigation', { name: 'Questions' }))

    expect(nav().getByRole('button', { name: 'Question 1' })).toHaveAttribute(
      'aria-current',
      'step',
    )
    expect(nav().getByRole('button', { name: 'Question 2' })).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: '3' }))

    expect(nav().getByRole('button', { name: 'Question 1, answered' })).toBeInTheDocument()
    expect(nav().getByRole('button', { name: 'Question 2' })).toBeEnabled()
    expect(nav().getByRole('button', { name: 'Question 3' })).toBeDisabled()

    await user.click(nav().getByRole('button', { name: 'Question 2' }))
    expect(progress()).toBe('Question 2 of 4')
  })

  it('moves on automatically after a single-choice answer when enabled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })
      renderForm(survey('step', { auto_next: true }))

      await user.click(screen.getByRole('radio', { name: '4' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })

      expect(progress()).toBe('Question 2 of 4')
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides the navigator when the setting is off', () => {
    renderForm(survey('step', { show_navigator: false }))

    expect(screen.queryByRole('navigation', { name: 'Questions' })).not.toBeInTheDocument()
  })

  it('formats money while typing, shows words, and blocks out-of-range amounts', async () => {
    const user = userEvent.setup()
    renderForm(survey('step'))
    await user.click(screen.getByRole('radio', { name: '4' }))
    await user.click(next())
    await choose(user, 'Remote')
    await user.click(next()) // Q4 checkboxes (optional)
    await user.click(next()) // Q5 money

    const amount = screen.getByRole('textbox', { name: /home workspace/ })
    await user.type(amount, '600000')

    expect(amount).toHaveValue('6,00,000')
    expect(screen.getByText('Six lakh rupees only')).toBeInTheDocument()
    expect(screen.getByText('Enter ₹5,00,000 or less.')).toBeInTheDocument()
    expect(amount).toHaveAccessibleDescription(/Six lakh rupees only.*Enter ₹5,00,000 or less\./)
    expect(next()).toBeDisabled()

    await user.clear(amount)
    await user.type(amount, '125000')
    expect(screen.getByText('One lakh twenty-five thousand rupees only')).toBeInTheDocument()
    expect(next()).toBeEnabled()
  })

  it('supports arrow keys on the rating scale', async () => {
    const user = userEvent.setup()
    renderForm(survey('step'))

    screen.getByRole('radio', { name: '1, Very unsatisfied' }).focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')

    expect(screen.getByRole('radio', { name: '3' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '3' })).toHaveFocus()
  })
})

describe('one section per page', () => {
  it('skips hidden sections and checks required questions per page', async () => {
    const user = userEvent.setup()
    renderForm(survey('section'))

    expect(progress()).toBe('Section 1 of 2')
    expect(screen.getByText('3 required questions left on this page')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: '4' }))
    await choose(user, 'Office, full-time')
    await choose(user, 'Yes, I manage people')

    expect(progress()).toBe('Section 1 of 3') // the managers' section now counts
    expect(next()).toBeEnabled()
    await user.click(next())

    expect(progress()).toBe('Section 2 of 3')
    expect(screen.getByRole('heading', { level: 2, name: 'Leading your team' })).toHaveFocus()
    expect(screen.getByText('1 required question left on this page')).toBeInTheDocument()
  })
})

describe('all on one page', () => {
  it('discards answers that a changed answer hides', async () => {
    const user = userEvent.setup()
    renderForm(survey('all'))

    await choose(user, 'Hybrid')
    await choose(user, '3–4 days')
    await choose(user, 'Remote')
    expect(screen.queryByRole('radio', { name: '3–4 days' })).not.toBeInTheDocument()

    await choose(user, 'Hybrid')
    expect(screen.getByRole('radio', { name: '3–4 days' })).not.toBeChecked()
  })

  it('submits only visible answers and shows the thank-you screen', async () => {
    const user = userEvent.setup()
    const draft = survey('all')
    const { onSubmit, onReset } = renderForm(draft)
    const submit = screen.getByRole('button', { name: 'Submit response' })

    expect(screen.getByText('3 required questions left')).toBeInTheDocument()
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: '4' }))
    await choose(user, 'Office, full-time')
    await choose(user, 'No')
    expect(screen.getByText('All set')).toBeInTheDocument()
    await user.click(submit)

    const [q1, q2, , , , q6] = draft.questions
    expect(onSubmit).toHaveBeenCalledWith({
      [q1!.key]: 4,
      [q2!.key]: q2!.options[0]!.key,
      [q6!.key]: q6!.options[1]!.key,
    })
    expect(await screen.findByRole('heading', { name: 'Response recorded' })).toHaveFocus()
    expect(
      screen.getByText(
        "This survey allows one response per employee, so the form won't open again for you.",
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset preview' }))
    expect(onReset).toHaveBeenCalled()
  })

  it('offers editing until the closing date when allowed', async () => {
    const user = userEvent.setup()
    const draft = survey('all', { allow_edit: true })
    draft.questions = draft.questions.map((q) => ({ ...q, required: false }))
    renderForm(draft)

    await user.click(screen.getByRole('button', { name: 'Submit response' }))

    expect(await screen.findByText(/You can change your answers until/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    expect(screen.getByRole('button', { name: 'Submit response' })).toBeInTheDocument()
  })
})

describe('theme', () => {
  it('uses the cover image with a mobile copy and the accent colour', () => {
    const assets: AssetResolver = (id) =>
      id
        ? {
            url: '/api/files/a?exp=1&sig=x',
            mobile_url: '/api/files/a/mobile?exp=1&sig=x',
            width: 2400,
          }
        : null
    const draft = survey('all')
    draft.theme.accent = '#B42F5B'

    const { container } = render(<SurveyForm survey={draft} assets={assets} onSubmit={vi.fn()} />)

    const images = container.querySelectorAll('img')
    expect(images.length).toBeGreaterThanOrEqual(2) // background stage and cover
    expect(images[0]!.getAttribute('srcset')).toContain('/mobile?exp=1&sig=x 800w')
    expect(images[0]).toHaveAttribute('alt', '')
    expect(
      (container.firstElementChild as HTMLElement).style.getPropertyValue('--survey-accent'),
    ).toBe('#B42F5B')
  })

  it('falls back to the accent colour when the cover is missing', () => {
    const draft = survey('all')

    const { container } = render(<SurveyForm survey={draft} assets={noAssets} onSubmit={vi.fn()} />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).closest('header')).toHaveStyle({
      backgroundColor: '#0E7A6A',
    })
  })
})

describe('empty survey', () => {
  it('says there are no questions', async () => {
    const draft = survey('all')
    draft.questions = []
    renderForm(draft)

    await waitFor(() => {
      expect(screen.getByText('This survey has no questions yet.')).toBeInTheDocument()
    })
  })
})
