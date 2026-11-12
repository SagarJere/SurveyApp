import { useQueryClient } from '@tanstack/react-query'
import {
  CheckIcon,
  LinkIcon,
  Loader2Icon,
  LockIcon,
  PlusIcon,
  TriangleAlertIcon,
  UploadIcon,
  VideoIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useBuilderStore } from '@/features/builder/store'
import type { Section, SectionVideo } from '@/features/survey-logic/types'
import { deleteVideo, surveyKeys, uploadVideo } from '@/features/surveys/api'
import type { VideoAsset } from '@/features/surveys/types'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

import { ACCEPTED_VIDEO_TYPES, formatDuration, formatSize, videoFormat } from './format'
import { checkVideo, type VideoCheck } from './read-duration'
import { useUploadedVideos } from './use-videos'

const LINK_PATTERN = /^https?:\/\/\S+$/i
const NEW_VIDEO: SectionVideo = {
  source: 'upload',
  asset_id: null,
  url: null,
  allow_seek: false,
  allow_speed: false,
}

/** Trainings: the video at the top of a section, in the builder (docs/09-trainings.md). */
export function SectionVideoPanel({ section, label }: { section: Section; label: string }) {
  const update = useBuilderStore((s) => s.updateSection)
  const video = section.video ?? null
  const set = (patch: Partial<SectionVideo> | null) => {
    update(section.key, { video: patch === null ? null : { ...(video ?? NEW_VIDEO), ...patch } })
  }

  if (!video) {
    return (
      <button
        type="button"
        className="mb-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed text-sm font-semibold text-muted-foreground hover:border-primary hover:text-primary-soft-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => {
          set({ ...NEW_VIDEO })
        }}
      >
        <PlusIcon className="size-4" aria-hidden="true" />
        Add a video to {label}
      </button>
    )
  }

  return (
    <div
      className="mb-3 flex flex-col gap-3.5 rounded-xl border bg-card p-4"
      role="group"
      aria-label={`Video for ${label}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 flex items-center gap-2 font-semibold">
          <VideoIcon className="size-4.5 text-primary" aria-hidden="true" />
          Video
        </p>
        <div className="flex items-center gap-1.5">
          <div
            className="inline-flex rounded-full border bg-muted p-[3px]"
            role="group"
            aria-label="Video source"
          >
            {(['upload', 'link'] as const).map((source) => (
              <button
                key={source}
                type="button"
                aria-pressed={video.source === source}
                className="min-h-8 rounded-full px-3 text-sm font-semibold text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm"
                onClick={() => {
                  set({ source })
                }}
              >
                {source === 'upload' ? 'Upload' : 'Internal link'}
              </button>
            ))}
          </div>
          <RemoveVideo
            section={section}
            onRemoved={() => {
              set(null)
            }}
          />
        </div>
      </div>

      {video.source === 'upload' ? (
        <UploadField
          assetId={video.asset_id ?? null}
          onUploaded={(id) => {
            set({ asset_id: id })
          }}
        />
      ) : (
        <LinkField
          url={video.url ?? ''}
          onChange={(url) => {
            set({ url })
          }}
        />
      )}

      <div className="flex flex-col gap-2.5 rounded-lg bg-logic-soft px-3.5 py-3">
        <p className="m-0 flex items-center gap-2 text-sm font-semibold text-logic">
          <LockIcon className="size-4 shrink-0" aria-hidden="true" />
          The questions in this section appear after the video ends.
        </p>
        <Switch
          checked={video.allow_seek}
          onCheckedChange={(allow_seek) => {
            set({ allow_seek })
          }}
          label="Allow skipping ahead"
        />
        <Switch
          checked={video.allow_speed}
          onCheckedChange={(allow_speed) => {
            set({ allow_speed })
          }}
          label="Allow changing the playback speed"
        />
      </div>
    </div>
  )
}

/** Remove the section's video; an uploaded file nothing published uses is deleted too. */
function RemoveVideo({ section, onRemoved }: { section: Section; onRemoved: () => void }) {
  const surveyId = useBuilderStore((s) => s.surveyId) ?? ''
  const queryClient = useQueryClient()
  const { byId } = useUploadedVideos(surveyId)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Remove video"
      onClick={() => {
        const assetId = section.video?.source === 'upload' ? section.video.asset_id : null
        onRemoved()
        const asset = assetId ? byId.get(assetId) : undefined
        if (asset && !asset.published) {
          void deleteVideo(surveyId, asset.id)
            .then(() => queryClient.invalidateQueries({ queryKey: surveyKeys.videos(surveyId) }))
            .catch(() => undefined)
        }
      }}
    >
      <XIcon aria-hidden="true" />
    </Button>
  )
}

function UploadField({
  assetId,
  onUploaded,
}: {
  assetId: string | null
  onUploaded: (id: string) => void
}) {
  const id = useId()
  const surveyId = useBuilderStore((s) => s.surveyId) ?? ''
  const queryClient = useQueryClient()
  const { byId, isPending } = useUploadedVideos(surveyId)
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const asset: VideoAsset | undefined = assetId ? byId.get(assetId) : undefined

  const choose = async (file: File) => {
    setProblem(null)
    setProgress(0)
    const replaced = asset
    try {
      const check = await checkVideo(file)
      const uploaded = await uploadVideo(
        surveyId,
        file,
        check.ok ? check.duration : null,
        setProgress,
      )
      queryClient.setQueryData<VideoAsset[]>(surveyKeys.videos(surveyId), (old) => [
        ...(old ?? []),
        uploaded,
      ])
      onUploaded(uploaded.id)
      if (replaced && !replaced.published) {
        void deleteVideo(surveyId, replaced.id)
          .then(() => queryClient.invalidateQueries({ queryKey: surveyKeys.videos(surveyId) }))
          .catch(() => undefined)
      }
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "The upload didn't finish. Try again.")
    } finally {
      setProgress(null)
    }
  }

  const fileInput = (
    <input
      ref={input}
      id={`${id}-file`}
      type="file"
      accept={ACCEPTED_VIDEO_TYPES}
      className="sr-only"
      tabIndex={-1}
      aria-label="Video file"
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void choose(file)
      }}
    />
  )
  const pick = () => {
    input.current?.click()
  }

  return (
    <div className="flex flex-col gap-2">
      {fileInput}
      {progress !== null ? (
        <div className="flex flex-col gap-1.5 rounded-xl border p-3" role="status">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            Uploading… {Math.round(progress * 100)}%
          </span>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${String(Math.round(progress * 100))}%` }}
            />
          </div>
        </div>
      ) : asset ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
          <div
            className="grid h-[68px] w-[120px] shrink-0 place-items-center rounded-lg bg-[#1e2833]"
            aria-hidden="true"
          >
            <VideoIcon className="size-6 text-white/80" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 font-semibold break-all">{asset.file_name}</p>
            <p className="m-0 mt-0.5 text-sm text-muted-foreground">
              {[
                formatSize(asset.size_bytes),
                formatDuration(asset.duration_seconds),
                videoFormat(asset.content_type),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="m-0 mt-1 flex items-center gap-1.5 text-sm font-semibold text-success">
              <CheckIcon className="size-3.5" aria-hidden="true" />
              Uploaded
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={pick}>
            Replace
          </Button>
        </div>
      ) : assetId && isPending ? (
        <div className="h-[94px] animate-pulse rounded-xl bg-muted" aria-hidden="true" />
      ) : (
        <Button
          type="button"
          variant="outline"
          className="min-h-14 border-dashed"
          onClick={pick}
          aria-describedby={`${id}-hint`}
        >
          <UploadIcon aria-hidden="true" />
          Choose a video file
        </Button>
      )}
      <p id={`${id}-hint`} className="m-0 text-xs text-muted-foreground">
        MP4 or WebM, up to 200 MB. Other formats: convert to MP4 first.
      </p>
      {problem ? (
        <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-warn" role="alert">
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
          {problem}
        </p>
      ) : null}
    </div>
  )
}

type LinkState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'done'; check: VideoCheck }

function LinkField({ url, onChange }: { url: string; onChange: (url: string) => void }) {
  const id = useId()
  const [state, setState] = useState<LinkState>({ kind: 'idle' })
  const trimmed = url.trim()
  const wellFormed = LINK_PATTERN.test(trimmed)

  // Check the address once typing pauses: can this browser load it, and how long is it?
  useEffect(() => {
    if (!wellFormed) return undefined
    let cancelled = false
    const timer = window.setTimeout(() => {
      setState({ kind: 'checking' })
      void checkVideo(trimmed).then((check) => {
        if (!cancelled) setState({ kind: 'done', check })
      })
    }, 600)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [trimmed, wellFormed])

  const message =
    trimmed && !wellFormed
      ? { tone: 'warn', text: 'The address must start with http:// or https://' }
      : !wellFormed
        ? null
        : state.kind === 'checking'
          ? { tone: 'muted', text: 'Checking the video…' }
          : state.kind === 'done' && state.check.ok
            ? {
                tone: 'ok',
                text: `Found it${
                  state.check.duration !== null
                    ? `: ${formatDuration(state.check.duration) ?? ''}`
                    : ''
                }. Plays for people on the office network or VPN.`,
              }
            : state.kind === 'done'
              ? {
                  tone: 'warn',
                  text: "Couldn't load this video from here. Check the address, and that you're on the office network or VPN.",
                }
              : null

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-url`} className="text-sm font-semibold text-muted-foreground">
        Video address on your internal server
      </label>
      <div className="relative">
        <LinkIcon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          className="pl-9"
          placeholder="https://videos.intranet/training/fire-safety.mp4"
          value={url}
          maxLength={2000}
          aria-describedby={message ? `${id}-status` : undefined}
          aria-invalid={message?.tone === 'warn' && !wellFormed ? true : undefined}
          onChange={(event) => {
            setState({ kind: 'idle' })
            onChange(event.target.value)
          }}
        />
      </div>
      {message ? (
        <p
          id={`${id}-status`}
          className={cn(
            'm-0 flex items-center gap-1.5 text-sm',
            message.tone === 'ok' && 'font-semibold text-success',
            message.tone === 'warn' && 'font-semibold text-warn',
            message.tone === 'muted' && 'text-muted-foreground',
          )}
          aria-live="polite"
        >
          {message.tone === 'ok' ? <CheckIcon className="size-3.5" aria-hidden="true" /> : null}
          {message.tone === 'warn' ? (
            <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
          ) : null}
          {message.text}
        </p>
      ) : null}
    </div>
  )
}
