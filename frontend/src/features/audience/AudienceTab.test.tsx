import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import { TEST_USERS } from '@/test/auth'
import { mockBuilderApi, pulseDraft, SURVEY_ID } from '@/test/builder'
import { renderRoute } from '@/test/render'

import * as audienceApi from './api'
import type { AudienceList, UploadPreview } from './api'

function list(overrides: Partial<AudienceList> = {}): AudienceList {
  return {
    open_to_all: false,
    total: 3,
    matching: 3,
    page: 1,
    page_size: 50,
    items: [
      {
        employee_id: 'E2001',
        name: 'Priya Nair',
        email: null,
        department: 'Engineering',
        location: 'Pune',
        added_at: '',
        responded: false,
      },
      {
        employee_id: 'E2002',
        name: 'Rahul Sharma',
        email: null,
        department: 'Engineering',
        location: null,
        added_at: '',
        responded: true,
      },
      {
        employee_id: 'E2003',
        name: null,
        email: null,
        department: 'Sales',
        location: null,
        added_at: '',
        responded: false,
      },
    ],
    departments: [
      { department: 'Engineering', count: 2 },
      { department: 'Sales', count: 1 },
    ],
    can_replace: true,
    ...overrides,
  }
}

const PREVIEW: UploadPreview = {
  upload_id: 'up-1',
  file_name: 'audience_q4.xlsx',
  mode: 'append',
  status: 'preview',
  valid_count: 480,
  duplicate_count: 6,
  error_count: 3,
  errors: [
    { row: 14, employee_id: 'E 10', problem: "Employee ID can't contain spaces" },
    { row: 87, employee_id: '', problem: 'Employee ID is missing' },
    { row: 212, employee_id: 'E20311', problem: "Email address isn't valid" },
  ],
  errors_truncated: false,
}

async function openTab(data: AudienceList = list(), anonymous = false) {
  const draft = pulseDraft()
  draft.settings.anonymous = anonymous
  mockBuilderApi(draft)
  const listAudience = vi.spyOn(audienceApi, 'listAudience').mockResolvedValue(data)
  renderRoute(`/admin/surveys/${SURVEY_ID}/edit?tab=audience`, { user: TEST_USERS.hr })
  await screen.findByRole('heading', { name: 'Who can respond' })
  return { listAudience }
}

const xlsx = (name = 'audience_q4.xlsx') => new File(['x'], name)

describe('Audience tab', () => {
  it('lists people with departments and who has responded', async () => {
    await openTab()

    expect(await screen.findByText('Priya Nair')).toBeInTheDocument()
    expect(screen.getByText('3 people can respond.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Engineering · 2' })).toBeInTheDocument()
    expect(screen.getByText('Responded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Priya Nair' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Rahul Sharma' })).not.toBeInTheDocument()
  })

  it('previews an upload with counts and rows to fix, then applies it', async () => {
    const user = userEvent.setup()
    await openTab()
    const upload = vi.spyOn(audienceApi, 'uploadAudience').mockResolvedValue(PREVIEW)
    const apply = vi.spyOn(audienceApi, 'applyUpload').mockResolvedValue({ audience_count: 483 })

    await user.upload(screen.getByLabelText('Choose an audience file'), xlsx())

    expect(upload).toHaveBeenCalledWith(SURVEY_ID, expect.any(File), 'append')
    expect(await screen.findByText('Employees added')).toBeInTheDocument()
    expect(screen.getByText('480')).toBeInTheDocument()
    expect(screen.getByText('Duplicates skipped').previousSibling).toHaveTextContent('6')
    const table = screen.getByRole('table', { name: 'Rows to fix' })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('Empty')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(apply).toHaveBeenCalledWith(SURVEY_ID, 'up-1')
    expect(await screen.findByText('Audience updated. 483 people can respond.')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Rows to fix' })).not.toBeInTheDocument()
  })

  it('downloads the rows to fix and the template', async () => {
    const user = userEvent.setup()
    await openTab()
    vi.spyOn(audienceApi, 'uploadAudience').mockResolvedValue(PREVIEW)
    const rows = vi.spyOn(audienceApi, 'downloadRowsToFix').mockResolvedValue()
    const template = vi.spyOn(audienceApi, 'downloadTemplate').mockResolvedValue()

    await user.click(screen.getByRole('button', { name: 'Download template' }))
    await user.upload(screen.getByLabelText('Choose an audience file'), xlsx())
    await user.click(await screen.findByRole('button', { name: 'Download rows to fix' }))

    expect(template).toHaveBeenCalledWith(SURVEY_ID)
    expect(rows).toHaveBeenCalledWith(SURVEY_ID, 'up-1')
  })

  it('discards a preview', async () => {
    const user = userEvent.setup()
    await openTab()
    vi.spyOn(audienceApi, 'uploadAudience').mockResolvedValue(PREVIEW)
    const discard = vi.spyOn(audienceApi, 'discardUpload').mockResolvedValue()

    await user.upload(screen.getByLabelText('Choose an audience file'), xlsx())
    await user.click(await screen.findByRole('button', { name: 'Discard' }))

    expect(discard).toHaveBeenCalledWith(SURVEY_ID, 'up-1')
    await waitFor(() => {
      expect(screen.queryByText('Employees added')).not.toBeInTheDocument()
    })
  })

  it('explains files it cannot use', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await openTab()
    vi.spyOn(audienceApi, 'uploadAudience').mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'The file needs an EmployeeId column. Download the template to see the layout.',
      }),
    )

    await user.upload(screen.getByLabelText('Choose an audience file'), new File(['x'], 'list.pdf'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Upload an Excel (.xlsx) or CSV (.csv) file.',
    )

    await user.upload(screen.getByLabelText('Choose an audience file'), xlsx('people.csv'))
    expect(await screen.findByText(/needs an EmployeeId column/)).toBeInTheDocument()
  })

  it('uses replace mode only before publishing', async () => {
    const user = userEvent.setup()
    await openTab(list({ can_replace: false }))
    await screen.findByText('Priya Nair')

    expect(screen.getByRole('button', { name: 'Replace the list' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Add to the list' }))
    expect(screen.getByRole('button', { name: 'Add to the list' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('opens the survey to everyone', async () => {
    const user = userEvent.setup()
    const { listAudience } = await openTab()
    const setOpen = vi.spyOn(audienceApi, 'setOpenToAll').mockResolvedValue()
    listAudience.mockResolvedValue(list({ open_to_all: true }))

    await user.click(screen.getByRole('switch', { name: 'Open to all employees' }))

    expect(setOpen).toHaveBeenCalledWith(SURVEY_ID, true)
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Employee list' })).not.toBeInTheDocument()
    })
  })

  it('filters by department and searches', async () => {
    const user = userEvent.setup()
    const { listAudience } = await openTab()

    await user.click(await screen.findByRole('button', { name: 'Sales · 1' }))
    await waitFor(() => {
      expect(listAudience).toHaveBeenLastCalledWith(
        SURVEY_ID,
        { search: '', department: 'Sales', page: 1 },
        expect.anything(),
      )
    })
    await user.type(screen.getByRole('searchbox', { name: 'Search the audience' }), 'pri')
    await waitFor(() => {
      expect(listAudience).toHaveBeenLastCalledWith(
        SURVEY_ID,
        { search: 'pri', department: 'Sales', page: 1 },
        expect.anything(),
      )
    })
  })

  it('removes someone who has not responded', async () => {
    const user = userEvent.setup()
    await openTab()
    const remove = vi.spyOn(audienceApi, 'removeMember').mockResolvedValue()

    await user.click(await screen.findByRole('button', { name: 'Remove Priya Nair' }))

    expect(remove).toHaveBeenCalledWith(SURVEY_ID, 'E2001')
    expect(await screen.findByText('Removed E2001 from the audience.')).toBeInTheDocument()
  })

  it('warns about small anonymous audiences', async () => {
    await openTab(list(), true)

    expect(await screen.findByRole('note')).toHaveTextContent('Only 3 people are in the audience.')
  })
})
