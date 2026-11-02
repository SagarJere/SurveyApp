import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { PageLoader } from '@/components/page-loader'
import { SkipLink, MAIN_CONTENT_ID } from '@/components/skip-link'
import { Button } from '@/components/ui/button'
import { ForbiddenPage } from '@/app/pages/ForbiddenPage'
import { usePageTitle } from '@/hooks/use-page-title'
import { getSurvey, surveyKeys, validateSurvey } from '@/features/surveys/api'
import { SurveyNotFoundPage } from '@/features/surveys/SurveyNotFoundPage'
import { UNTITLED_SURVEY, type SurveyDetail } from '@/features/surveys/types'
import { ApiError } from '@/lib/api'

import { BuilderTopBar } from './BuilderTopBar'
import { FocusManager } from './FocusManager'
import { SectionList } from './SectionList'
import { useBuilderStore } from './store'
import { SurveyHeaderCard } from './SurveyHeaderCard'
import { useAutosave } from './use-autosave'

/** /admin/surveys/:surveyId/edit — the survey builder (Questions). */
export function BuilderPage() {
  const { surveyId = '' } = useParams()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: surveyKeys.detail(surveyId),
    queryFn: ({ signal }) => getSurvey(surveyId, signal),
    // The builder owns the draft once loaded: never swap it out from under the person.
    staleTime: Infinity,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  // Start fresh next time, and let the surveys list pick up the new title.
  useEffect(
    () => () => {
      queryClient.removeQueries({ queryKey: surveyKeys.detail(surveyId) })
      void queryClient.invalidateQueries({ queryKey: surveyKeys.all })
    },
    [queryClient, surveyId],
  )

  if (query.isPending) return <PageLoader label="Loading survey…" />
  if (query.isError) {
    const status = query.error instanceof ApiError ? query.error.status : null
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        {status === 404 || status === 422 ? (
          <SurveyNotFoundPage />
        ) : (
          <EmptyState
            icon={TriangleAlertIcon}
            title="We couldn't load this survey"
            description="Check your connection, then try again."
            action={
              <Button
                onClick={() => {
                  void query.refetch()
                }}
              >
                Try again
              </Button>
            }
          />
        )}
      </div>
    )
  }
  if (!query.data.can_edit) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ForbiddenPage />
      </div>
    )
  }

  // A new draft_updated_at (after "Reload") remounts the editor with the fresh draft.
  return (
    <BuilderEditor
      key={query.data.draft_updated_at}
      survey={query.data}
      onReload={() => {
        void query.refetch()
      }}
    />
  )
}

function BuilderEditor({ survey, onReload }: { survey: SurveyDetail; onReload: () => void }) {
  const load = useBuilderStore((s) => s.load)
  const ready = useBuilderStore(
    (s) => s.surveyId === survey.id && s.loadToken === survey.draft_updated_at,
  )
  const title = useBuilderStore((s) => (ready ? s.draft.title : survey.title))
  const autosave = useAutosave(survey.id, survey.draft_updated_at)
  const [checking, setChecking] = useState(false)
  usePageTitle(`Edit: ${title.trim() || UNTITLED_SURVEY}`)

  useLayoutEffect(() => {
    load(survey.id, survey.draft, survey.draft_updated_at)
  }, [load, survey])

  const check = async () => {
    setChecking(true)
    try {
      const saved = await autosave.flush()
      if (!saved) {
        toast.error(
          "Your latest changes aren't saved yet, so they can't be checked. Try again in a moment.",
        )
        return
      }
      const { issues } = await validateSurvey(survey.id)
      const store = useBuilderStore.getState()
      store.setIssues(issues)
      const first = issues[0]
      if (!first) {
        toast.success('No issues found. This survey is ready to publish.')
        return
      }
      if (first.question_key) {
        const question = store.draft.questions.find((q) => q.key === first.question_key)
        if (question && store.collapsed.has(question.section_key)) {
          store.toggleCollapsed(question.section_key)
        }
        store.setOpen(first.question_key)
        store.requestFocus(`[data-question-head="${first.question_key}"]`)
      } else if (first.section_key) {
        if (store.collapsed.has(first.section_key)) store.toggleCollapsed(first.section_key)
        store.requestFocus(`[data-section-title="${first.section_key}"]`)
      }
      toast.error(
        `Fix ${issues.length} issue${issues.length > 1 ? 's' : ''} before publishing. ${first.message}`,
      )
    } catch {
      // The API client already showed a toast for network and server errors.
    } finally {
      setChecking(false)
    }
  }

  if (!ready) return <PageLoader label="Loading survey…" />

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <BuilderTopBar
        status={survey.status}
        versionNo={survey.version_no}
        saveStatus={autosave.status}
        checking={checking}
        onCheck={() => void check()}
      />
      {autosave.status === 'conflict' ? (
        <div className="border-b bg-warn-soft text-warn" role="alert">
          <div className="mx-auto flex max-w-[760px] flex-wrap items-center gap-3 px-3 py-2.5 text-sm font-semibold sm:px-5">
            <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              Someone else edited this survey. Reload to see their changes. Your latest edits here
              weren&apos;t saved.
            </span>
            <Button size="sm" variant="outline" onClick={onReload}>
              <RefreshCwIcon aria-hidden="true" />
              Reload
            </Button>
          </div>
        </div>
      ) : null}
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-[760px] flex-1 px-3 pt-4 pb-32 outline-none sm:px-5 sm:pt-6"
      >
        <SurveyHeaderCard />
        <SectionList />
      </main>
      <FocusManager />
    </div>
  )
}
