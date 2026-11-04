import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, Loader2Icon, UploadIcon } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'
import { useBuilderStore } from '@/features/builder/store'
import { RATING_END_LABELS } from '@/features/question-types/constants'
import { SurveyCover, SurveyStage } from '@/features/respond/form/theme'
import { accentStyle, type AssetResolver } from '@/features/respond/form/theme-utils'
import { surveyKeys, uploadThemeAsset } from '@/features/surveys/api'
import type { ThemeAsset } from '@/features/surveys/types'
import type { BackgroundStyle, Theme } from '@/features/survey-logic/types'
import { ApiError } from '@/lib/api'
import { apiUrl } from '@/lib/env'
import { cn } from '@/lib/utils'

import { ACCENTS, BACKGROUND_COLOURS } from './palette'
import { useThemeAssets } from './use-theme-assets'

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

function Panel({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section className="mb-3.5 rounded-2xl border bg-card px-5 py-4.5" aria-labelledby={id}>
      <h2 id={id} className="mb-1.5 text-[19px] font-semibold">
        {title}
      </h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  )
}

const TILE =
  'relative flex aspect-[16/10] items-end overflow-hidden rounded-xl border-2 border-transparent bg-muted text-left font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-primary aria-pressed:ring-[3px] aria-pressed:ring-primary-soft'

function SelectedMark() {
  return (
    <span
      className="absolute top-1.5 right-1.5 grid size-[22px] place-items-center rounded-full bg-primary text-primary-foreground"
      aria-hidden="true"
    >
      <CheckIcon className="size-3.5" />
    </span>
  )
}

function ImageTile({
  asset,
  selected,
  onSelect,
}: {
  asset: ThemeAsset
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" className={TILE} aria-pressed={selected} onClick={onSelect}>
      <img
        src={apiUrl(asset.mobile_url)}
        alt=""
        loading="lazy"
        className="absolute inset-0 size-full object-cover"
      />
      <span className="relative w-full bg-gradient-to-b from-transparent to-black/60 px-2 pt-4 pb-1.5 text-xs text-white">
        {asset.name}
      </span>
      {selected ? <SelectedMark /> : null}
    </button>
  )
}

function UploadTile({ onFile, uploading }: { onFile: (file: File) => void; uploading: boolean }) {
  return (
    <label
      className={cn(
        TILE,
        'cursor-pointer flex-col items-center justify-center gap-1 border-[1.5px] border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
      )}
    >
      {uploading ? (
        <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
      ) : (
        <UploadIcon className="size-5" aria-hidden="true" />
      )}
      <span className="px-1.5 text-center text-xs">
        {uploading ? 'Uploading…' : 'Upload image'}
      </span>
      <input
        type="file"
        accept={ACCEPTED.join(',')}
        className="sr-only"
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onFile(file)
        }}
      />
    </label>
  )
}

/** Small "how it looks" card: cover plus one question over the page background. */
function MiniPreview({
  theme,
  title,
  assets,
}: {
  theme: Theme
  title: string
  assets: AssetResolver
}) {
  return (
    <div className="mt-2.5 rounded-[14px] border bg-muted p-4 sm:p-6" style={accentStyle(theme)}>
      <div className="mx-auto max-w-[400px]">
        <SurveyStage theme={theme} assets={assets} compact>
          <div className="overflow-clip rounded-[14px] border bg-card" aria-hidden="true">
            <SurveyCover theme={theme} assets={assets} title={title} description="" compact />
            <div className="px-4 pt-3 pb-3.5 text-[13px]">
              <p className="mb-2 font-semibold">
                How satisfied are you with your current work setup?
              </p>
              <div className="mb-3 flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span
                    key={n}
                    className={cn(
                      'flex-1 rounded-[7px] border py-1 text-center font-semibold',
                      n === 4 &&
                        'border-(--survey-accent) bg-(--survey-accent) text-(--survey-accent-foreground)',
                    )}
                  >
                    {n}
                  </span>
                ))}
              </div>
              <div className="mb-3 h-1 rounded-full bg-muted">
                <span className="block h-full w-3/5 rounded-full bg-(--survey-accent)" />
              </div>
              <span className="inline-block rounded-lg bg-(--survey-accent) px-3 py-1.5 font-semibold text-(--survey-accent-foreground)">
                Submit response
              </span>
              <span className="sr-only">{RATING_END_LABELS.join(' to ')}</span>
            </div>
          </div>
        </SurveyStage>
      </div>
    </div>
  )
}

/** Theme tab (docs/05-survey-builder.md, Theme tab; docs/06, Themes). */
export function ThemeTab() {
  const surveyId = useBuilderStore((s) => s.surveyId) ?? ''
  const theme = useBuilderStore((s) => s.draft.theme)
  const title = useBuilderStore((s) => s.draft.title)
  const update = useBuilderStore((s) => s.updateTheme)
  const { gallery, uploads, resolve, failed } = useThemeAssets(surveyId)
  const queryClient = useQueryClient()
  const [uploadingFor, setUploadingFor] = useState<'cover' | 'background' | null>(null)
  const images = [...gallery, ...uploads]

  const upload = useMutation({
    mutationFn: (file: File) => uploadThemeAsset(surveyId, file),
  })

  const handleFile = (target: 'cover' | 'background', file: File) => {
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Use a JPG, PNG or WebP image.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`That image is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Use one under 2 MB.`)
      return
    }
    setUploadingFor(target)
    upload.mutate(file, {
      onSuccess: (asset) => {
        queryClient.setQueryData<ThemeAsset[]>(surveyKeys.uploads(surveyId), (old) => [
          ...(old ?? []),
          asset,
        ])
        update(
          target === 'cover'
            ? { cover: asset.id }
            : { background: asset.id, background_style: 'image' },
        )
        toast.success('Image added. It’s been resized and a smaller copy made for phones.')
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError ? error.message : "We couldn't upload that image. Try again.",
        )
      },
      onSettled: () => {
        setUploadingFor(null)
      },
    })
  }

  const tiles = (target: 'cover' | 'background') => (
    <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5">
      {target === 'cover' ? (
        <button
          type="button"
          className={cn(
            TILE,
            'items-center justify-center border-[1.5px] border-dashed border-border text-muted-foreground aria-pressed:border-solid',
          )}
          aria-pressed={theme.cover === null}
          onClick={() => {
            update({ cover: null })
          }}
        >
          <span className="px-1.5 text-center text-xs">Accent colour only</span>
          {theme.cover === null ? <SelectedMark /> : null}
        </button>
      ) : null}
      {images.map((asset) => {
        const selected =
          target === 'cover' ? theme.cover === asset.id : theme.background === asset.id
        return (
          <ImageTile
            key={asset.id}
            asset={asset}
            selected={selected}
            onSelect={() => {
              update(target === 'cover' ? { cover: asset.id } : { background: asset.id })
            }}
          />
        )
      })}
      <UploadTile
        uploading={uploadingFor === target}
        onFile={(file) => {
          handleFile(target, file)
        }}
      />
    </div>
  )

  return (
    <>
      <Panel title="How it looks">
        <MiniPreview theme={theme} title={title} assets={resolve} />
        <p className="mt-2.5 text-sm text-muted-foreground">
          Open Preview to see it full size. On phones, only the cover image is shown.
        </p>
      </Panel>

      {failed ? (
        <p
          className="mb-3.5 rounded-xl bg-warn-soft px-4 py-3 text-sm font-semibold text-warn"
          role="alert"
        >
          The image gallery couldn&apos;t be loaded. Reload the page to try again.
        </p>
      ) : null}

      <Panel
        title="Cover image"
        description="Shown behind the survey title at the top of the page."
      >
        {tiles('cover')}
      </Panel>

      <Panel
        title="Page background"
        description="Questions always sit on solid cards, so they stay readable."
      >
        <div
          className="mt-3 inline-flex rounded-full border bg-muted p-[3px]"
          role="group"
          aria-label="Background style"
        >
          {(
            [
              ['none', 'None'],
              ['color', 'Colour'],
              ['image', 'Image'],
            ] as [BackgroundStyle, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme.background_style === value}
              className="min-h-9 rounded-full px-3.5 font-semibold text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm"
              onClick={() => {
                update({
                  background_style: value,
                  ...(value === 'image' && !theme.background && gallery[0]
                    ? { background: gallery[0].id }
                    : {}),
                })
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {theme.background_style === 'color' ? (
          <div className="mt-3 flex flex-wrap gap-3">
            {BACKGROUND_COLOURS.map((colour) => (
              <button
                key={colour.value}
                type="button"
                aria-pressed={theme.background_color === colour.value}
                aria-label={`${colour.name} background`}
                title={colour.name}
                className="size-11 rounded-full border-2 aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:ring-offset-[3px] aria-pressed:ring-offset-card"
                style={{ backgroundColor: colour.value }}
                onClick={() => {
                  update({ background_color: colour.value })
                }}
              />
            ))}
          </div>
        ) : null}
        {theme.background_style === 'image' ? (
          <>
            {tiles('background')}
            <div className="mt-2.5 flex items-center justify-between gap-4 border-t pt-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">Soften background</span>
                <span id="soften-description" className="text-sm text-muted-foreground">
                  Blurs the image slightly so it doesn’t compete with the questions.
                </span>
              </div>
              <Switch
                checked={theme.blur}
                onCheckedChange={(blur) => {
                  update({ blur })
                }}
                label={<span className="sr-only">Soften background</span>}
                aria-describedby="soften-description"
              />
            </div>
          </>
        ) : null}
      </Panel>

      <Panel
        title="Darken images"
        description="Raise this if the title is hard to read over the image."
      >
        <div className="mt-3 flex max-w-[420px] items-center gap-3.5">
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={theme.overlay}
            aria-label="Darken images"
            aria-valuetext={`${String(theme.overlay)}%`}
            className="flex-1 accent-primary"
            onChange={(event) => {
              update({ overlay: Number(event.target.value) })
            }}
          />
          <output className="min-w-11 text-right font-semibold">{theme.overlay}%</output>
        </div>
      </Panel>

      <Panel
        title="Accent colour"
        description="Used for buttons, the progress bar and selected answers."
      >
        <div className="mt-3 flex flex-wrap gap-3">
          {ACCENTS.map((accent) => (
            <button
              key={accent.value}
              type="button"
              aria-pressed={theme.accent === accent.value}
              aria-label={accent.name}
              title={accent.name}
              className="size-11 rounded-full aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:ring-offset-[3px] aria-pressed:ring-offset-card"
              style={{ backgroundColor: accent.value }}
              onClick={() => {
                update({ accent: accent.value })
              }}
            />
          ))}
        </div>
      </Panel>
    </>
  )
}
