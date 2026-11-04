import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'

import { ForbiddenPage } from '@/app/pages/ForbiddenPage'
import { EmptyState } from '@/components/empty-state'
import { PageLoader } from '@/components/page-loader'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/skip-link'
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
import { AudienceTab } from '@/features/audience/AudienceTab'
import { SettingsTab } from '@/features/settings/SettingsTab'
import type { Issue } from '@/features/survey-logic/validation'
import {
  closeSurvey,
  getSurvey,
  publishSurvey,
  surveyKeys,
  validateSurvey,
} from '@/features/surveys/api'
import { SurveyNotFoundPage } from '@/features/surveys/SurveyNotFoundPage'
import { UNTITLED_SURVEY, type SurveyDetail, type SurveyStatus } from '@/features/surveys/types'
import { ThemeTab } from '@/features/theme/ThemeTab'
import { usePageTitle } from '@/hooks/use-page-title'
import { ApiError } from '@/lib/api'
import { shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { BuilderTopBar, type BuilderMode } from './BuilderTopBar'
import { FocusManager } from './FocusManager'
import { PreviewPane } from './PreviewPane'
import { SectionList } from './SectionList'
import { useBuilderStore } from './store'
import { SurveyHeaderCard } from './SurveyHeaderCard'
import { useAutosave } from './use-autosave'

/** /admin/surveys/:surveyId/edit — the survey builder. */
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

  // Start fresh next time, and let the surveys list pick up the new title and status.
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
            level={1}
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

const TABS = [
  { value: 'questions', label: 'Questions' },
  { value: 'theme', label: 'Theme' },
  { value: 'settings', label: 'Settings' },
  { value: 'audience', label: 'Audience' },
] as const
type Tab = (typeof TABS)[number]['value']

function isTab(value: string | null): value is Tab {
  return TABS.some((tab) => tab.value === value)
}

interface Lifecycle {
  status: SurveyStatus
  versionNo: number | null
  hasUnpublishedChanges: boolean
}

function BuilderEditor({ survey, onReload }: { survey: SurveyDetail; onReload: () => void }) {
  const load = useBuilderStore((s) => s.load)
  const ready = useBuilderStore(
    (s) => s.surveyId === survey.id && s.loadToken === survey.draft_updated_at,
  )
  const title = useBuilderStore((s) => (ready ? s.draft.title : survey.title))
  const autosave = useAutosave(survey.id, survey.draft_updated_at)
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: Tab = isTab(tabParam) ? tabParam : 'questions'
  const mode: BuilderMode = params.get('mode') === 'preview' ? 'preview' : 'edit'
  const [lifecycle, setLifecycle] = useState<Lifecycle>({
    status: survey.status,
    versionNo: survey.version_no,
    hasUnpublishedChanges: survey.has_unpublished_changes,
  })
  const [publishing, setPublishing] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const header = useRef<HTMLElement>(null)
  const [headerHeight, setHeaderHeight] = useState(57)
  usePageTitle(`Edit: ${title.trim() || UNTITLED_SURVEY}`)

  useLayoutEffect(() => {
    load(survey.id, survey.draft, survey.draft_updated_at)
  }, [load, survey])

  // Keep sticky elements (the preview's progress bar) just below the top bar.
  useLayoutEffect(() => {
    const element = header.current
    if (!element) return undefined
    const observer = new ResizeObserver(() => {
      setHeaderHeight(element.getBoundingClientRect().height)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [ready])

  // Any edit after publishing means there are changes to publish.
  useEffect(
    () =>
      useBuilderStore.subscribe((state, previous) => {
        if (state.revision !== previous.revision && state.revision > 0) {
          setLifecycle((current) =>
            current.status === 'draft' || current.hasUnpublishedChanges
              ? current
              : { ...current, hasUnpublishedChanges: true },
          )
        }
      }),
    [],
  )

  const navigate = (next: { tab?: Tab; mode?: BuilderMode }) => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        const nextTab = next.tab ?? tab
        const nextMode = next.mode ?? mode
        if (nextTab === 'questions') updated.delete('tab')
        else updated.set('tab', nextTab)
        if (nextMode === 'edit') updated.delete('mode')
        else updated.set('mode', nextMode)
        return updated
      },
      { replace: true },
    )
    window.scrollTo({ top: 0 })
  }

  const showFirstIssue = (issues: Issue[]) => {
    const store = useBuilderStore.getState()
    store.setIssues(issues)
    const first = issues[0]
    if (!first) return
    if (first.code === 'audience_empty') {
      navigate({ tab: 'audience', mode: 'edit' })
    } else if (first.code === 'theme_image_missing') {
      navigate({ tab: 'theme', mode: 'edit' })
    } else if (first.code === 'dates_order') {
      navigate({ tab: 'settings', mode: 'edit' })
    } else if (first.question_key) {
      navigate({ tab: 'questions', mode: 'edit' })
      const question = store.draft.questions.find((q) => q.key === first.question_key)
      if (question && store.collapsed.has(question.section_key))
        store.toggleCollapsed(question.section_key)
      store.setOpen(first.question_key)
      store.requestFocus(`[data-question-head="${first.question_key}"]`)
    } else if (first.section_key) {
      navigate({ tab: 'questions', mode: 'edit' })
      if (store.collapsed.has(first.section_key)) store.toggleCollapsed(first.section_key)
      store.requestFocus(`[data-section-title="${first.section_key}"]`)
    } else {
      navigate({ tab: 'questions', mode: 'edit' })
      store.requestFocus('[data-add-question]')
    }
    toast.error(
      `Fix ${String(issues.length)} issue${issues.length > 1 ? 's' : ''} before publishing. ${first.message}`,
    )
  }

  const publish = async () => {
    setPublishing(true)
    try {
      if (!(await autosave.flush())) {
        toast.error(
          "Your latest changes aren't saved yet, so they can't be published. Try again in a moment.",
        )
        return
      }
      const { issues, warnings } = await validateSurvey(survey.id)
      if (issues.length) {
        showFirstIssue(issues)
        return
      }
      for (const warning of warnings) toast.warning(warning.message)
      const result = await publishSurvey(survey.id)
      useBuilderStore.getState().setIssues([])
      setLifecycle({
        status: result.status,
        versionNo: result.version_no,
        hasUnpublishedChanges: false,
      })
      if (result.version_no > 1) {
        toast.success(
          `Published version ${String(result.version_no)}. Earlier responses stay linked to version ${String(result.version_no - 1)}.`,
        )
      } else {
        const opens = useBuilderStore.getState().draft.settings.opens_at
        const today = new Date().toISOString().slice(0, 10)
        toast.success(
          opens && opens > today
            ? `Published. Employees can respond from ${shortDate(opens)}.`
            : 'Published. Employees can respond now.',
        )
      }
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 422 &&
        Array.isArray(error.details.issues)
      ) {
        showFirstIssue(error.details.issues as Issue[])
      } else if (error instanceof ApiError && error.status === 409) {
        toast.error(error.message)
      }
      // Other failures already showed the API client's toast.
    } finally {
      setPublishing(false)
    }
  }

  const close = async () => {
    try {
      const result = await closeSurvey(survey.id)
      setLifecycle((current) => ({ ...current, status: result.status }))
      toast.success('Survey closed. No new responses will be accepted.')
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) toast.error(error.message)
    } finally {
      setConfirmClose(false)
    }
  }

  const { status, versionNo, hasUnpublishedChanges } = lifecycle
  let publishLabel = 'Publish'
  let publishShortLabel = 'Publish'
  let publishDisabled = false
  if (status === 'closed') {
    publishLabel = publishShortLabel = 'Closed'
    publishDisabled = true
  } else if (status === 'published' && !hasUnpublishedChanges) {
    publishLabel = publishShortLabel = 'Published'
    publishDisabled = true
  } else if (status === 'published') {
    publishLabel = 'Publish changes'
  }

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = TABS[(index + step + TABS.length) % TABS.length]
    if (!next) return
    navigate({ tab: next.value })
    document.getElementById(`tab-${next.value}`)?.focus()
  }

  if (!ready) return <PageLoader label="Loading survey…" />

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <BuilderTopBar
        ref={header}
        status={status}
        versionNo={versionNo}
        saveStatus={autosave.status}
        mode={mode}
        onModeChange={(next) => {
          navigate({ mode: next })
        }}
        publishLabel={publishLabel}
        publishShortLabel={publishShortLabel}
        publishDisabled={publishDisabled}
        publishing={publishing}
        onPublish={() => void publish()}
        onClose={
          status === 'published'
            ? () => {
                setConfirmClose(true)
              }
            : null
        }
      />
      {mode === 'edit' ? (
        <div className="border-b bg-card">
          <div
            role="tablist"
            aria-label="Survey parts"
            className="mx-auto flex max-w-[760px] gap-0.5 px-1.5 sm:px-5"
          >
            {TABS.map((item, index) => (
              <button
                key={item.value}
                id={`tab-${item.value}`}
                type="button"
                role="tab"
                aria-selected={tab === item.value}
                aria-controls="builder-panel"
                tabIndex={tab === item.value ? 0 : -1}
                className={cn(
                  'min-h-11 border-b-2 border-transparent px-3 font-semibold text-muted-foreground',
                  tab === item.value && 'border-primary text-foreground',
                )}
                onClick={() => {
                  navigate({ tab: item.value })
                }}
                onKeyDown={(event) => {
                  onTabKey(event, index)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
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
        {mode === 'preview' ? (
          <PreviewPane stickyTop={headerHeight} />
        ) : (
          <div id="builder-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'questions' ? (
              <>
                <SurveyHeaderCard />
                <SectionList />
              </>
            ) : tab === 'theme' ? (
              <ThemeTab />
            ) : tab === 'settings' ? (
              <SettingsTab />
            ) : (
              <AudienceTab />
            )}
          </div>
        )}
      </main>
      <FocusManager />
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this survey?</AlertDialogTitle>
            <AlertDialogDescription>
              Employees won&apos;t be able to respond any more. Responses so far are kept. You
              can&apos;t reopen a closed survey.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it open</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void close()
              }}
            >
              Close survey
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
