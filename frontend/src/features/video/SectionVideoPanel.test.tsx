import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as surveysApi from '@/features/surveys/api'
import type { VideoAsset } from '@/features/surveys/types'
import { ApiError } from '@/lib/api'
import { TEST_USERS } from '@/test/auth'
import { lastSavedDraft, mockBuilderApi, pulseDraft, SURVEY_ID } from '@/test/builder'
import { renderRoute } from '@/test/render'

import * as reading from './read-duration'

const UPLOADED: VideoAsset = {
  id: 'video-1',
  file_name: 'fire-safety-part-1.mp4',
  content_type: 'video/mp4',
  size_bytes: 142 * 1024 * 1024,
  duration_seconds: 512,
  url: '/api/files/videos/video-1?exp=1&sig=x',
  published: false,
}

async function openTraining() {
  const draft = pulseDraft()
  const api = mockBuilderApi(draft, { kind: 'training' })
  vi.spyOn(surveysApi, 'listVideos').mockResolvedValue([])
  renderRoute(`/admin/surveys/${SURVEY_ID}/edit`, { user: TEST_USERS.hr })
  await screen.findByLabelText('Survey title')
  return { ...api, draft }
}

beforeEach(() => {
  vi.spyOn(reading, 'checkVideo').mockResolvedValue({ ok: true, duration: 250 })
})

describe('video sections in the builder', () => {
  it('shows a Training badge and goes back to Trainings', async () => {
    await openTraining()
    expect(screen.getByText('Training')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Trainings' })).toHaveAttribute(
      'href',
      '/admin/trainings',
    )
  })

  it('uploads a video with its length and size, and saves it on the section', async () => {
    const user = userEvent.setup()
    const { saveDraft, draft } = await openTraining()
    const upload = vi
      .spyOn(surveysApi, 'uploadVideo')
      .mockImplementation((_id, _file, _d, progress) => {
        progress?.(1)
        return Promise.resolve(UPLOADED)
      })

    await user.click(screen.getByRole('button', { name: 'Add a video to Your work setup' }))
    const panel = screen.getByRole('group', { name: 'Video for Your work setup' })
    const file = new File(['fake video'], 'fire-safety-part-1.mp4', { type: 'video/mp4' })
    const input = panel.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await user.upload(input!, file)

    expect(await within(panel).findByText('fire-safety-part-1.mp4')).toBeInTheDocument()
    expect(within(panel).getByText('142 MB · 8 min 32 s · MP4')).toBeInTheDocument()
    expect(upload).toHaveBeenCalledWith(SURVEY_ID, file, 250, expect.any(Function))
    expect(
      within(panel).getByText('The questions in this section appear after the video ends.'),
    ).toBeInTheDocument()

    await user.click(within(panel).getByRole('switch', { name: 'Allow skipping ahead' }))
    await waitFor(
      () => {
        const saved = lastSavedDraft(saveDraft).sections.find(
          (s) => s.key === draft.sections[0]!.key,
        )
        expect(saved?.video).toEqual({
          source: 'upload',
          asset_id: 'video-1',
          url: null,
          allow_seek: true,
          allow_speed: false,
        })
      },
      { timeout: 3000 },
    )
  })

  it('shows why an upload was refused', async () => {
    const user = userEvent.setup()
    await openTraining()
    vi.spyOn(surveysApi, 'uploadVideo').mockRejectedValue(
      new ApiError({
        status: 413,
        code: 'HTTP_ERROR',
        message: 'That video is 250 MB. Use one up to 200 MB.',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Add a video to Your work setup' }))
    const panel = screen.getByRole('group', { name: 'Video for Your work setup' })
    await user.upload(
      panel.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['x'], 'big.mp4', { type: 'video/mp4' }),
    )
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'That video is 250 MB. Use one up to 200 MB.',
    )
  })

  it('checks an internal link and says how long the video is', async () => {
    const user = userEvent.setup()
    await openTraining()
    await user.click(screen.getByRole('button', { name: 'Add a video to Your work setup' }))
    const panel = screen.getByRole('group', { name: 'Video for Your work setup' })
    await user.click(within(panel).getByRole('button', { name: 'Internal link' }))
    const field = within(panel).getByLabelText('Video address on your internal server')

    await user.type(field, 'videos/fire.mp4')
    expect(
      within(panel).getByText('The address must start with http:// or https://'),
    ).toBeInTheDocument()

    await user.clear(field)
    await user.type(field, 'https://videos.intranet/fire.mp4')
    expect(
      await within(panel).findByText(
        'Found it: 4 min 10 s. Plays for people on the office network or VPN.',
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument()
    expect(reading.checkVideo).toHaveBeenLastCalledWith('https://videos.intranet/fire.mp4')
  })

  it('warns when the link cannot be loaded from here', async () => {
    const user = userEvent.setup()
    vi.spyOn(reading, 'checkVideo').mockResolvedValue({ ok: false })
    await openTraining()
    await user.click(screen.getByRole('button', { name: 'Add a video to Your work setup' }))
    const panel = screen.getByRole('group', { name: 'Video for Your work setup' })
    await user.click(within(panel).getByRole('button', { name: 'Internal link' }))
    await user.type(
      within(panel).getByLabelText('Video address on your internal server'),
      'https://videos.intranet/missing.mp4',
    )
    expect(
      await within(panel).findByText(/Couldn't load this video from here/, {}, { timeout: 3000 }),
    ).toBeInTheDocument()
  })

  it('hides the anonymous and editing settings for trainings', async () => {
    const user = userEvent.setup()
    await openTraining()
    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(screen.queryByRole('switch', { name: /Anonymous responses/ })).toBeNull()
    expect(screen.queryByRole('switch', { name: /Allow editing/ })).toBeNull()
    expect(screen.getByText(/Trainings are never anonymous/)).toBeInTheDocument()
  })
})
