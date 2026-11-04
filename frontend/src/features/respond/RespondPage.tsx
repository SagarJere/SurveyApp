import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClockIcon,
  CalendarXIcon,
  CloudOffIcon,
  LockIcon,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { usePageTitle } from '@/hooks/use-page-title'
import { ApiError } from '@/lib/api'

import { getRespondentSurvey, respondKeys, submitAnswers, type RespondentSurvey } from './api'
import { SurveyForm, type SubmitOutcome } from './form/SurveyForm'
import type { AssetResolver } from './form/theme-utils'
import { useDraftAutosave, type DraftState } from './use-draft-autosave'

const SAVE_LABELS: Record<DraftState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved yet',
}

const SCREENS: Record<string, LucideIcon> = {
  NOT_IN_AUDIENCE: LockIcon,
  NOT_OPEN_YET: CalendarClockIcon,
  SURVEY_CLOSED: CalendarXIcon,
}

function retryable(failures: number, error: unknown): boolean {
  return failures < 2 && error instanceof ApiError && (error.isNetworkError || error.isServerError)
}

/** /s/:surveyId — take a survey. */
export function RespondPage() {
  const { surveyId = '' } = useParams()
  const query = useQuery({
    queryKey: respondKeys.survey(surveyId),
    queryFn: ({ signal }) => getRespondentSurvey(surveyId, signal),
    // The form owns the answers once loaded; don't swap the survey out from under it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: retryable,
  })
  const title = query.data?.title.trim() ?? ''
  usePageTitle(title.length > 0 ? title : 'Survey')

  if (query.isPending) return <PageLoader label="Loading survey…" />
  if (query.isError) {
    const error = query.error instanceof ApiError ? query.error : null
    const code = error?.code ?? ''
    const known = code in SCREENS || error?.status === 404 || error?.status === 403
    return (
      <EmptyState
        level={1}
        icon={known ? (SCREENS[code] ?? LockIcon) : CloudOffIcon}
        title={
          known
            ? (error?.message ?? "This survey isn't available to you.")
            : "We couldn't load this survey"
        }
        description={known ? undefined : 'Check your connection, then try again.'}
        action={
          known ? (
            <Button variant="outline" asChild>
              <Link to="/">Go to My surveys</Link>
            </Button>
          ) : (
            <Button onClick={() => void query.refetch()}>Try again</Button>
          )
        }
      />
    )
  }

  return (
    <LiveSurvey
      // A different version or state (after a refetch) starts the form afresh.
      key={`${String(query.data.version_no)}:${query.data.participation.status}`}
      survey={query.data}
      onReload={() => void query.refetch()}
    />
  )
}

function LiveSurvey({ survey, onReload }: { survey: RespondentSurvey; onReload: () => void }) {
  const queryClient = useQueryClient()
  const { participation } = survey
  const [allowed, setAllowed] = useState({
    canEdit: participation.can_edit,
    canRespondAgain: participation.can_respond_again,
  })
  const locked =
    participation.status === 'submitted' &&
    !participation.can_edit &&
    !participation.can_respond_again
  const autosave = useDraftAutosave(survey.survey_id, !locked)

  useEffect(() => {
    if (participation.draft_updated) {
      toast.info('This survey was updated. Your answers have been kept where possible.')
    }
  }, [participation.draft_updated])

  const assets: AssetResolver = useCallback(
    (id) => (id ? (survey.assets[id] ?? null) : null),
    [survey.assets],
  )
  const content = useMemo(
    () => ({
      title: survey.title,
      description: survey.description,
      settings: survey.settings,
      theme: survey.theme,
      sections: survey.sections,
      questions: survey.questions,
    }),
    [survey],
  )

  const submit = async (answers: Parameters<typeof submitAnswers>[1]): Promise<SubmitOutcome> => {
    autosave.cancel()
    try {
      const result = await submitAnswers(survey.survey_id, answers)
      setAllowed({ canEdit: result.can_edit, canRespondAgain: result.can_respond_again })
      void queryClient.invalidateQueries({ queryKey: respondKeys.mine })
      return undefined
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.status === 422 && Array.isArray(error.details.issues)) {
        toast.error(error.message)
        const issues = error.details.issues as { question_key?: string; message: string }[]
        return {
          errors: Object.fromEntries(
            issues.filter((i) => i.question_key).map((i) => [i.question_key ?? '', i.message]),
          ),
        }
      }
      if (error.code === 'ALREADY_SUBMITTED') {
        setAllowed({ canEdit: false, canRespondAgain: false })
        return undefined
      }
      toast.error(error.message)
      if (error.status === 410 || error.status === 403) onReload()
      throw error
    }
  }

  return (
    <SurveyForm
      survey={content}
      assets={assets}
      initialAnswers={participation.answers}
      initiallySubmitted={participation.status === 'submitted'}
      onAnswersChange={autosave.queue}
      status={SAVE_LABELS[autosave.state] || undefined}
      canEditAfterSubmit={allowed.canEdit}
      canRespondAgain={allowed.canRespondAgain}
      onSubmit={submit}
    />
  )
}
