import { useQuery } from '@tanstack/react-query'
import { ClockIcon, PartyPopperIcon, TriangleAlertIcon } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { usePageTitle } from '@/hooks/use-page-title'
import { apiUrl } from '@/lib/env'
import { shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { listMySurveys, listMyTrainings, respondKeys, type MySurvey } from './api'

const GROUPS = [
  { status: 'pending', title: 'To do', action: 'Start' },
  { status: 'in_progress', title: 'In progress', action: 'Continue' },
  { status: 'submitted', title: 'Completed', action: 'View' },
] as const

function daysUntil(isoDate: string, now = new Date()): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  const end = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((end - today) / 86_400_000)
}

function closingText(survey: MySurvey): string | null {
  if (!survey.closes_at || survey.status === 'submitted') return null
  const days = daysUntil(survey.closes_at)
  if (days <= 0) return 'Closes today'
  if (days === 1) return 'Closes tomorrow'
  if (days <= 7) return `Closes in ${String(days)} days`
  return `Closes ${shortDate(survey.closes_at)}`
}

/** Trainings not yet completed: "Due in 4 days", "Due today", "Overdue". */
function dueText(survey: MySurvey): { text: string; urgent: boolean } | null {
  if (!survey.due_date || survey.status === 'submitted') return null
  const days = daysUntil(survey.due_date)
  if (days < 0) return { text: 'Overdue', urgent: true }
  if (days === 0) return { text: 'Due today', urgent: true }
  if (days === 1) return { text: 'Due tomorrow', urgent: true }
  if (days <= 7) return { text: `Due in ${String(days)} days`, urgent: days <= 3 }
  return { text: `Due ${shortDate(survey.due_date)}`, urgent: false }
}

/** Trainings: "Passed · 92%", "Not passed · 60%" or "Score 75%" (when there's no pass mark). */
function resultText(survey: MySurvey): { text: string; tone: 'good' | 'bad' | null } | null {
  if (survey.status !== 'submitted') return null
  const score = survey.best_score
  const scoreText = score === null || score === undefined ? '' : ` · ${String(score)}%`
  if (survey.passed === true) return { text: `Passed${scoreText}`, tone: 'good' }
  if (survey.passed === false) return { text: `Not passed${scoreText}`, tone: 'bad' }
  return score === null || score === undefined
    ? null
    : { text: `Score ${String(score)}%`, tone: null }
}

function SurveyCard({ survey, action }: { survey: MySurvey; action: string }) {
  const result = resultText(survey)
  // Trainings: a completed one can be retaken while attempts remain (null = no limit).
  const retake =
    survey.status === 'submitted' &&
    survey.open &&
    survey.attempts_left !== undefined &&
    survey.attempts_left !== 0
  const label = retake ? 'Retake' : action
  const closing = closingText(survey)
  const soon = closing !== null && survey.closes_at !== null && daysUntil(survey.closes_at) <= 3
  const due = dueText(survey)
  const title = survey.title.trim() || 'Untitled survey'
  return (
    <li className="flex overflow-hidden rounded-xl border bg-card">
      <div
        className="relative w-20 shrink-0 sm:w-28"
        style={{ backgroundColor: survey.accent }}
        aria-hidden="true"
      >
        {survey.cover ? (
          <img
            src={apiUrl(survey.cover.mobile_url)}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-heading text-lg font-semibold">{title}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="size-3.5" aria-hidden="true" />
              About {survey.minutes} minute{survey.minutes === 1 ? '' : 's'}
            </span>
            {due ? (
              <span className={cn(due.urgent && 'font-semibold text-warn')}>{due.text}</span>
            ) : null}
            {closing ? (
              <span className={cn(soon && 'font-semibold text-warn')}>{closing}</span>
            ) : null}
            {survey.videos_total > 0 && survey.status !== 'submitted' ? (
              <span>
                {survey.videos_done} of {survey.videos_total} video
                {survey.videos_total === 1 ? '' : 's'} watched
              </span>
            ) : null}
            {result ? (
              <span
                className={cn(
                  'font-semibold',
                  result.tone === 'good' && 'text-success',
                  result.tone === 'bad' && 'text-warn',
                )}
              >
                {result.text}
              </span>
            ) : null}
            {retake && survey.attempts_left !== null && survey.attempts_left !== undefined ? (
              <span>
                {survey.attempts_left} attempt{survey.attempts_left === 1 ? '' : 's'} left
              </span>
            ) : null}
            {survey.status === 'submitted' && survey.submitted_at ? (
              <span>Submitted {shortDate(survey.submitted_at.slice(0, 10))}</span>
            ) : null}
          </p>
          {survey.status === 'in_progress' && survey.progress !== null ? (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <div
                className="h-1.5 w-32 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`${title} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(survey.progress * 100)}
              >
                <span
                  className="block h-full bg-primary"
                  style={{ width: `${String(Math.round(survey.progress * 100))}%` }}
                />
              </div>
              <span className="text-muted-foreground">
                {Math.round(survey.progress * 100)}% done
              </span>
            </div>
          ) : null}
        </div>
        {survey.open || survey.status !== 'submitted' ? (
          <Button
            asChild
            variant={survey.status === 'submitted' && !retake ? 'outline' : 'default'}
            className="self-start sm:self-center"
          >
            <Link to={`/s/${survey.id}`} aria-label={`${label}: ${title}`}>
              {label}
            </Link>
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground sm:self-center">Closed</span>
        )}
      </div>
    </li>
  )
}

const COPY = {
  survey: {
    title: 'My surveys',
    description: "Surveys you've been invited to take.",
    loading: 'Loading surveys',
    error: "We couldn't load your surveys",
    empty: 'When HR sends you a survey, it will appear here.',
  },
  training: {
    title: 'My trainings',
    description:
      "Trainings you've been asked to complete: watch each video, then answer its questions.",
    loading: 'Loading trainings',
    error: "We couldn't load your trainings",
    empty: 'When HR assigns you a training, it will appear here.',
  },
} as const

/** "My trainings": the same list, for trainings (docs/09-trainings.md). */
export function MyTrainingsPage() {
  return <MySurveysPage kind="training" />
}

/** "My surveys": what to answer, what's half done, and what's finished. */
export function MySurveysPage({ kind = 'survey' }: { kind?: 'survey' | 'training' }) {
  const copy = COPY[kind]
  usePageTitle(copy.title)
  const surveys = useQuery({
    queryKey: kind === 'training' ? respondKeys.trainings : respondKeys.mine,
    queryFn: ({ signal }) =>
      kind === 'training' ? listMyTrainings(signal) : listMySurveys(signal),
  })

  return (
    <>
      <PageHeader title={copy.title} description={copy.description} />
      {surveys.isPending ? (
        <ul className="flex flex-col gap-3" aria-label={copy.loading}>
          {[0, 1].map((i) => (
            <li key={i} className="rounded-xl border bg-card p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="mt-3 h-4 w-1/3" />
            </li>
          ))}
        </ul>
      ) : surveys.isError ? (
        <EmptyState
          icon={TriangleAlertIcon}
          title={copy.error}
          description="Check your connection, then try again."
          action={<Button onClick={() => void surveys.refetch()}>Try again</Button>}
        />
      ) : surveys.data.some((s) => s.status !== 'submitted') ? (
        <Groups surveys={surveys.data} />
      ) : (
        <>
          <EmptyState
            icon={PartyPopperIcon}
            title="You're all caught up."
            description={copy.empty}
          />
          {surveys.data.length ? (
            <div className="mt-8">
              <Groups surveys={surveys.data} />
            </div>
          ) : null}
        </>
      )}
    </>
  )
}

function Groups({ surveys }: { surveys: MySurvey[] }) {
  return (
    <div className="flex flex-col gap-8">
      {GROUPS.map((group) => {
        const items = surveys.filter((s) => s.status === group.status)
        if (!items.length) return null
        return (
          <section key={group.status} aria-labelledby={`group-${group.status}`}>
            <h2 id={`group-${group.status}`} className="mb-3 text-lg font-semibold">
              {group.title}
            </h2>
            <ul className="flex flex-col gap-3">
              {items.map((survey) => (
                <SurveyCard key={survey.id} survey={survey} action={group.action} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
