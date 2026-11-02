import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardListIcon,
  CopyIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
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
import { Skeleton } from '@/components/ui/skeleton'
import { usePageTitle } from '@/hooks/use-page-title'
import {
  createSurvey,
  deleteSurvey,
  duplicateSurvey,
  listSurveys,
  surveyKeys,
} from '@/features/surveys/api'
import { StatusPill } from '@/features/surveys/StatusPill'
import { UNTITLED_SURVEY, type SurveyListItem } from '@/features/surveys/types'
import { relativeTime, shortDate } from '@/lib/format'

/** Surveys home for HR and admins: every survey you can see, plus "New survey". */
export function SurveysHomePage() {
  usePageTitle('Surveys')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const surveys = useQuery({
    queryKey: surveyKeys.all,
    queryFn: ({ signal }) => listSurveys(signal),
  })

  const create = useMutation({
    mutationFn: createSurvey,
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
      New survey
    </Button>
  )

  return (
    <>
      <PageHeader
        title="Surveys"
        description="Surveys you own, co-own or can view results for."
        actions={surveys.data?.length ? newSurveyButton : undefined}
      />
      {surveys.isPending ? (
        <ul className="flex flex-col gap-3" aria-label="Loading surveys">
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
          title="We couldn't load your surveys"
          description="Check your connection, then try again."
          action={<Button onClick={() => void surveys.refetch()}>Try again</Button>}
        />
      ) : surveys.data.length === 0 ? (
        <EmptyState
          icon={ClipboardListIcon}
          title="No surveys yet"
          description="Create your first survey. It saves as you go, and nobody sees it until you publish."
          action={newSurveyButton}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {surveys.data.map((survey) => (
            <SurveyRow key={survey.id} survey={survey} />
          ))}
        </ul>
      )}
    </>
  )
}

function SurveyRow({ survey }: { survey: SurveyListItem }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const title = survey.title.trim() || UNTITLED_SURVEY

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
      queryClient.setQueryData<SurveyListItem[]>(surveyKeys.all, (old) =>
        old?.filter((s) => s.id !== survey.id),
      )
      void queryClient.invalidateQueries({ queryKey: surveyKeys.all })
      toast.success(`Deleted “${title}”.`)
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
      </div>
      <div className="flex flex-wrap gap-1.5">
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
