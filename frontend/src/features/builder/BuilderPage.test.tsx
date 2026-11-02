import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as healthApi from '@/features/health/api'
import type { Condition, Draft } from '@/features/survey-logic/types'
import { ApiError } from '@/lib/api'
import { TEST_USERS } from '@/test/auth'
import { lastSavedDraft, mockBuilderApi, pulseDraft, surveyDetail, SURVEY_ID } from '@/test/builder'
import { renderRoute } from '@/test/render'

import { newSection } from './draft-ops'

const PATH = `/admin/surveys/${SURVEY_ID}/edit`

beforeEach(() => {
  vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue({
    status: 'ok',
    database: 'ok',
    environment: 'test',
    version: '0.1.0',
  })
})

function emptyDraft(): Draft {
  return { ...pulseDraft(), title: '', description: '', sections: [newSection()], questions: [] }
}

async function openBuilder(draft: Draft) {
  const api = mockBuilderApi(draft)
  const view = renderRoute(PATH, { user: TEST_USERS.hr })
  await screen.findByLabelText('Survey title')
  return { ...api, ...view }
}

/** Replace a field's text the way a person would (select all, then type/paste). */
async function fill(user: UserEvent, element: HTMLElement, text: string) {
  await user.clear(element)
  if (text) {
    await user.click(element)
    await user.paste(text)
  }
}

const head = (key: string) => document.querySelector<HTMLElement>(`[data-question-head="${key}"]`)!
const card = (key: string) => document.getElementById(`card-${key}`)!

/** A draft reduced to what a person sees: no keys, conditions by question number and label. */
function shape(draft: Draft) {
  const number = (key: string) => draft.questions.findIndex((q) => q.key === key) + 1
  const sectionIndex = (key: string) => draft.sections.findIndex((s) => s.key === key)
  const condition = (c: Condition | null) => {
    if (!c) return null
    const source = draft.questions.find((q) => q.key === c.src)
    const val = source?.options.find((o) => o.key === c.val)?.label ?? c.val
    return { src: `Q${number(c.src)}`, op: c.op, val }
  }
  return {
    title: draft.title,
    description: draft.description,
    sections: draft.sections.map((s) => ({
      title: s.title,
      description: s.description,
      condition: condition(s.condition),
    })),
    questions: draft.questions.map((q) => ({
      section: sectionIndex(q.section_key),
      type: q.type,
      text: q.text,
      help: q.help,
      required: q.required,
      options: q.options.map((o) => o.label),
      config: q.type === 'money' ? q.config : {},
      condition: condition(q.condition),
    })),
  }
}

describe('building the Workplace pulse sample (Phase 2 done-when)', () => {
  it('builds all 3 sections, 9 questions and 4 conditions through the UI', async () => {
    const user = userEvent.setup()
    const { saveDraft } = await openBuilder(emptyDraft())

    await fill(user, screen.getByLabelText('Survey title'), 'Workplace pulse, Q4 2026')
    await fill(
      user,
      screen.getByLabelText('Description'),
      'Five quick questions about how and where you work. Takes about two minutes.',
    )

    const addQuestion = async (type: string, inSection?: string) => {
      const scope = inSection ? within(screen.getByRole('region', { name: inSection })) : screen
      await user.click(scope.getByRole('button', { name: 'Add question' }))
      await user.click(screen.getByRole('button', { name: type }))
    }
    const questionFields = async (n: number, text: string, help = '') => {
      const textField = screen.getByLabelText(`Question ${n} text`)
      // A new question opens with focus in its text field (moved on the next frame).
      await waitFor(() => {
        expect(textField).toHaveFocus()
      })
      await user.paste(text)
      if (help) await fill(user, screen.getByLabelText(`Question ${n} help text`), help)
    }
    const required = () => user.click(screen.getByRole('switch', { name: 'Required' }))
    const options = async (labels: string[]) => {
      for (const [i, label] of labels.entries()) {
        if (i >= 2) await user.click(screen.getByRole('button', { name: 'Add option' }))
        await fill(user, screen.getByLabelText(`Option ${i + 1}`), label)
      }
    }
    const condition = async (
      scope: HTMLElement,
      choices: { src?: RegExp; op?: string; val?: string },
    ) => {
      const panel = within(scope)
      if (choices.src) {
        const select = panel.getByLabelText('Depends on question')
        const option = within(select).getByRole('option', { name: choices.src })
        await user.selectOptions(select, option)
      }
      if (choices.op) await user.selectOptions(panel.getByLabelText('Comparison'), choices.op)
      if (choices.val) {
        const select = panel.getByLabelText('Answer')
        await user.selectOptions(select, within(select).getByRole('option', { name: choices.val }))
      }
    }
    const openCard = () => screen.getByRole('button', { expanded: true }).closest('li')!

    // Section 1
    await addQuestion('Rating 1–5')
    await questionFields(
      1,
      'How satisfied are you with your current work setup?',
      '1 is very unsatisfied, 5 is very satisfied.',
    )
    await required()

    await addQuestion('Single choice')
    await questionFields(2, 'Which work mode do you follow most weeks?')
    await options(['Office, full-time', 'Hybrid', 'Remote'])
    await required()

    await addQuestion('Single choice')
    await questionFields(3, 'How many days a week are you in the office?')
    await options(['1–2 days', '3–4 days'])
    await required()
    await user.click(screen.getByRole('button', { name: 'Add condition' }))
    await condition(openCard(), { val: 'Hybrid' })

    await addQuestion('Checkboxes')
    await questionFields(4, 'What would make remote work easier for you?', 'Pick all that apply.')
    await options(['Better laptop', 'Second monitor', 'Faster VPN', 'Ergonomic chair'])
    await user.click(screen.getByRole('button', { name: 'Add condition' }))
    await condition(openCard(), { src: /^Q2:/, val: 'Remote' })

    await addQuestion('Money')
    await questionFields(
      5,
      'Roughly how much have you spent setting up your home workspace this year?',
      'An estimate is fine.',
    )
    await fill(user, screen.getByLabelText('Maximum'), '500000')
    expect(screen.getByLabelText('Maximum')).toHaveValue('5,00,000')
    await user.click(screen.getByRole('button', { name: 'Add condition' }))
    await condition(openCard(), { src: /^Q2:/, op: 'not', val: 'Office, full-time' })

    await addQuestion('Single choice')
    await questionFields(6, 'Do you manage a team?')
    await options(['Yes, I manage people', 'No'])
    await required()

    // Section 2, shown only to managers
    await user.click(screen.getByRole('button', { name: 'Add section' }))
    expect(screen.getByLabelText('Section 1 title')).toHaveValue('Section 1')
    await fill(user, screen.getByLabelText('Section 1 title'), 'Your work setup')
    await fill(
      user,
      screen.getByLabelText('Section 1 description'),
      'How and where you work most weeks.',
    )
    await fill(user, screen.getByLabelText('Section 2 title'), 'Leading your team')
    await fill(user, screen.getByLabelText('Section 2 description'), 'Only for people managers.')
    const section2 = screen.getByRole('region', { name: 'Leading your team' })
    await user.click(within(section2).getByRole('button', { name: 'Show this section only when…' }))
    expect(within(section2).getByLabelText('Answer')).toHaveDisplayValue('Yes, I manage people')

    await addQuestion('Rating 1–5', 'Leading your team')
    await questionFields(7, 'How satisfied are you with the support you can give your team?')
    await required()
    await addQuestion('Checkboxes', 'Leading your team')
    await questionFields(8, 'What would help you lead your team better?', 'Pick all that apply.')
    await options([
      'More in-office days together',
      'Better collaboration tools',
      'Manager training',
    ])

    // Section 3
    await user.click(screen.getByRole('button', { name: 'Add section' }))
    await fill(user, screen.getByLabelText('Section 3 title'), 'Final thoughts')
    await addQuestion('Paragraph', 'Final thoughts')
    await questionFields(9, 'Anything else you’d like HR to know?')

    // The conditional cards are tagged.
    expect(screen.getAllByText('Shown when Q6 is “Yes, I manage people”')).toHaveLength(1)

    expect(await screen.findByText('All changes saved', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(shape(lastSavedDraft(saveDraft))).toEqual(shape(pulseDraft()))
  }, 60_000)
})

describe('builder with the sample loaded', () => {
  it('shows sections, numbering and condition tags', async () => {
    const draft = pulseDraft()
    await openBuilder(draft)

    expect(screen.getByText('Section 1 of 3')).toBeInTheDocument()
    expect(screen.getByLabelText('Section 2 title')).toHaveValue('Leading your team')
    expect(screen.getByText('Shown when Q2 is “Hybrid”')).toBeInTheDocument()
    expect(screen.getByText('Shown when Q2 is “Remote”')).toBeInTheDocument()
    expect(screen.getByText('Shown when Q2 is not “Office, full-time”')).toBeInTheDocument()
    expect(head(draft.questions[8]!.key)).toHaveTextContent('Q9')
    expect(document.title).toBe('Edit: Workplace pulse, Q4 2026 · Pulse')
  })

  it('moving Q2 below Q3 shows the broken-condition message', async () => {
    const user = userEvent.setup()
    const draft = pulseDraft()
    const [q2, q3] = [draft.questions[1]!.key, draft.questions[2]!.key]
    await openBuilder(draft)

    await user.click(head(q2))
    await user.click(screen.getByRole('button', { name: 'Move Q2 down' }))

    expect(head(q3)).toHaveTextContent('Q2')
    expect(within(card(q3)).getByText('Condition needs attention')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Move Q3 down' })).toHaveFocus()
    })

    await user.click(head(q3))
    expect(
      within(card(q3)).getByText(
        'Q3 now comes after this question. Move it back up or change the condition.',
      ),
    ).toBeInTheDocument()
  })

  it('"Check for issues" saves, validates and opens the first problem', async () => {
    const user = userEvent.setup()
    const draft = pulseDraft()
    const q3 = draft.questions[2]!.key
    const { validateSurvey, saveDraft } = await openBuilder(draft)
    await user.type(screen.getByLabelText('Survey title'), '!')
    validateSurvey.mockResolvedValue({
      issues: [
        {
          code: 'condition_broken',
          message: 'Q3 has a condition that needs attention.',
          question_key: q3,
          section_key: null,
          problem: 'source_after',
        },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Check for issues' }))

    expect(
      await screen.findByText(
        'Fix 1 issue before publishing. Q3 has a condition that needs attention.',
      ),
    ).toBeInTheDocument()
    expect(saveDraft).toHaveBeenCalled() // pending edits were saved first
    expect(head(q3)).toHaveAttribute('aria-expanded', 'true')
  })

  it('reports a clean survey', async () => {
    const user = userEvent.setup()
    await openBuilder(pulseDraft())

    await user.click(screen.getByRole('button', { name: 'Check for issues' }))

    expect(
      await screen.findByText('No issues found. This survey is ready to publish.'),
    ).toBeInTheDocument()
  })

  it('deletes a question with Undo', async () => {
    const user = userEvent.setup()
    const draft = pulseDraft()
    const q2 = draft.questions[1]!.key
    await openBuilder(draft)

    await user.click(head(q2))
    await user.click(screen.getByRole('button', { name: 'Delete Q2' }))

    expect(await screen.findByText('Deleted Q2. It was used in 3 conditions.')).toBeInTheDocument()
    expect(card(q2)).toBeNull()
    expect(screen.getAllByText('Condition needs attention')).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(head(q2)).toHaveTextContent('Q2')
    expect(screen.queryByText('Condition needs attention')).not.toBeInTheDocument()
  })

  it('duplicates a question below it', async () => {
    const user = userEvent.setup()
    const draft = pulseDraft()
    await openBuilder(draft)

    await user.click(head(draft.questions[0]!.key))
    await user.click(screen.getByRole('button', { name: 'Duplicate Q1' }))

    expect(screen.getByLabelText('Question 2 text')).toHaveValue(
      'How satisfied are you with your current work setup? (copy)',
    )
    await waitFor(() => {
      expect(screen.getByLabelText('Question 2 text')).toHaveFocus()
    })
  })

  it('deletes a section with Undo; its questions move up', async () => {
    const user = userEvent.setup()
    await openBuilder(pulseDraft())

    await user.click(screen.getByRole('button', { name: 'Delete Leading your team' }))

    expect(
      await screen.findByText(
        'Deleted “Leading your team”. Its 2 questions moved to “Your work setup”.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Section 2 of 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(screen.getByText('Section 2 of 3')).toBeInTheDocument()
    expect(screen.getByLabelText('Section 2 title')).toHaveValue('Leading your team')
  })

  it('collapses a section', async () => {
    const user = userEvent.setup()
    await openBuilder(pulseDraft())

    await user.click(screen.getByRole('button', { name: 'Collapse Leading your team' }))

    expect(screen.getByText('2 questions hidden. Expand to edit.')).toBeInTheDocument()
    expect(
      screen.queryByText('How satisfied are you with the support you can give your team?'),
    ).toBeNull()
  })

  it('explains when no earlier question can be a condition source', async () => {
    const user = userEvent.setup()
    const draft = pulseDraft()
    await openBuilder(draft)

    await user.click(head(draft.questions[0]!.key))
    await user.click(screen.getByRole('button', { name: 'Add condition' }))

    expect(
      screen.getByText(
        'Add a choice or rating question above this one. Then you can show this question based on its answer.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the money example in the chosen currency', async () => {
    const user = userEvent.setup()
    const draft = pulseDraft()
    await openBuilder(draft)

    await user.click(head(draft.questions[4]!.key))
    expect(
      screen.getByText('Example: One lakh twenty-five thousand rupees only'),
    ).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Currency'), 'USD')

    expect(
      screen.getByText('Example: One hundred twenty-five thousand dollars'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Maximum')).toHaveValue('500,000')
    expect(screen.getByRole('switch', { name: 'Allow cents' })).not.toBeChecked()
  })
})

describe('saving', () => {
  it('autosaves after a pause with the last-read timestamp', async () => {
    const user = userEvent.setup()
    const { saveDraft } = await openBuilder(pulseDraft())

    await user.type(screen.getByLabelText('Survey title'), ' (draft)')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    await waitFor(() => {
      expect(saveDraft).toHaveBeenCalledTimes(1)
    })
    expect(saveDraft.mock.calls[0]![0]).toBe(SURVEY_ID)
    expect(saveDraft.mock.calls[0]![1].title).toBe('Workplace pulse, Q4 2026 (draft)')
    expect(saveDraft.mock.calls[0]![2]).toBe('2026-11-02T10:00:00.000000+00:00')
    expect(await screen.findByText('All changes saved')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Survey title'), '!')
    await waitFor(() => {
      expect(saveDraft).toHaveBeenCalledTimes(2)
    })
    expect(saveDraft.mock.calls[1]![2]).toBe('2026-11-02T10:00:01+00:00') // uses the new timestamp
  })

  it('shows the conflict banner and reloads the other tab’s version', async () => {
    const user = userEvent.setup()
    const { saveDraft, getSurvey } = await openBuilder(pulseDraft())
    saveDraft.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'DRAFT_CONFLICT',
        message: 'Someone else edited this survey.',
      }),
    )

    await user.type(screen.getByLabelText('Survey title'), ' from tab B')

    expect(
      await screen.findByText(/Someone else edited this survey\. Reload to see their changes\./),
    ).toBeInTheDocument()
    expect(screen.getByText('Not saved')).toBeInTheDocument()

    const fresh = { ...pulseDraft(), title: 'From tab A' }
    getSurvey.mockResolvedValue(
      surveyDetail(fresh, { draft_updated_at: '2026-11-02T11:00:00+00:00' }),
    )
    await user.click(screen.getByRole('button', { name: 'Reload' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Survey title')).toHaveValue('From tab A')
    })
    expect(screen.queryByText(/Someone else edited this survey/)).not.toBeInTheDocument()
  })

  it('retries after a network failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })
      const { saveDraft } = await openBuilder(pulseDraft())
      saveDraft.mockRejectedValueOnce(
        new ApiError({ status: null, code: 'NETWORK_ERROR', message: 'x' }),
      )

      await user.type(screen.getByLabelText('Survey title'), '?')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900)
      })
      expect(await screen.findByText("Couldn't save. Retrying…")).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100)
      })
      expect(await screen.findByText('All changes saved')).toBeInTheDocument()
      expect(saveDraft).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('access', () => {
  it('shows not-found for unknown surveys', async () => {
    const surveysApi = await import('@/features/surveys/api')
    vi.spyOn(surveysApi, 'getSurvey').mockRejectedValue(
      new ApiError({ status: 404, code: 'NOT_FOUND', message: 'x' }),
    )

    renderRoute(PATH, { user: TEST_USERS.hr })

    expect(await screen.findByText("We couldn't find that survey")).toBeInTheDocument()
  })

  it('blocks viewers from editing', async () => {
    mockBuilderApi(pulseDraft(), { can_edit: false, my_role: 'viewer' })

    renderRoute(PATH, { user: TEST_USERS.hr })

    expect(
      await screen.findByRole('heading', { name: "You don't have access to this page" }),
    ).toBeInTheDocument()
  })

  it('blocks employees before loading anything', async () => {
    const { getSurvey } = mockBuilderApi(pulseDraft())

    renderRoute(PATH, { user: TEST_USERS.employee })

    expect(
      await screen.findByRole('heading', { name: "You don't have access to this page" }),
    ).toBeInTheDocument()
    expect(getSurvey).not.toHaveBeenCalled()
  })
})
