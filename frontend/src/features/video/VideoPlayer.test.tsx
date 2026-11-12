import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { fakeMedia } from '@/test/media'

import { formatDuration, formatSize } from './format'
import { VideoPlayer, type VideoPlayerProps } from './VideoPlayer'

function player(props: Partial<VideoPlayerProps> = {}) {
  const onProgress = vi.fn()
  const onEnded = vi.fn()
  render(
    <VideoPlayer
      src="/api/files/videos/abc?exp=1&sig=x"
      title="Preventing fires"
      allowSeek={false}
      allowSpeed={false}
      completed={false}
      onProgress={onProgress}
      onEnded={onEnded}
      {...props}
    />,
  )
  const video = screen.getByLabelText<HTMLVideoElement>('Video: Preventing fires')
  return { video, media: fakeMedia(video, 100), onProgress, onEnded }
}

describe('VideoPlayer', () => {
  it('blocks skipping ahead past the furthest point watched, but allows rewinding', () => {
    const { media } = player()
    media.playTo(30)

    media.seek(80)
    expect(media.time).toBe(30)

    media.seek(10)
    expect(media.time).toBe(10)
    expect(screen.getByText(/Skipping ahead is off/)).toBeInTheDocument()
  })

  it('lets people skip when the creator allows it, or once they have finished', () => {
    const allowed = player({ allowSeek: true })
    allowed.media.seek(80)
    expect(allowed.media.time).toBe(80)
  })

  it('lets people move freely in a video they already finished', () => {
    const { media } = player({ completed: true })
    media.seek(90)
    expect(media.time).toBe(90)
    expect(screen.getByText('Watched')).toBeInTheDocument()
  })

  it('keeps the speed at 1× unless speed changes are allowed', () => {
    const fixed = player()
    fixed.media.setRate(2)
    expect(fixed.media.rate).toBe(1)
    expect(fixed.video).toHaveAttribute('controlsList', 'nodownload noplaybackrate')
  })

  it('keeps a changed speed when allowed', () => {
    const free = player({ allowSpeed: true })
    free.media.setRate(1.5)
    expect(free.media.rate).toBe(1.5)
    expect(free.video).toHaveAttribute('controlsList', 'nodownload')
  })

  it('reports progress every 10 seconds and on pause, and the end', () => {
    const { media, onProgress, onEnded } = player()
    media.playTo(4)
    expect(onProgress).not.toHaveBeenCalled()
    media.playTo(12)
    expect(onProgress).toHaveBeenLastCalledWith(12)
    media.playTo(15)
    media.pause()
    expect(onProgress).toHaveBeenLastCalledWith(15)

    media.end()
    expect(onEnded).toHaveBeenCalledWith(100)
  })

  it('picks up where they left off', () => {
    const { media } = player({ startAt: 42 })
    media.loaded()
    expect(media.time).toBe(42)
  })

  it('explains when the video cannot play from here', () => {
    const { video } = player()
    fireEvent.error(video)
    expect(screen.getByRole('alert')).toHaveTextContent(/connect to the office network or VPN/)
  })

  it('offers Skip video in Preview', async () => {
    const onSkip = vi.fn()
    player({ onSkip })
    await userEvent.click(screen.getByRole('button', { name: 'Skip video' }))
    expect(onSkip).toHaveBeenCalled()
  })
})

describe('video formatting', () => {
  it.each([
    [512, '8 min 32 s'],
    [45, '45 s'],
    [600, '10 min'],
    [3720, '1 h 2 min'],
    [null, null],
  ])('%s seconds → %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text)
  })

  it('formats sizes', () => {
    expect(formatSize(142 * 1024 * 1024)).toBe('142 MB')
    expect(formatSize(850 * 1024)).toBe('850 KB')
  })
})
