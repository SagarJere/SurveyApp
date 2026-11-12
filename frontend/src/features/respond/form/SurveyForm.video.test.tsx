import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Draft, Layout } from '@/features/survey-logic/types'
import { fakeMedia } from '@/test/media'

import { SurveyForm, type FormVideo } from './SurveyForm'

function training(layout: Layout): Draft {
  return {
    title: 'Fire safety basics',
    description: '',
    settings: {
      layout,
      show_navigator: false,
      auto_next: false,
      one_response: true,
      allow_edit: false,
      anonymous: false,
      opens_at: null,
      closes_at: null,
    },
    theme: {
      cover: null,
      background_style: 'none',
      background: null,
      background_color: '#E8EEF3',
      blur: true,
      overlay: 25,
      accent: '#0E7A6A',
    },
    sections: [
      { key: 's1', title: 'Preventing fires', description: '', condition: null },
      { key: 's2', title: 'Wrap-up', description: '', condition: null },
    ],
    questions: [
      {
        key: 'q1',
        section_key: 's1',
        type: 'short',
        text: 'What should you do first?',
        help: '',
        required: false,
        options: [],
        config: {},
        condition: null,
      },
      {
        key: 'q2',
        section_key: 's1',
        type: 'short',
        text: 'Where is the assembly point?',
        help: '',
        required: false,
        options: [],
        config: {},
        condition: null,
      },
      {
        key: 'q3',
        section_key: 's2',
        type: 'short',
        text: 'Any feedback?',
        help: '',
        required: false,
        options: [],
        config: {},
        condition: null,
      },
    ],
  }
}

const VIDEOS: Record<string, FormVideo> = {
  s1: { url: '/api/files/videos/v1?exp=1&sig=x', allow_seek: false, allow_speed: false },
}

function renderForm(layout: Layout, props: Partial<React.ComponentProps<typeof SurveyForm>> = {}) {
  const onVideoProgress = vi.fn()
  render(
    <SurveyForm
      survey={training(layout)}
      assets={() => null}
      onSubmit={vi.fn()}
      videos={VIDEOS}
      onVideoProgress={onVideoProgress}
      {...props}
    />,
  )
  return { onVideoProgress }
}

const video = () => screen.getByLabelText<HTMLVideoElement>('Video: Preventing fires')

describe('questions after the video', () => {
  it('all on one page: a section shows its video, and its questions once it ends', () => {
    const { onVideoProgress } = renderForm('all')

    expect(screen.getByText(/appear when the video ends\./)).toHaveTextContent(
      '2 questions appear when the video ends.',
    )
    expect(screen.queryByRole('heading', { name: /What should you do first/ })).toBeNull()
    // The section without a video is open as usual.
    expect(screen.getByRole('heading', { name: /Any feedback/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit response' })).toBeDisabled()
    expect(screen.getByText('Watch each video to see its questions')).toBeInTheDocument()

    fakeMedia(video(), 512).end()

    expect(screen.getByRole('heading', { name: /What should you do first/ })).toBeInTheDocument()
    expect(screen.queryByText(/appear when the video ends/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Submit response' })).toBeEnabled()
    expect(onVideoProgress).toHaveBeenLastCalledWith('s1', 512, true)
  })

  it('one question at a time: the video sits on the first question of its section', async () => {
    const user = userEvent.setup()
    renderForm('step')

    expect(video()).toBeInTheDocument()
    expect(screen.getByText('Watch the video to continue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    fakeMedia(video(), 60).end()
    expect(screen.getByRole('heading', { name: /What should you do first/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // The second question of the section doesn't repeat the video.
    expect(screen.getByRole('heading', { name: /Where is the assembly point/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Video: Preventing fires')).toBeNull()
  })

  it('one section per page: Next waits for the video', () => {
    renderForm('section')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    fakeMedia(video(), 60).end()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('opens the questions straight away when the video was finished before', () => {
    renderForm('all', { videoProgress: { s1: { furthest_seconds: 512, completed: true } } })
    expect(screen.getByRole('heading', { name: /What should you do first/ })).toBeInTheDocument()
    expect(screen.getByText('Watched')).toBeInTheDocument()
  })

  it('Preview can skip the video', async () => {
    renderForm('all', { allowSkipVideos: true })
    await userEvent.click(screen.getByRole('button', { name: 'Skip video' }))
    expect(screen.getByRole('heading', { name: /What should you do first/ })).toBeInTheDocument()
  })
})
