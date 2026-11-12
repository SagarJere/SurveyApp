import { ArrowLeftIcon, Loader2Icon, LockIcon, MoreHorizontalIcon, Share2Icon } from 'lucide-react'
import { forwardRef } from 'react'
import { Link } from 'react-router'

import { ThemeToggle } from '@/app/theme/ThemeToggle'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusPill } from '@/features/surveys/StatusPill'
import { UNTITLED_SURVEY, UNTITLED_TRAINING, type SurveyStatus } from '@/features/surveys/types'
import { cn } from '@/lib/utils'

import { useBuilderStore } from './store'
import type { SaveStatus } from './use-autosave'

const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: 'All changes saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  error: "Couldn't save. Retrying…",
  conflict: 'Not saved',
}

export type BuilderMode = 'edit' | 'preview'

interface BuilderTopBarProps {
  status: SurveyStatus
  versionNo: number | null
  saveStatus: SaveStatus
  mode: BuilderMode
  onModeChange: (mode: BuilderMode) => void
  publishLabel: string
  /** Shorter label for phones, e.g. "Publish" for "Publish changes". */
  publishShortLabel: string
  publishDisabled: boolean
  publishing: boolean
  onPublish: () => void
  onClose: (() => void) | null
  /** Show the survey link to share (published surveys only). */
  onShare: (() => void) | null
}

export const BuilderTopBar = forwardRef<HTMLElement, BuilderTopBarProps>(function BuilderTopBar(
  {
    status,
    versionNo,
    saveStatus,
    mode,
    onModeChange,
    publishLabel,
    publishShortLabel,
    publishDisabled,
    publishing,
    onPublish,
    onClose,
    onShare,
  },
  ref,
) {
  const title = useBuilderStore((s) => s.draft.title)
  const training = useBuilderStore((s) => s.kind === 'training')

  return (
    <header ref={ref} className="sticky top-0 z-30 border-b bg-card">
      <div className="mx-auto flex max-w-[1040px] items-center gap-2 px-2 py-2 sm:gap-3 sm:px-5 sm:py-2.5">
        <Button variant="ghost" size="icon" asChild>
          <Link
            to={training ? '/admin/trainings' : '/admin/surveys'}
            aria-label={training ? 'Back to Trainings' : 'Back to Surveys'}
          >
            <ArrowLeftIcon aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1 sm:border-l sm:pl-3">
          <strong className="block truncate font-semibold">
            {title.trim() || (training ? UNTITLED_TRAINING : UNTITLED_SURVEY)}
          </strong>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {training ? (
              <span className="rounded-full border px-2 py-px font-semibold text-foreground">
                Training
              </span>
            ) : null}
            <StatusPill status={status} versionNo={versionNo} />
            <span
              role="status"
              aria-live="polite"
              className={cn(
                'truncate',
                (saveStatus === 'error' || saveStatus === 'conflict') && 'font-semibold text-warn',
              )}
            >
              {SAVE_LABELS[saveStatus]}
            </span>
          </span>
        </div>
        <div
          className="inline-flex shrink-0 rounded-full border bg-muted p-[3px]"
          role="group"
          aria-label="Mode"
        >
          {(['edit', 'preview'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              className="min-h-9 rounded-full px-2.5 text-sm font-semibold text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm sm:px-3.5"
              onClick={() => {
                onModeChange(value)
              }}
            >
              {value === 'edit' ? 'Edit' : 'Preview'}
            </button>
          ))}
        </div>
        {onShare ? (
          // On phones it lives in the "More actions" menu, so the title keeps its room.
          <Button
            variant="outline"
            className="hidden shrink-0 px-3.5 sm:inline-flex"
            aria-label="Share survey link"
            onClick={onShare}
          >
            <Share2Icon aria-hidden="true" />
            Share
          </Button>
        ) : null}
        <Button
          className="shrink-0 px-3 sm:px-4"
          aria-label={publishLabel}
          disabled={publishDisabled || publishing}
          onClick={onPublish}
        >
          {publishing ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          <span className="sm:hidden">{publishShortLabel}</span>
          <span className="hidden sm:inline">{publishLabel}</span>
        </Button>
        <div className="hidden sm:block">
          <ThemeToggle />
        </div>
        {onClose || onShare ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontalIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onShare ? (
                <DropdownMenuItem className="sm:hidden" onSelect={onShare}>
                  <Share2Icon aria-hidden="true" />
                  Share survey link…
                </DropdownMenuItem>
              ) : null}
              {onClose ? (
                <DropdownMenuItem onSelect={onClose}>
                  <LockIcon aria-hidden="true" />
                  Close survey…
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  )
})
