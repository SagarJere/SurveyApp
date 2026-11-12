/**
 * The respondent experience (docs/06-respondent-experience.md): the same component powers the
 * builder's Preview now and /s/:surveyId in Phase 4. Three layouts, conditions, the question
 * navigator, auto-next, money input and theme.
 */
import { CheckIcon, HomeIcon, Loader2Icon, LockIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { answerProblem } from '@/features/survey-logic/answers'
import { evaluate, isAnswered } from '@/features/survey-logic/conditions'
import type { Answers, Draft, Question, Section } from '@/features/survey-logic/types'
import { shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { VideoPlayer } from '@/features/video/VideoPlayer'

import { Navigator } from './Navigator'
import { QuestionBlock } from './QuestionBlock'
import { SurveyCover, SurveyStage } from './theme'
import { accentStyle, type AssetResolver } from './theme-utils'

export type SurveyContent = Pick<
  Draft,
  'title' | 'description' | 'settings' | 'theme' | 'sections' | 'questions'
>

/** What onSubmit can report back: nothing (it worked) or problems keyed by question key. */
export type SubmitOutcome = { errors: Record<string, string> } | undefined

interface SurveyFormProps {
  survey: SurveyContent
  assets: AssetResolver
  /** Called with the answers to visible questions only. Throw to stay on the form. */
  onSubmit: (answers: Answers) => Promise<SubmitOutcome> | SubmitOutcome
  /** Extra button on the thank-you screen (Preview: "Reset preview"). */
  onReset?: () => void
  /** The respondent's home page, offered on the thank-you screen. Not shown in Preview. */
  homeLink?: { to: string; label: string }
  /** Height of any sticky bar above the form, so the progress bar sticks below it. */
  stickyTop?: number
  /** Answers to start with (a saved draft, or a submitted response being edited). */
  initialAnswers?: Answers
  /** Start on the thank-you screen (they've already responded). */
  initiallySubmitted?: boolean
  /** Every change, with hidden answers already discarded (for autosave). */
  onAnswersChange?: (answers: Answers) => void
  /** Shown next to the progress label, e.g. "Saved". */
  status?: ReactNode
  /** Thank-you screen offers "Edit response". Default: the survey allows editing. */
  canEditAfterSubmit?: boolean
  /** Thank-you screen offers "Start another response". Default: one response is off. */
  canRespondAgain?: boolean
  /** Trainings: section key -> its video. A section's questions appear after its video ends. */
  videos?: Record<string, FormVideo>
  /** Trainings: how far this person got in each section's video. */
  videoProgress?: Record<string, { furthest_seconds: number; completed: boolean }>
  /** Trainings: progress while watching (completed = false) and when a video ends (true). */
  onVideoProgress?: (sectionKey: string, furthestSeconds: number, completed: boolean) => void
  /** Preview: offer "Skip video" so HR can test the questions without watching. */
  allowSkipVideos?: boolean
}

export interface FormVideo {
  url: string
  allow_seek: boolean
  allow_speed: boolean
}

const AUTO_NEXT_MS = 350
const AUTO_NEXT_TYPES = new Set(['single', 'dropdown', 'rating'])

interface Group {
  section: Section
  sectionNumber: number
  questions: Question[]
}

/** Where to continue a saved draft: the first unanswered visible question, or its page. */
function resumePosition(survey: SurveyContent, answers: Answers): number {
  const visibility = evaluate(survey, answers)
  const visible = survey.questions.filter((q) => visibility.visibleQuestions.includes(q.key))
  const firstOpen = visible.findIndex((q) => !isAnswered(answers[q.key]))
  if (firstOpen <= 0) return 0
  if (survey.settings.layout === 'step') return firstOpen
  if (survey.settings.layout === 'section') {
    const sectionsWithQuestions = survey.sections.filter((s) =>
      visible.some((q) => q.section_key === s.key),
    )
    const target = visible[firstOpen]?.section_key
    return Math.max(
      0,
      sectionsWithQuestions.findIndex((s) => s.key === target),
    )
  }
  return 0
}

export function SurveyForm({
  survey,
  assets,
  onSubmit,
  onReset,
  homeLink,
  stickyTop = 0,
  initialAnswers,
  initiallySubmitted = false,
  onAnswersChange,
  status,
  canEditAfterSubmit,
  canRespondAgain,
  videos,
  videoProgress,
  onVideoProgress,
  allowSkipVideos = false,
}: SurveyFormProps) {
  const { settings, theme } = survey
  const layout = settings.layout
  const [answers, setAnswers] = useState<Answers>(() =>
    initialAnswers ? evaluate(survey, initialAnswers).keptAnswers : {},
  )
  const [position, setPosition] = useState(() =>
    initialAnswers && !initiallySubmitted ? resumePosition(survey, initialAnswers) : 0,
  )
  const [direction, setDirection] = useState<'forward' | 'back' | null>(null)
  const [submitted, setSubmitted] = useState(initiallySubmitted)
  // Problems the server found on submit, until the person changes that answer.
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())
  // Trainings: sections whose video has been watched to the end (their questions are open).
  const [watched, setWatched] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        Object.entries(videoProgress ?? {})
          .filter(([, p]) => p.completed)
          .map(([key]) => key),
      ),
  )
  // Set by Next/Back; the next heading to mount takes focus (see focusOnMount).
  const pendingFocus = useRef(false)
  const topRef = useRef<HTMLDivElement>(null)
  const autoNextTimer = useRef<number | undefined>(undefined)
  const moved = useRef(false)

  const visibility = useMemo(() => evaluate(survey, answers), [survey, answers])
  const visibleKeys = useMemo(() => new Set(visibility.visibleQuestions), [visibility])
  const visible = useMemo(
    () => survey.questions.filter((q) => visibleKeys.has(q.key)),
    [survey.questions, visibleKeys],
  )
  const numberOf = useMemo(() => new Map(visible.map((q, i) => [q.key, i + 1])), [visible])
  const groups: Group[] = useMemo(
    () =>
      survey.sections
        .map((section, index) => ({
          section,
          sectionNumber: index + 1,
          questions: visible.filter((q) => q.section_key === section.key),
        }))
        .filter(
          (group) =>
            group.questions.length > 0 ||
            (videos?.[group.section.key] !== undefined &&
              visibility.visibleSections.includes(group.section.key)),
        ),
    [survey.sections, visible, videos, visibility],
  )
  /** A section with a video that hasn't been watched to the end yet. */
  const locked = (sectionKey: string) =>
    videos?.[sectionKey] !== undefined && !watched.has(sectionKey)
  const multiSection = survey.sections.length > 1
  const staged =
    theme.background_style === 'color' ||
    (theme.background_style === 'image' && assets(theme.background) !== null)
  const blocking = (q: Question) =>
    locked(q.section_key) || answerProblem(q, answers[q.key]) !== null
  const lockedCount = visible.filter((q) => locked(q.section_key)).length
  const firstBlocked = visible.findIndex(blocking)
  const anyBlocked = firstBlocked !== -1

  const lastIndex = layout === 'section' ? groups.length - 1 : visible.length - 1
  const current = Math.max(0, Math.min(position, Math.max(lastIndex, 0)))

  const go = useCallback((next: number, dir: 'forward' | 'back') => {
    window.clearTimeout(autoNextTimer.current)
    moved.current = true
    pendingFocus.current = true
    setDirection(dir)
    setPosition(next)
  }, [])

  // After Next/Back on the section layout, start the new page at the top.
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    if (layout === 'section') topRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [current, layout])

  // After Next/Back, focus moves to the new question (or page) heading as it appears.
  const focusOnMount = useCallback(
    (element: HTMLHeadingElement | null) => {
      if (!element || !pendingFocus.current) return
      pendingFocus.current = false
      element.focus({ preventScroll: layout !== 'step' })
    },
    [layout],
  )

  useEffect(
    () => () => {
      window.clearTimeout(autoNextTimer.current)
    },
    [],
  )

  const cancelAutoNext = useCallback(() => {
    window.clearTimeout(autoNextTimer.current)
  }, [])
  const scheduleAutoNext = useCallback(
    (target: number) => {
      window.clearTimeout(autoNextTimer.current)
      autoNextTimer.current = window.setTimeout(() => {
        go(target, 'forward')
      }, AUTO_NEXT_MS)
    },
    [go],
  )

  const answer = (question: Question, value: unknown) => {
    const next = evaluate(survey, { ...answers, [question.key]: value }).keptAnswers
    setAnswers(next)
    onAnswersChange?.(next)
    if (question.key in errors) {
      setErrors(({ [question.key]: _, ...rest }) => rest)
    }
    // Questions this answer revealed fade in briefly.
    const nowVisible = evaluate(survey, next).visibleQuestions
    setRevealed(new Set(nowVisible.filter((key) => !visibleKeys.has(key))))
    if (layout === 'step' && settings.auto_next && AUTO_NEXT_TYPES.has(question.type)) {
      const index = visible.indexOf(question)
      const stillVisible = evaluate(survey, next).visibleQuestions
      if (index < stillVisible.length - 1 && answerProblem(question, value) === null) {
        scheduleAutoNext(index + 1)
      } else {
        cancelAutoNext()
      }
    }
  }

  /** After a failed submit: go to the first question with a problem and focus it. */
  const showFirstError = (found: Record<string, string>) => {
    const index = visible.findIndex((q) => q.key in found)
    const question = visible[index]
    if (!question) return
    if (layout === 'step') {
      go(index, index > current ? 'forward' : 'back')
      return
    }
    if (layout === 'section') {
      const page = groups.findIndex((g) => g.questions.includes(question))
      if (page !== current) go(page, page > current ? 'forward' : 'back')
    }
    window.requestAnimationFrame(() => {
      const heading = document.getElementById(`q-title-${question.key}`)
      heading?.scrollIntoView({ block: 'center' })
      heading?.focus({ preventScroll: true })
    })
  }

  const submit = async () => {
    if (anyBlocked || submitting) return
    setSubmitting(true)
    try {
      const outcome = await onSubmit(visibility.keptAnswers)
      if (outcome && Object.keys(outcome.errors).length) {
        setErrors(outcome.errors)
        showFirstError(outcome.errors)
        return
      }
      setErrors({})
      setSubmitted(true)
      topRef.current?.scrollIntoView({ block: 'start' })
    } finally {
      setSubmitting(false)
    }
  }

  const block = (question: Question, options: { large?: boolean; focus?: boolean } = {}) => (
    <QuestionBlock
      key={question.key}
      ref={options.focus ? focusOnMount : undefined}
      question={question}
      number={numberOf.get(question.key) ?? 0}
      value={answers[question.key]}
      serverError={errors[question.key]}
      onChange={(value) => {
        answer(question, value)
      }}
      reveal={revealed.has(question.key)}
      large={options.large}
      // One-question layout shows the section as a label, not a heading, so questions are h2 there.
      headingLevel={multiSection && layout !== 'step' ? 3 : 2}
      className={
        options.large && direction
          ? direction === 'forward'
            ? 'animate-step-forward'
            : 'animate-step-back'
          : undefined
      }
    />
  )

  const markWatched = (sectionKey: string, furthestSeconds: number) => {
    setWatched((current) => new Set(current).add(sectionKey))
    onVideoProgress?.(sectionKey, furthestSeconds, true)
  }

  /** A section's video, and while it's unwatched, a note in place of its questions. */
  const videoBlock = (sectionKey: string, title: string, questionCount: number) => {
    const video = videos?.[sectionKey]
    if (!video) return null
    const isLocked = locked(sectionKey)
    return (
      <div className="flex flex-col gap-3 pt-4 pb-2">
        <VideoPlayer
          key={sectionKey}
          src={video.url}
          title={title}
          allowSeek={video.allow_seek}
          allowSpeed={video.allow_speed}
          completed={!isLocked}
          startAt={videoProgress?.[sectionKey]?.furthest_seconds ?? 0}
          onProgress={(seconds) => {
            onVideoProgress?.(sectionKey, seconds, false)
          }}
          onEnded={(seconds) => {
            markWatched(sectionKey, seconds)
          }}
          onSkip={
            allowSkipVideos
              ? () => {
                  markWatched(sectionKey, 0)
                }
              : undefined
          }
        />
        {isLocked && questionCount > 0 ? (
          <p
            className="flex items-center gap-2.5 rounded-xl border border-dashed bg-muted px-3.5 py-3 text-sm"
            role="status"
          >
            <LockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <b>
                {questionCount} question{questionCount === 1 ? '' : 's'}
              </b>{' '}
              appear{questionCount === 1 ? 's' : ''} when the video ends.
            </span>
          </p>
        ) : null}
      </div>
    )
  }

  /** A section's name for the video player's label. */
  const sectionName = (sectionKey: string) => {
    const index = survey.sections.findIndex((s) => s.key === sectionKey)
    const title = survey.sections[index]?.title.trim() ?? ''
    return title.length > 0 ? title : `Section ${String(index + 1)}`
  }

  const sectionHeader = (group: Group, index: number, total: number, focus = false) => (
    <div className="pt-6 pb-1">
      <span className="text-xs font-bold tracking-wider text-(--survey-accent) uppercase dark:brightness-150">
        Section {index + 1} of {total}
      </span>
      <h2
        ref={focus ? focusOnMount : undefined}
        tabIndex={-1}
        className="mt-1 text-[22px] leading-tight font-semibold outline-none"
      >
        {group.section.title.trim() || 'Untitled section'}
      </h2>
      {group.section.description.trim() ? (
        <p className="mt-1 text-muted-foreground">{group.section.description}</p>
      ) : null}
    </div>
  )

  // --- progress and footer state, per layout ------------------------------------------------
  const answeredCount = visible.filter((q) => isAnswered(answers[q.key])).length
  let progress = 0
  let progressLabel = ''
  let body: React.ReactNode
  let footer: React.ReactNode

  const submitButton = (disabled: boolean) => (
    <Button
      size="lg"
      className="bg-(--survey-accent) text-(--survey-accent-foreground) hover:bg-(--survey-accent) hover:brightness-110"
      disabled={disabled || submitting}
      onClick={() => void submit()}
    >
      {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
      Submit response
    </Button>
  )
  if (layout === 'all') {
    const missing = visible.filter(blocking).length
    progress = visible.length ? answeredCount / visible.length : 0
    progressLabel = `${String(answeredCount)} of ${String(visible.length)} answered`
    body = groups.map((group, index) => (
      <div key={group.section.key}>
        {multiSection ? sectionHeader(group, index, groups.length) : null}
        {videoBlock(group.section.key, sectionName(group.section.key), group.questions.length)}
        {locked(group.section.key) ? null : group.questions.map((q) => block(q))}
      </div>
    ))
    footer = (
      <>
        {submitButton(missing > 0)}
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {lockedCount
            ? 'Watch each video to see its questions'
            : missing
              ? `${String(missing)} required question${missing > 1 ? 's' : ''} left`
              : 'All set'}
        </span>
      </>
    )
  } else if (layout === 'section') {
    const group = groups[current]
    const onPage = group?.questions ?? []
    const missingOnPage = onPage.filter(blocking).length
    const pageFraction = onPage.length
      ? onPage.filter((q) => isAnswered(answers[q.key])).length / onPage.length
      : 0
    const last = current >= groups.length - 1
    progress = groups.length ? (current + pageFraction) / groups.length : 0
    progressLabel = `Section ${String(current + 1)} of ${String(groups.length)}`
    body = group ? (
      <div
        key={group.section.key}
        className={
          direction
            ? direction === 'forward'
              ? 'animate-step-forward'
              : 'animate-step-back'
            : undefined
        }
      >
        {multiSection ? sectionHeader(group, current, groups.length, true) : null}
        {videoBlock(group.section.key, sectionName(group.section.key), onPage.length)}
        {locked(group.section.key)
          ? null
          : onPage.map((q, i) => block(q, { focus: !multiSection && i === 0 }))}
      </div>
    ) : null
    footer = (
      <>
        <BackButton
          disabled={current === 0}
          onClick={() => {
            go(current - 1, 'back')
          }}
        />
        <span className="flex-1 text-center text-sm text-muted-foreground" aria-live="polite">
          {group && locked(group.section.key)
            ? 'Watch the video to continue'
            : missingOnPage
              ? `${String(missingOnPage)} required question${missingOnPage > 1 ? 's' : ''} left on this page`
              : ''}
        </span>
        {last ? (
          submitButton(missingOnPage > 0 || anyBlocked)
        ) : (
          <NextButton
            disabled={missingOnPage > 0}
            onClick={() => {
              go(current + 1, 'forward')
            }}
          />
        )}
      </>
    )
  } else {
    const question = visible[current]
    const stuck = question ? blocking(question) : false
    // The video sits on the step of its section's first question; the question waits for it.
    const firstOfSection =
      question !== undefined &&
      (current === 0 || visible[current - 1]?.section_key !== question.section_key)
    const questionLocked = question !== undefined && locked(question.section_key)
    const last = current >= visible.length - 1
    const sectionTitle =
      question && multiSection
        ? (survey.sections.find((s) => s.key === question.section_key)?.title.trim() ?? '') ||
          'Untitled section'
        : null
    progress = visible.length
      ? (current + (question && isAnswered(answers[question.key]) ? 1 : 0)) / visible.length
      : 0
    progressLabel = `Question ${String(current + 1)} of ${String(visible.length)}`
    body = question ? (
      <div className="min-h-[230px] pt-2">
        {sectionTitle ? (
          <p className="-mb-3 pt-4.5 text-xs font-bold tracking-wider text-(--survey-accent) uppercase dark:brightness-150">
            {sectionTitle}
          </p>
        ) : null}
        {firstOfSection
          ? videoBlock(
              question.section_key,
              sectionName(question.section_key),
              visible.filter((q) => q.section_key === question.section_key).length,
            )
          : null}
        {questionLocked ? null : block(question, { large: true, focus: true })}
      </div>
    ) : null
    const reachable = firstBlocked === -1 ? visible.length - 1 : firstBlocked
    footer = (
      <>
        <BackButton
          disabled={current === 0}
          onClick={() => {
            go(current - 1, 'back')
          }}
        />
        <span className="flex-1 text-center text-sm text-muted-foreground" aria-live="polite">
          {questionLocked ? 'Watch the video to continue' : stuck ? 'Answer this to continue' : ''}
        </span>
        {last ? (
          submitButton(stuck || anyBlocked)
        ) : (
          <NextButton
            disabled={stuck}
            onClick={() => {
              go(current + 1, 'forward')
            }}
          />
        )}
      </>
    )
    if (settings.show_navigator && visible.length > 1) {
      footer = (
        <div className="flex w-full flex-col">
          <Navigator
            items={visible.map((q, i) => ({
              key: q.key,
              answered: isAnswered(answers[q.key]),
              newSection: i > 0 && visible[i - 1]?.section_key !== q.section_key,
            }))}
            current={current}
            reachable={reachable}
            onGo={(index) => {
              go(index, index > current ? 'forward' : 'back')
            }}
          />
          <div className="flex flex-wrap items-center gap-3.5 border-t px-6 pt-4.5 pb-6 @max-[640px]:px-4.5">
            {footer}
          </div>
        </div>
      )
    }
  }

  const card = submitted ? (
    <ThankYou
      survey={survey}
      onEdit={
        (canEditAfterSubmit ?? (settings.allow_edit && !settings.anonymous))
          ? () => {
              setSubmitted(false)
            }
          : undefined
      }
      onAnother={
        (canRespondAgain ?? !settings.one_response)
          ? () => {
              setAnswers({})
              onAnswersChange?.({})
              setPosition(0)
              setDirection(null)
              setSubmitted(false)
            }
          : undefined
      }
      onReset={onReset}
      homeLink={homeLink}
    />
  ) : (
    <>
      <SurveyCover
        theme={theme}
        assets={assets}
        title={survey.title}
        description={survey.description}
      />
      <div
        className="sticky z-10 flex items-center gap-3 border-b bg-card px-6 py-2.5 text-[13px] text-muted-foreground @max-[640px]:px-4.5"
        style={{ top: stickyTop }}
      >
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span
            className="block h-full rounded-full bg-(--survey-accent) transition-[width] duration-300"
            style={{ width: `${String(Math.round(progress * 100))}%` }}
          />
        </div>
        <span aria-live="polite">{progressLabel}</span>
        {status ? <span className="border-l pl-3 text-muted-foreground">{status}</span> : null}
      </div>
      {visible.length === 0 ? (
        <p className="px-6 py-10 text-center text-muted-foreground">
          This survey has no questions yet.
        </p>
      ) : (
        <>
          <div className="px-6 pb-1 @max-[640px]:px-4.5">{body}</div>
          {layout === 'step' && settings.show_navigator && visible.length > 1 ? (
            footer
          ) : (
            <div className="flex flex-wrap items-center gap-3.5 border-t px-6 pt-4.5 pb-6 @max-[640px]:px-4.5">
              {footer}
            </div>
          )}
        </>
      )}
    </>
  )

  return (
    <div ref={topRef} style={{ ...accentStyle(theme), scrollMarginTop: stickyTop }}>
      <SurveyStage theme={theme} assets={assets}>
        <article
          className={cn(
            'overflow-clip rounded-[18px] border bg-card',
            // Over a background the card floats without a border (it returns on phones).
            staged && 'border-transparent @max-[640px]:border-border',
          )}
          aria-label={survey.title.trim() || 'Survey'}
        >
          {card}
        </article>
      </SurveyStage>
    </div>
  )
}

function ThankYou({
  survey,
  onEdit,
  onAnother,
  onReset,
  homeLink,
}: {
  survey: SurveyContent
  onEdit: (() => void) | undefined
  onAnother: (() => void) | undefined
  onReset: (() => void) | undefined
  homeLink: { to: string; label: string } | undefined
}) {
  const { settings } = survey
  const editUntil = settings.allow_edit && settings.closes_at ? shortDate(settings.closes_at) : null
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div className="px-6 py-12 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-(--survey-accent-soft) text-(--survey-accent)">
        <CheckIcon className="size-6" aria-hidden="true" />
      </span>
      {/* The form (and its h1 title) is gone, so this is the page's main heading now. */}
      <h1 ref={ref} tabIndex={-1} className="mt-3.5 text-2xl font-semibold outline-none">
        Response recorded
      </h1>
      <p className="mx-auto mt-1 max-w-[44ch]">Thanks, your answers have been submitted.</p>
      <p className="mx-auto mt-1 max-w-[44ch] text-sm text-muted-foreground">
        {onEdit
          ? editUntil
            ? `You can change your answers until ${editUntil}.`
            : 'You can change your answers while the survey is open.'
          : settings.one_response
            ? "This survey allows one response per employee, so the form won't open again for you."
            : 'You can submit another response if needed.'}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {homeLink ? (
          <Button className={ACCENT_BUTTON} asChild>
            <Link to={homeLink.to}>
              <HomeIcon aria-hidden="true" />
              {homeLink.label}
            </Link>
          </Button>
        ) : null}
        {onEdit ? (
          <Button variant="outline" onClick={onEdit}>
            Edit response
          </Button>
        ) : null}
        {onAnother ? (
          <Button variant="outline" onClick={onAnother}>
            Start another response
          </Button>
        ) : null}
        {onReset ? (
          <Button variant="outline" onClick={onReset}>
            Reset preview
          </Button>
        ) : null}
      </div>
    </div>
  )
}

const ACCENT_BUTTON =
  'bg-(--survey-accent) text-(--survey-accent-foreground) hover:bg-(--survey-accent) hover:brightness-110'

function NextButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button size="lg" className={ACCENT_BUTTON} disabled={disabled} onClick={onClick}>
      Next
    </Button>
  )
}

function BackButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button size="lg" variant="outline" disabled={disabled} onClick={onClick}>
      Back
    </Button>
  )
}
