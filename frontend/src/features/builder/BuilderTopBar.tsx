import { ArrowLeftIcon, ListChecksIcon, Loader2Icon } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/app/theme/ThemeToggle'
import { StatusPill } from '@/features/surveys/StatusPill'
import { UNTITLED_SURVEY, type SurveyStatus } from '@/features/surveys/types'
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

interface BuilderTopBarProps {
  status: SurveyStatus
  versionNo: number | null
  saveStatus: SaveStatus
  checking: boolean
  onCheck: () => void
}

export function BuilderTopBar({
  status,
  versionNo,
  saveStatus,
  checking,
  onCheck,
}: BuilderTopBarProps) {
  const title = useBuilderStore((s) => s.draft.title)

  return (
    <header className="sticky top-0 z-30 border-b bg-card">
      <div className="mx-auto flex max-w-[1040px] items-center gap-2.5 px-3 py-2 sm:gap-3.5 sm:px-5 sm:py-2.5">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/admin/surveys" aria-label="Back to Surveys">
            <ArrowLeftIcon aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1 sm:border-l sm:pl-3.5">
          <strong className="block truncate font-semibold">
            {title.trim() || UNTITLED_SURVEY}
          </strong>
          <span className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <StatusPill status={status} versionNo={versionNo} />
            <span
              role="status"
              aria-live="polite"
              className={cn(
                saveStatus === 'error' || saveStatus === 'conflict'
                  ? 'font-semibold text-warn'
                  : '',
              )}
            >
              {SAVE_LABELS[saveStatus]}
            </span>
          </span>
        </div>
        <ThemeToggle />
        <Button variant="outline" onClick={onCheck} disabled={checking} className="px-3 sm:px-4">
          {checking ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <ListChecksIcon aria-hidden="true" />
          )}
          <span className="sr-only sm:not-sr-only">Check for issues</span>
        </Button>
      </div>
    </header>
  )
}
