import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3Icon,
  ClipboardListIcon,
  ClockIcon,
  CopyIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SearchXIcon,
  Share2Icon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { usePageTitle } from '@/hooks/use-page-title'
import {
  closeSurvey,
  createSurvey,
  deleteSurvey,
  duplicateSurvey,
  listSurveys,
  surveyKeys,
} from '@/features/surveys/api'
import { ShareSurveyDialog } from '@/features/surveys/ShareSurveyDialog'
import { StatusPill } from '@/features/surveys/StatusPill'
import {
  UNTITLED_SURVEY,
  UNTITLED_TRAINING,
  type SurveyKind,
  type SurveyListItem,
} from '@/features/surveys/types'
import { relativeTime, shortDate } from '@/lib/format'

import { closingSoon, dueText, filterSurveys, homeKpis, type StatusFilter } from './home-stats'
import { RateRing } from './RateRing'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'closed', label: 'Closed' },
]

const COPY = {
  survey: {
    title: 'Surveys',
    description: 'Surveys you own, co-own or can view results for.',
    create: 'New survey',
    loading: 'Loading surveys',
    error: "We couldn't load your surveys",
    emptyTitle: 'No surveys yet',
    emptyText:
      'Create your first survey. It saves as you go, and nobody sees it until you publish.',
  },
  training: {
    title: 'Trainings',
    description:
      'Video trainings with a quiz. Employees watch each video, then answer its questions.',
    create: 'New training',
    loading: 'Loading trainings',
    error: "We couldn't load your trainings",
    emptyTitle: 'No trainings yet',
    emptyText:
      'Create your first training: add videos, then the questions people answer after each one.',
  },
} as const

/** Trainings home: the surveys home for trainings (docs/09-trainings.md). */
export function TrainingsHomePage() {
  return <SurveysHomePage kind="training" />
}

/** Surveys home for HR and admins: every survey you can see, plus "New survey". */
export function SurveysHomePage({ kind = 'survey' }: { kind?: SurveyKind }) {
  const copy = COPY[kind]
  usePageTitle(copy.title)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const surveys = useQuery({
    queryKey: surveyKeys.list(kind),
    queryFn: ({ signal }) => listSurveys(kind, signal),
  })

  const create = useMutation({
    mutationFn: () => createSurvey(kind),
    onSuccess: (survey) => {
      void queryClient.invalidateQueries({ queryKey: surveyKeys.all })
      void navigate(`/admin/surveys/${survey.id}/edit`)
    },
  })

  const newSurveyButton = (
    <Button
      onClick={() => {
        create.mutate()
      }}
      disabled={create.isPending}
    >
      {create.isPending ? (
        <Loader2Icon className="animate-spin" aria-hidden="true" />
      ) : (
        <PlusIcon aria-hidden="true" />
      )}
      {copy.create}
    </Button>
  )

  return (
    <>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={surveys.data?.length ? newSurveyButton : undefined}
      />
      {surveys.isPending ? (
        <ul className="flex flex-col gap-3" aria-label={copy.loading}>
          {[0, 1, 2].map((i) => (
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
      ) : surveys.data.length === 0 ? (
        <EmptyState
          icon={ClipboardListIcon}
          title={copy.emptyTitle}
          description={copy.emptyText}
          action={newSurveyButton}
        />
      ) : (
        <SurveyList surveys={surveys.data} noun={kind === 'training' ? 'trainings' : 'surveys'} />
      )}
    </>
  )
}

function SurveyList({ surveys, noun }: { surveys: SurveyListItem[]; noun: string }) {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const kpis = homeKpis(surveys)
  const shown = filterSurveys(surveys, status, search)
  const training = noun === 'trainings'
  const rate = training ? kpis.averagePassRate : kpis.averageRate
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <Kpi label={`Live ${noun}`} value={String(kpis.live)} />
        <Kpi
          label={training ? 'Completed this week' : 'Responses this week'}
          value={new Intl.NumberFormat().format(kpis.responsesThisWeek)}
        />
        <Kpi
          label={training ? 'Average pass rate' : 'Average response rate'}
          value={rate === null ? '–' : `${String(Math.round(rate * 100))}%`}
        />
      </dl>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <label htmlFor="survey-search" className="sr-only">
            Search {noun}
          </label>
          <Input
            id="survey-search"
            type="search"
            className="pl-9"
            placeholder={`Search ${noun}`}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>
        <label htmlFor="survey-status" className="sr-only">
          Status
        </label>
        <NativeSelect
          id="survey-status"
          value={status}
          className="sm:w-44"
          onChange={(event) => {
            setStatus(event.target.value as StatusFilter)
          }}
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <p className="sr-only" role="status">
        {shown.length === surveys.length
          ? `${String(surveys.length)} ${noun}`
          : `${String(shown.length)} of ${String(surveys.length)} ${noun} match`}
      </p>
      {shown.length === 0 ? (
        <EmptyState
          icon={SearchXIcon}
          title={`No ${noun} match`}
          description="Try another search or status."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setStatus('all')
                setSearch('')
              }}
            >
              Show all {noun}
            </Button>
          }
        />
      ) : (
        <ul
          className="flex flex-col gap-3"
          aria-label={noun === 'trainings' ? 'Trainings' : 'Surveys'}
        >
          {shown.map((survey) => (
            <SurveyRow key={survey.id} survey={survey} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-heading text-3xl font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  )
}

function SurveyRow({ survey }: { survey: SurveyListItem }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [sharing, setSharing] = useState(false)
  const title =
    survey.title.trim() || (survey.kind === 'training' ? UNTITLED_TRAINING : UNTITLED_SURVEY)
  const published = survey.status !== 'draft'
  const closes = closingSoon(survey)
  const due = survey.kind === 'training' && survey.due_date ? dueText(survey.due_date) : null

  const duplicate = useMutation({
    mutationFn: () => duplicateSurvey(survey.id),
    onSuccess: (copy) => {
      void queryClient.invalidateQueries({ queryKey: surveyKeys.all })
      toast.success(`Made a copy of “${title}”.`)
      void navigate(`/admin/surveys/${copy.id}/edit`)
    },
  })

  const remove = useMutation({
    mutationFn: () => deleteSurvey(survey.id),
    onSuccess: () => {
      setConfirming(false)
      queryClient.setQueryData<SurveyListItem[]>(surveyKeys.list(survey.kind), (old) =>
        old?.filter((s) => s.id !== survey.id),
      )
      void queryClient.invalidateQueries({ queryKey: surveyKeys.all })
      toast.success(`Deleted “${title}”.`)
    },
  })

  const close = useMutation({
    mutationFn: () => closeSurvey(survey.id),
    onSuccess: () => {
      setConfirmingClose(false)
      void queryClient.invalidateQueries({ queryKey: surveyKeys.all })
      toast.success(`Closed “${title}”. No new responses will be accepted.`)
    },
    onError: () => {
      setConfirmingClose(false)
    },
  })

  const schedule =
    survey.opens_at && survey.closes_at
      ? `${shortDate(survey.opens_at)} – ${shortDate(survey.closes_at)}`
      : survey.closes_at
        ? `Closes ${shortDate(survey.closes_at)}`
        : survey.opens_at
          ? `Opens ${shortDate(survey.opens_at)}`
          : null

  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {survey.can_edit ? (
            <Link
              to={`/admin/surveys/${survey.id}/edit`}
              className="truncate font-heading text-lg font-semibold hover:underline"
            >
              {title}
            </Link>
          ) : (
            <span className="truncate font-heading text-lg font-semibold">{title}</span>
          )}
          <StatusPill status={survey.status} versionNo={survey.version_no} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Edited {relativeTime(survey.updated_at)}
          {schedule ? ` · ${schedule}` : ''}
        </p>
        {closes ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold">
            <ClockIcon className="size-4 text-warn" aria-hidden="true" />
            {closes}
          </p>
        ) : null}
        {due || (published && survey.pass_rate !== undefined && survey.pass_rate !== null) ? (
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            {published && survey.pass_rate !== null && survey.pass_rate !== undefined ? (
              <span>
                <span className="font-semibold text-foreground">
                  {Math.round(survey.pass_rate * 100)}% passed
                </span>{' '}
                ({survey.passed_count ?? 0} of {survey.response_count})
              </span>
            ) : null}
            {due ? <span>{due}</span> : null}
          </p>
        ) : null}
      </div>
      {published ? (
        survey.open_to_all ? (
          <p className="text-sm tabular-nums sm:w-28">
            <span className="block font-semibold">
              {new Intl.NumberFormat().format(survey.response_count)}
            </span>
            <span className="block text-xs text-muted-foreground">
              {survey.response_count === 1 ? 'response' : 'responses'}
            </span>
          </p>
        ) : (
          <RateRing
            className="sm:w-28"
            responded={survey.response_count}
            invited={survey.audience_count}
            rate={survey.response_rate}
          />
        )
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {survey.status === 'published' && survey.can_edit ? (
          <>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Share ${title}`}
              onClick={() => {
                setSharing(true)
              }}
            >
              <Share2Icon aria-hidden="true" />
              Share
            </Button>
            <ShareSurveyDialog
              open={sharing}
              onOpenChange={setSharing}
              surveyId={survey.id}
              title={survey.title}
              opensAt={survey.opens_at}
              closesAt={survey.closes_at}
              openToAll={survey.open_to_all}
            />
          </>
        ) : null}
        {published ? (
          <Button variant="outline" size="sm" asChild>
            <Link to={`/admin/surveys/${survey.id}/results`} aria-label={`Results for ${title}`}>
              <BarChart3Icon aria-hidden="true" />
              Results
            </Link>
          </Button>
        ) : null}
        {survey.can_edit ? (
          <Button variant="outline" size="sm" asChild>
            <Link to={`/admin/surveys/${survey.id}/edit`} aria-label={`Edit ${title}`}>
              <PencilIcon aria-hidden="true" />
              Edit
            </Link>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Duplicate ${title}`}
          disabled={duplicate.isPending}
          onClick={() => {
            duplicate.mutate()
          }}
        >
          <CopyIcon aria-hidden="true" />
          Duplicate
        </Button>
        {survey.status === 'published' && survey.can_edit ? (
          <AlertDialog open={confirmingClose} onOpenChange={setConfirmingClose}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Close ${title}`}
              onClick={() => {
                setConfirmingClose(true)
              }}
            >
              <LockIcon aria-hidden="true" />
              Close
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close “{title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  Employees won&apos;t be able to respond any more. Responses so far are kept. You
                  can&apos;t reopen a closed survey.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it open</AlertDialogCancel>
                <AlertDialogAction
                  disabled={close.isPending}
                  onClick={(event) => {
                    event.preventDefault()
                    close.mutate()
                  }}
                >
                  {close.isPending ? (
                    <Loader2Icon className="animate-spin" aria-hidden="true" />
                  ) : null}
                  Close survey
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        {survey.can_delete ? (
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete ${title}`}
              onClick={() => {
                setConfirming(true)
              }}
            >
              <Trash2Icon aria-hidden="true" />
              Delete
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This survey was never published, so no one has answered it. Deleting it can&apos;t
                  be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep survey</AlertDialogCancel>
                <AlertDialogAction
                  disabled={remove.isPending}
                  onClick={(event) => {
                    event.preventDefault()
                    remove.mutate()
                  }}
                >
                  {remove.isPending ? (
                    <Loader2Icon className="animate-spin" aria-hidden="true" />
                  ) : null}
                  Delete survey
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </li>
  )
}
