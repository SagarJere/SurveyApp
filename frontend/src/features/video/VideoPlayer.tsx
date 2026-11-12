import { CheckIcon, FastForwardIcon, TriangleAlertIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { apiUrl } from '@/lib/env'

/** Report progress at least this often (seconds of new viewing). */
const REPORT_EVERY_SECONDS = 10
/** Seeking this far past the furthest point is "skipping ahead" (allows for rounding). */
const SEEK_TOLERANCE_SECONDS = 1

export interface VideoPlayerProps {
  /** The video's address: a signed /api/files/videos link, or an internal-server link. */
  src: string
  /** Names the player for screen readers, e.g. the section title. */
  title: string
  allowSeek: boolean
  allowSpeed: boolean
  /** Already finished once: they may move around freely now. */
  completed: boolean
  /** Where they got to last time (seconds). */
  startAt?: number
  /** The furthest point reached so far (seconds), now and then while watching. */
  onProgress?: (furthestSeconds: number) => void
  /** Played to the end, with the furthest point reached (seconds). */
  onEnded?: (furthestSeconds: number) => void
  /** Preview only: lets HR skip the video. */
  onSkip?: () => void
}

/**
 * The browser's own player (keyboard and screen-reader friendly), with the creator's rules:
 * no skipping ahead past the furthest point watched, and a fixed playback speed, unless allowed.
 */
export function VideoPlayer({
  src,
  title,
  allowSeek,
  allowSpeed,
  completed,
  startAt = 0,
  onProgress,
  onEnded,
  onSkip,
}: VideoPlayerProps) {
  const furthest = useRef(startAt)
  const reported = useRef(startAt)
  const [failed, setFailed] = useState(false)
  const seekLocked = !allowSeek && !completed
  const url = src.startsWith('/api/') ? apiUrl(src) : src

  const report = () => {
    if (furthest.current > reported.current) {
      reported.current = furthest.current
      onProgress?.(furthest.current)
    }
  }

  const notes = [
    seekLocked ? 'You can pause and rewind. Skipping ahead is off for this training.' : null,
    allowSpeed ? null : 'The playback speed is fixed.',
  ].filter(Boolean)

  return (
    <figure className="m-0 flex flex-col gap-2">
      {failed ? (
        <div
          role="alert"
          className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted p-4 text-center text-sm"
        >
          <TriangleAlertIcon className="size-6 text-warn" aria-hidden="true" />
          <p className="max-w-sm">
            This video can’t play here. If it’s on the company network, connect to the office
            network or VPN, then reload the page.
          </p>
        </div>
      ) : (
        // Training videos are uploaded or linked as plain files, without caption tracks.
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          className="aspect-video w-full rounded-xl bg-black"
          src={url}
          controls
          playsInline
          preload="metadata"
          disablePictureInPicture
          controlsList={allowSpeed ? 'nodownload' : 'nodownload noplaybackrate'}
          aria-label={`Video: ${title}`}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            // Pick up where they left off (not right at the end).
            if (startAt > 0 && startAt < video.duration - 2) video.currentTime = startAt
          }}
          onTimeUpdate={(event) => {
            const video = event.currentTarget
            if (video.seeking) return
            if (video.currentTime > furthest.current) furthest.current = video.currentTime
            if (furthest.current - reported.current >= REPORT_EVERY_SECONDS) report()
          }}
          onSeeking={(event) => {
            const video = event.currentTarget
            if (seekLocked && video.currentTime > furthest.current + SEEK_TOLERANCE_SECONDS) {
              video.currentTime = furthest.current
            }
          }}
          onRateChange={(event) => {
            const video = event.currentTarget
            if (!allowSpeed && video.playbackRate !== 1) video.playbackRate = 1
          }}
          onPause={report}
          onEnded={(event) => {
            const duration = event.currentTarget.duration
            if (Number.isFinite(duration)) furthest.current = Math.max(furthest.current, duration)
            report()
            onEnded?.(furthest.current)
          }}
          onError={() => {
            setFailed(true)
          }}
        />
      )}
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {completed ? (
          <span className="inline-flex items-center gap-1 font-semibold text-success">
            <CheckIcon className="size-3.5" aria-hidden="true" />
            Watched
          </span>
        ) : null}
        {notes.map((note) => (
          <span key={note}>{note}</span>
        ))}
        {onSkip && !completed ? (
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onSkip}>
            <FastForwardIcon aria-hidden="true" />
            Skip video
          </Button>
        ) : null}
      </figcaption>
    </figure>
  )
}
