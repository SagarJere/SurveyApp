import { CheckIcon, HomeIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import type { AttemptResult } from '@/features/respond/api'
import type { Retakes } from '@/features/survey-logic/types'
import { cn } from '@/lib/utils'

const SIZE = 112
const STROKE = 10
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const ACCENT_BUTTON =
  'bg-(--survey-accent) text-(--survey-accent-foreground) hover:bg-(--survey-accent) hover:brightness-110'

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`
}

function ScoreRing({ score }: { score: number }) {
  const share = Math.max(0, Math.min(100, score)) / 100
  return (
    <div className="relative mx-auto size-28" role="img" aria-label={`Score ${String(score)}%`}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={STROKE}
        />
        {share > 0 ? (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--survey-accent)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${String(share * CIRCUMFERENCE)} ${String(CIRCUMFERENCE)}`}
          />
        ) : null}
      </svg>
      <span
        className="absolute inset-0 grid place-items-center font-heading text-3xl font-semibold tabular-nums"
        aria-hidden="true"
      >
        {score}%
      </span>
    </div>
  )
}

function headingFor(result: AttemptResult): string {
  if (result.passed === true) return 'You passed'
  if (result.passed === false) return result.attempts_left === 0 ? 'Not passed' : 'Not passed yet'
  if (result.score !== null) return 'Your score'
  return 'Answers submitted'
}

function attemptsText(result: AttemptResult, retakes: Retakes): string | null {
  const left = result.attempts_left
  if (left === null) {
    return retakes === 'until_perfect'
      ? 'You can retake it until every answer is correct.'
      : 'You can retake it until you pass.'
  }
  if (left > 0) return `${plural(left, 'attempt')} left.`
  return result.passed === false ? 'No attempts left.' : null
}

export interface ScoreScreenProps {
  result: AttemptResult
  retakes: Retakes
  /** The total allowed, when there's a fixed number ("Attempt 2 of 3"). */
  maxAttempts: number | null
  onRetake: () => void
  homeLink?: { to: string; label: string }
  /** Preview: "Reset preview". */
  onReset?: () => void
}

/** After a training attempt: the score, pass or not, attempts, and the answer review. */
export function ScoreScreen({
  result,
  retakes,
  maxAttempts,
  onRetake,
  homeLink,
  onReset,
}: ScoreScreenProps) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const canRetake = result.attempts_left !== 0
  const attempts = attemptsText(result, retakes)
  const facts = [
    result.points !== null && result.max_points
      ? `${String(result.points)} of ${plural(result.max_points, 'point')}`
      : null,
    result.pass_mark !== null ? `Pass mark ${String(result.pass_mark)}%` : null,
    maxAttempts && maxAttempts > 1
      ? `Attempt ${String(result.attempt_no)} of ${String(maxAttempts)}`
      : result.attempt_no > 1
        ? `Attempt ${String(result.attempt_no)}`
        : null,
  ].filter((fact): fact is string => fact !== null)

  return (
    <div className="px-6 py-10 @max-[640px]:px-4.5">
      <div className="text-center">
        {result.score !== null ? (
          <ScoreRing score={result.score} />
        ) : (
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-(--survey-accent-soft) text-(--survey-accent)">
            <CheckIcon className="size-6" aria-hidden="true" />
          </span>
        )}
        {/* The form (and its h1 title) is gone, so this is the page's main heading now. */}
        <h1 ref={ref} tabIndex={-1} className="mt-3.5 text-2xl font-semibold outline-none">
          {headingFor(result)}
        </h1>
        {facts.length > 0 ? (
          <p className="mt-1 text-balance text-muted-foreground">{facts.join(' · ')}</p>
        ) : null}
        {result.score === null && result.passed === null ? (
          <p className="mx-auto mt-1 max-w-[44ch]">Thanks, your answers have been submitted.</p>
        ) : null}
        {attempts ? <p className="mt-1 text-sm text-muted-foreground">{attempts}</p> : null}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {canRetake ? (
            <Button className={ACCENT_BUTTON} onClick={onRetake}>
              <RotateCcwIcon aria-hidden="true" />
              Retake now
            </Button>
          ) : null}
          {homeLink ? (
            <Button
              className={canRetake ? undefined : ACCENT_BUTTON}
              variant={canRetake ? 'outline' : 'default'}
              asChild
            >
              <Link to={homeLink.to}>
                <HomeIcon aria-hidden="true" />
                {homeLink.label}
              </Link>
            </Button>
          ) : null}
          {onReset ? (
            <Button variant="outline" onClick={onReset}>
              Reset preview
            </Button>
          ) : null}
        </div>
        {canRetake ? (
          <p className="mt-2 text-xs text-muted-foreground">
            A retake skips the videos you&apos;ve watched: you answer the questions again.
          </p>
        ) : null}
      </div>
      {result.review ? (
        <section aria-labelledby="answer-review" className="mx-auto mt-8 max-w-[560px]">
          <h2 id="answer-review" className="text-lg font-semibold">
            Your answers
          </h2>
          <ol className="mt-3 flex flex-col gap-2.5">
            {result.review.map((item) => (
              <li
                key={item.question_key}
                className={cn(
                  'flex gap-3 rounded-xl border p-3.5',
                  item.correct ? 'border-success/40' : 'border-destructive/40',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full',
                    item.correct
                      ? 'bg-success/15 text-success'
                      : 'bg-destructive/10 text-destructive',
                  )}
                >
                  {item.correct ? (
                    <CheckIcon className="size-4" aria-hidden="true" />
                  ) : (
                    <XIcon className="size-4" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">
                    <span className="sr-only">{item.correct ? 'Correct: ' : 'Wrong: '}</span>
                    {item.text}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    Your answer: {item.your_answer ?? 'not answered'}
                  </p>
                  {item.correct ? null : (
                    <p className="mt-0.5">Correct answer: {item.correct_answer}</p>
                  )}
                </div>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                  {item.correct ? item.points : 0}/{item.points} {item.points === 1 ? 'pt' : 'pts'}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  )
}
