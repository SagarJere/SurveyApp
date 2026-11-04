import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as healthApi from '@/features/health/api'
import * as surveysApi from '@/features/surveys/api'
import type { ThemeAsset } from '@/features/surveys/types'
import { ApiError } from '@/lib/api'
import { TEST_USERS } from '@/test/auth'
import { lastSavedDraft, mockBuilderApi, pulseDraft, SURVEY_ID } from '@/test/builder'
import { renderRoute } from '@/test/render'

const asset = (id: string, name: string, kind: ThemeAsset['kind'] = 'gallery'): ThemeAsset => ({
  id,
  kind,
  name,
  width: 2400,
  height: 1500,
  url: `/api/files/${id}?exp=1&sig=a`,
  mobile_url: `/api/files/${id}/mobile?exp=1&sig=a`,
})

const OCEAN = pulseDraft().theme.cover!
const GALLERY = [asset(OCEAN, 'Ocean'), asset('dawn-id', 'Dawn')]

beforeEach(() => {
  vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue({
    status: 'ok',
    database: 'ok',
    environment: 'test',
    version: '0.1.0',
  })
  vi.spyOn(surveysApi, 'listGallery').mockResolvedValue(GALLERY)
  vi.spyOn(surveysApi, 'listUploads').mockResolvedValue([])
})

async function openTheme() {
  const api = mockBuilderApi(pulseDraft())
  renderRoute(`/admin/surveys/${SURVEY_ID}/edit?tab=theme`, { user: TEST_USERS.hr })
  await screen.findByRole('heading', { name: 'Cover image' })
  return api
}

function file(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('Theme tab', () => {
  it('shows the gallery with the current cover selected', async () => {
    await openTheme()

    const ocean = await screen.findAllByRole('button', { name: 'Ocean', pressed: true })
    expect(ocean).toHaveLength(2) // selected as both cover and background
    expect(
      screen.getByRole('button', { name: 'Accent colour only', pressed: false }),
    ).toBeInTheDocument()
  })

  it('saves cover, background, darken and accent choices', async () => {
    const user = userEvent.setup()
    const { saveDraft } = await openTheme()

    await user.click(screen.getByRole('button', { name: 'Accent colour only' }))
    await user.click(screen.getByRole('button', { name: 'Colour' }))
    await user.click(screen.getByRole('button', { name: 'Pine background' }))
    await user.click(screen.getByRole('button', { name: 'Rose' }))

    await waitFor(() => {
      expect(lastSavedDraft(saveDraft).theme).toMatchObject({
        cover: null,
        background_style: 'color',
        background_color: '#13302C',
        accent: '#B42F5B',
      })
    })
    expect(screen.getByRole('button', { name: 'Rose' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('turns blur off and darkens images', async () => {
    const user = userEvent.setup()
    const { saveDraft } = await openTheme()

    await user.click(screen.getByRole('switch', { name: 'Soften background' }))
    // jsdom doesn't move range inputs with arrow keys, so set the value as the browser would.
    fireEvent.change(screen.getByRole('slider', { name: 'Darken images' }), {
      target: { value: '35' },
    })

    expect(screen.getByText('35%')).toBeInTheDocument()
    await waitFor(() => {
      expect(lastSavedDraft(saveDraft).theme).toMatchObject({ blur: false, overlay: 35 })
    })
  })

  it('rejects images over 2 MB before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await openTheme()
    const upload = vi.spyOn(surveysApi, 'uploadThemeAsset')

    const [coverInput] = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await user.upload(coverInput!, file('big.jpg', 'image/jpeg', 5 * 1024 * 1024))

    expect(await screen.findByText('That image is 5.0 MB. Use one under 2 MB.')).toBeInTheDocument()
    expect(upload).not.toHaveBeenCalled()
  })

  it('rejects other file types', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await openTheme()

    const [coverInput] = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await user.upload(coverInput!, file('doc.pdf', 'application/pdf', 1000))

    expect(await screen.findByText('Use a JPG, PNG or WebP image.')).toBeInTheDocument()
  })

  it('uploads an image and uses it as the cover', async () => {
    const user = userEvent.setup()
    const { saveDraft } = await openTheme()
    vi.spyOn(surveysApi, 'uploadThemeAsset').mockResolvedValue(
      asset('mine', 'Team photo', 'upload'),
    )

    const [coverInput] = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await user.upload(coverInput!, file('Team photo.jpg', 'image/jpeg', 1_500_000))

    expect(await screen.findAllByRole('button', { name: 'Team photo' })).not.toHaveLength(0)
    await waitFor(() => {
      expect(lastSavedDraft(saveDraft).theme.cover).toBe('mine')
    })
  })

  it('shows the server’s reason when an upload fails', async () => {
    const user = userEvent.setup()
    await openTheme()
    vi.spyOn(surveysApi, 'uploadThemeAsset').mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'That image looks damaged.',
      }),
    )

    const [coverInput] = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await user.upload(coverInput!, file('broken.jpg', 'image/jpeg', 1000))

    expect(await screen.findByText('That image looks damaged.')).toBeInTheDocument()
  })
})
