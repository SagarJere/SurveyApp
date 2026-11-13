import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  BarChart3Icon,
  ChevronDownIcon,
  DownloadIcon,
  Loader2Icon,
  PencilIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { usePageTitle } from '@/hooks/use-page-title'
import { StatusPill } from '@/features/surveys/StatusPill'
import { SurveyNotFoundPage } from '@/features/surveys/SurveyNotFoundPage'
import { UNTITLED_SURVEY } from '@/features/surveys/types'
import { ApiError, toApiError } from '@/lib/api'
import { shortDate } from '@/lib/format'

import {
  downloadExport,
  downloadNonResponders,
  getParticipation,
  getQuestions,
  getSummary,
  getTimeline,
  getTrainingFigures,
  resultKeys,
  type ExportKind,
  type ResultFilters,
  type ResultsSummary,
} from './api'
import { CompletionTab } from './CompletionTab'
import { DailyChart } from './DailyChart'
import { FilterBar } from './FilterBar'
import { HeadlineTiles, HeadlineTilesSkeleton } from './HeadlineTiles'
import { ParticipationTable } from './ParticipationTable'
import { QuestionResults, QuestionResultsSkeleton } from './QuestionResults'
import { ResponsesTab } from './ResponsesTab'
import { SmallGroupNotice } from './SmallGroupNotice'
import { takeaway } from './takeaway'
import { TrainingPanels, TrainingSkeleton, TrainingTiles } from './TrainingOverview'
import { useResultFilters, type ResultsTab } from './use-result-filters'

const EXPORTS: { kind: ExportKind; label: string; description: string }[] = [
  {
    kind: 'responses',
    label: 'Responses (Excel)',
    description: 'One row per person, one column per question.',
  },
  {
    kind: 'analytics',
    label: 'Responses with analytics (Excel)',
    description:
      'Summary with a chart per question, participation, daily responses, all responses and comments.',
  },
]

/** Trainings: what the same two downloads hold (best attempts; a Completion sheet). */
const TRAINING_EXPORT_NOTES: Record<ExportKind, string> = {
  responses: 'One row per person: their best attempt.',
  analytics:
    'Summary with charts, a Completion sheet (everyone, with status and best score), participation, daily counts and best attempts.',
}

const SURVEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** /admin/surveys/:surveyId/results — the results dashboard. */
export function ResultsPage() {
  const { surveyId = '' } = useParams()
  const validId = SURVEY_ID.test(surveyId)
  const { filters, tab, update, clear, active } = useResultFilters()
  const summary = useQuery({
    queryKey: resultKeys.part(surveyId, 'summary', filters),
    queryFn: ({ signal }) => getSummary(surveyId, filters, signal),
    enabled: validId,
    // Keep the last numbers on screen while a new filter loads, so the page doesn't jump.
    placeholderData: keepPreviousData,
  })
  usePageTitle(
    summary.data ? `Results: ${summary.data.title.trim() || UNTITLED_SURVEY}` : 'Results',
  )

  if (!validId) return <SurveyNotFoundPage />
  if (summary.isPending) return <ResultsSkeleton />
  if (summary.isError) {
    const error = summary.error instanceof ApiError ? summary.error : toApiError(summary.error)
    if (error.status === 404) return <SurveyNotFoundPage />
    if (error.code === 'NOT_PUBLISHED') {
      return (
        <EmptyState
          level={1}
          icon={BarChart3Icon}
          title="No results yet"
          description="This survey hasn't been published, so nobody has been able to respond."
          action={
            <Button variant="outline" asChild>
              <Link to={`/admin/surveys/${surveyId}/edit`}>Open the builder</Link>
            </Button>
          }
        />
      )
    }
    if (error.status === 422) {
      return (
        <EmptyState
          level={1}
          icon={TriangleAlertIcon}
          title="These filters don't work"
          description={error.message}
          action={
            <Button
              onClick={() => {
                update({ department: null, location: null, from: null, to: null, version: null })
              }}
            >
              Clear filters
            </Button>
          }
        />
      )
    }
    return (
      <EmptyState
        level={1}
        icon={TriangleAlertIcon}
        title="We couldn't load the results"
        description="Check your connection, then try again."
        action={<Button onClick={() => void summary.refetch()}>Try again</Button>}
      />
    )
  }

  const data = summary.data
  const training = data.kind === 'training'
  const views: [ResultsTab, string][] = [['overview', 'Overview']]
  if (training) views.push(['completion', 'Completion'])
  if (!data.anonymous)
    views.push(['responses', training ? 'Best attempts' : 'Individual responses'])
  const currentTab: ResultsTab = views.some(([value]) => value === tab) ? tab : 'overview'

  return (
    <div className="flex flex-col gap-6">
      <ResultsHeader
        surveyId={surveyId}
        summary={data}
        filters={filters}
        filtered={active}
        onVersion={(version) => {
          update({ version })
        }}
      />
      <FilterBar
        filters={filters}
        options={data.filter_options}
        active={active}
        onChange={update}
        onClear={clear}
      />
      {views.length > 1 ? (
        <div
          className="inline-flex self-start rounded-full border bg-muted p-[3px]"
          role="group"
          aria-label="View"
        >
          {views.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={currentTab === value}
              className="min-h-9 rounded-full px-3 text-sm font-semibold text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm sm:px-4"
              onClick={() => {
                update({ tab: value })
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {currentTab === 'completion' ? (
        <CompletionTab
          surveyId={surveyId}
          filters={filters}
          title={data.title.trim() || UNTITLED_SURVEY}
        />
      ) : currentTab === 'responses' ? (
        data.small_group ? (
          <SmallGroupNotice />
        ) : (
          <ResponsesTab surveyId={surveyId} filters={filters} />
        )
      ) : (
        <Overview
          surveyId={surveyId}
          summary={data}
          filters={filters}
          onDepartment={(department) => {
            update({ department })
          }}
        />
      )}
    </div>
  )
}

function ResultsHeader({
  surveyId,
  summary,
  filters,
  filtered,
  onVersion,
}: {
  surveyId: string
  summary: ResultsSummary
  filters: ResultFilters
  filtered: boolean
  onVersion: (version: number | null) => void
}) {
  const [exporting, setExporting] = useState(false)
  const title = summary.title.trim() || UNTITLED_SURVEY
  const versionNo = summary.versions.at(-1)?.version_no ?? null
  return (
    <header className="flex flex-col gap-4">
      <Link
        to={summary.kind === 'training' ? '/admin/trainings' : '/admin/surveys'}
        className="inline-flex items-center gap-1 self-start rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        {summary.kind === 'training' ? 'Trainings' : 'Surveys'}
      </Link>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight break-words">
              {title}
            </h1>
            <StatusPill status={summary.status} versionNo={versionNo} />
            {summary.anonymous ? (
              <span className="rounded-full border px-2 py-px text-xs font-semibold">
                Anonymous
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {takeaway(summary, filtered)}
            {summary.status === 'closed'
              ? ' The survey is closed.'
              : summary.closes_at
                ? ` Closes ${shortDate(summary.closes_at)}.`
                : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {summary.versions.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="results-version">Version</Label>
              <NativeSelect
                id="results-version"
                value={filters.version !== null ? String(filters.version) : ''}
                onChange={(event) => {
                  onVersion(event.target.value ? Number(event.target.value) : null)
                }}
              >
                <option value="">
                  {summary.compatible_versions ? 'All versions' : 'Latest version'}
                </option>
                {[...summary.versions].reverse().map((v) => (
                  <option key={v.version_no} value={v.version_no}>
                    Version {v.version_no} ({v.responses} responses)
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          {summary.can_download_non_responders ? (
            <Button variant="outline" asChild>
              <Link to={`/admin/surveys/${surveyId}/edit`}>
                <PencilIcon aria-hidden="true" />
                Edit
              </Link>
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={exporting}>
                {exporting ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : (
                  <DownloadIcon aria-hidden="true" />
                )}
                Download
                <ChevronDownIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {EXPORTS.map((option) => (
                <DropdownMenuItem
                  key={option.kind}
                  className="flex flex-col items-start gap-0.5"
                  onSelect={() => {
                    setExporting(true)
                    downloadExport(surveyId, filters, title, option.kind)
                      .then(() => {
                        toast.success(`${option.label} downloaded.`)
                      })
                      .catch(() => {
                        // The API client already showed what went wrong.
                      })
                      .finally(() => {
                        setExporting(false)
                      })
                  }}
                >
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {summary.kind === 'training'
                      ? TRAINING_EXPORT_NOTES[option.kind]
                      : option.description}
                  </span>
                </DropdownMenuItem>
              ))}
              {filtered ? (
                <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
                  Downloads use the filters you&apos;ve set.
                </p>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {!summary.compatible_versions && summary.versions.length > 1 && filters.version === null ? (
        <p className="rounded-lg border bg-muted/60 p-3 text-sm">
          The questions changed between versions, so these results show the latest version only.
          Pick another version to see its results.
        </p>
      ) : null}
    </header>
  )
}

function Overview({
  surveyId,
  summary,
  filters,
  onDepartment,
}: {
  surveyId: string
  summary: ResultsSummary
  filters: ResultFilters
  onDepartment: (department: string | null) => void
}) {
  const [downloading, setDownloading] = useState(false)
  const timeline = useQuery({
    queryKey: resultKeys.part(surveyId, 'timeline', filters),
    queryFn: ({ signal }) => getTimeline(surveyId, filters, signal),
    placeholderData: keepPreviousData,
  })
  const participation = useQuery({
    queryKey: resultKeys.part(surveyId, 'participation', filters),
    queryFn: ({ signal }) => getParticipation(surveyId, filters, signal),
    placeholderData: keepPreviousData,
  })
  const questions = useQuery({
    queryKey: resultKeys.part(surveyId, 'questions', filters),
    queryFn: ({ signal }) => getQuestions(surveyId, filters, signal),
    placeholderData: keepPreviousData,
  })
  const training = summary.kind === 'training'
  const figures = useQuery({
    queryKey: resultKeys.part(surveyId, 'training', filters),
    queryFn: ({ signal }) => getTrainingFigures(surveyId, filters, signal),
    placeholderData: keepPreviousData,
    enabled: training,
  })

  return (
    <div className="flex flex-col gap-6">
      {!training ? (
        <HeadlineTiles summary={summary} />
      ) : figures.data ? (
        <TrainingTiles figures={figures.data} />
      ) : figures.isError ? (
        <PanelState label="training figures" query={figures} />
      ) : (
        <HeadlineTilesSkeleton />
      )}
      {summary.small_group ? <SmallGroupNotice /> : null}
      <div className="grid gap-6 xl:grid-cols-2">
        {timeline.data ? (
          <DailyChart timeline={timeline.data} />
        ) : (
          <PanelState label="responses per day" query={timeline} />
        )}
        {participation.data ? (
          <ParticipationTable
            participation={participation.data}
            selected={filters.department}
            onSelect={onDepartment}
            canDownload={summary.can_download_non_responders}
            downloading={downloading}
            onDownload={() => {
              setDownloading(true)
              downloadNonResponders(surveyId, filters, summary.title.trim() || UNTITLED_SURVEY)
                .catch(() => {
                  // The API client already showed what went wrong.
                })
                .finally(() => {
                  setDownloading(false)
                })
            }}
          />
        ) : (
          <PanelState label="participation" query={participation} />
        )}
      </div>
      {training ? (
        figures.data ? (
          <TrainingPanels figures={figures.data} />
        ) : figures.isError ? null : (
          <TrainingSkeleton />
        )
      ) : null}
      {summary.small_group ? null : questions.data ? (
        questions.data.small_group ? null : (
          <QuestionResults surveyId={surveyId} filters={filters} result={questions.data} />
        )
      ) : questions.isError ? (
        <PanelState label="question results" query={questions} />
      ) : (
        <QuestionResultsSkeleton />
      )}
    </div>
  )
}

function PanelState({
  label,
  query,
}: {
  label: string
  query: { isError: boolean; refetch: () => Promise<unknown> }
}) {
  if (query.isError) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border bg-card p-6 text-center">
        <p className="text-sm">We couldn&apos;t load the {label}.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void query.refetch()
          }}
        >
          Try again
        </Button>
      </div>
    )
  }
  return (
    <div className="min-h-72 rounded-xl border bg-card p-5" aria-hidden="true">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="mt-2 h-4 w-32" />
      <Skeleton className="mt-6 h-44 w-full" />
    </div>
  )
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading results">
      <Skeleton className="h-4 w-20" />
      <div>
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-16 w-full" />
      <HeadlineTilesSkeleton />
      <QuestionResultsSkeleton />
    </div>
  )
}
