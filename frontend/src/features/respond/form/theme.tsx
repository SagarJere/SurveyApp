import type { CSSProperties, ReactNode } from 'react'

import type { Theme } from '@/features/survey-logic/types'
import { apiUrl } from '@/lib/env'
import { cn } from '@/lib/utils'

import type { AssetLinks, AssetResolver } from './theme-utils'

function ResponsiveImage({ asset, className }: { asset: AssetLinks; className?: string }) {
  return (
    <img
      alt=""
      src={apiUrl(asset.url)}
      srcSet={`${apiUrl(asset.mobile_url)} 800w, ${apiUrl(asset.url)} ${asset.width}w`}
      sizes="(max-width: 640px) 100vw, 760px"
      decoding="async"
      className={cn('absolute inset-0 size-full object-cover', className)}
    />
  )
}

/**
 * The page background behind the survey card. Hidden when the survey is under 640px wide
 * (a container query, so the preview's phone width hides it too). Only the cover shows then.
 */
export function SurveyStage({
  theme,
  assets,
  children,
  compact = false,
}: {
  theme: Theme
  assets: AssetResolver
  children: ReactNode
  /** Theme tab mini preview: always show the background, with less padding. */
  compact?: boolean
}) {
  const image = theme.background_style === 'image' ? assets(theme.background) : null
  const coloured = theme.background_style === 'color'
  const staged = coloured || image !== null
  // Real surveys hide the background below 640px wide; the mini preview never does.
  const phoneHide = compact ? '' : '@max-[640px]:hidden'

  return (
    <div className="@container">
      <div
        className={cn(
          'relative isolate',
          staged && 'overflow-clip rounded-[22px]',
          staged && (compact ? 'p-6' : 'p-8 sm:p-9 @max-[640px]:rounded-none @max-[640px]:p-0'),
          coloured && 'bg-(--stage-colour)',
          coloured && !compact && '@max-[640px]:bg-transparent',
        )}
        style={
          coloured ? ({ '--stage-colour': theme.background_color } as CSSProperties) : undefined
        }
      >
        {image ? (
          <div className={cn('absolute inset-0 -z-10', phoneHide)} aria-hidden="true">
            <ResponsiveImage
              asset={image}
              className={theme.blur ? 'scale-[1.08] blur-[8px]' : undefined}
            />
            <div className="absolute inset-0 bg-black" style={{ opacity: theme.overlay / 100 }} />
          </div>
        ) : null}
        <div
          className={cn(
            'rounded-[18px]',
            staged && 'shadow-[0_12px_40px_rgba(0,0,0,0.25)]',
            staged && !compact && '@max-[640px]:shadow-none',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/** Title area: the cover image with the darken overlay, or a solid accent block. */
export function SurveyCover({
  theme,
  assets,
  title,
  description,
  compact = false,
}: {
  theme: Theme
  assets: AssetResolver
  title: string
  description: string
  /** Small version for the Theme tab's mini preview. */
  compact?: boolean
}) {
  const cover = assets(theme.cover)
  return (
    <header
      className={cn(
        'relative isolate text-white',
        compact
          ? 'flex min-h-[72px] flex-col justify-end px-4 py-3.5'
          : 'px-6 pt-7 pb-5.5 @max-[640px]:px-4.5 @max-[640px]:pt-5.5 @max-[640px]:pb-4.5',
        cover && '[text-shadow:0_1px_3px_rgba(0,0,0,0.35)]',
        cover && !compact && 'flex min-h-[190px] flex-col justify-end @max-[640px]:min-h-[150px]',
        cover && compact && 'min-h-[100px]',
      )}
      style={cover ? undefined : { backgroundColor: theme.accent }}
    >
      {cover ? (
        <div className="absolute inset-0 -z-10" aria-hidden="true">
          <ResponsiveImage asset={cover} />
          <div
            className="absolute inset-0"
            style={{ background: `rgba(6, 14, 18, ${String(theme.overlay / 100)})` }}
          />
        </div>
      ) : null}
      {compact ? (
        <strong className="font-heading text-[15px]">{title.trim() || 'Untitled survey'}</strong>
      ) : (
        <h1 className="text-[27px] leading-tight font-semibold @max-[640px]:text-[23px]">
          {title.trim() || 'Untitled survey'}
        </h1>
      )}
      {!compact && description.trim() ? (
        <p className="mt-2 max-w-[60ch] whitespace-pre-line opacity-90">{description}</p>
      ) : null}
    </header>
  )
}
