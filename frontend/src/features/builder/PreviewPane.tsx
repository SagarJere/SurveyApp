import { RotateCcwIcon, SmartphoneIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { ScoreScreen } from '@/features/quiz/ScoreScreen'
import {
  DEFAULT_QUIZ,
  fixedAttempts,
  introText,
  NO_ATTEMPTS,
  previewAttempt,
  type PreviewAttempts,
} from '@/features/quiz/training-rules'
import type { AttemptResult } from '@/features/respond/api'
import { SurveyForm } from '@/features/respond/form/SurveyForm'
import { useThemeAssets } from '@/features/theme/use-theme-assets'
import { useDraftVideos } from '@/features/video/use-videos'
import { cn } from '@/lib/utils'

import { useBuilderStore } from './store'

/**
 * Preview: the real respondent form (same component as /s/:id) on the current draft.
 * Conditions, layouts and validation all work; nothing is saved.
 */
export function PreviewPane({ stickyTop }: { stickyTop: number }) {
  const draft = useBuilderStore((s) => s.draft)
  const surveyId = useBuilderStore((s) => s.surveyId) ?? ''
  const { resolve } = useThemeAssets(surveyId)
  const training = useBuilderStore((s) => s.kind === 'training')
  const videos = useDraftVideos(surveyId, draft.sections, training)
  const [phone, setPhone] = useState(false)
  const [run, setRun] = useState(0)
  // Trainings: Preview keeps its own attempts, scored with the draft's answer key.
  const [attempts, setAttempts] = useState<PreviewAttempts>(NO_ATTEMPTS)
  const [result, setResult] = useState<AttemptResult | null>(null)
  const reset = () => {
    setRun((n) => n + 1)
    setAttempts(NO_ATTEMPTS)
    setResult(null)
  }
  const quiz = draft.settings.quiz ?? DEFAULT_QUIZ

  return (
    <>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <p className="text-sm text-muted-foreground">
          This is what employees will see. Conditions work here, so try answering the questions.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={phone}
            className="aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-soft-foreground"
            onClick={() => {
              setPhone((value) => !value)
            }}
          >
            <SmartphoneIcon aria-hidden="true" />
            Phone width
          </Button>
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcwIcon aria-hidden="true" />
            Reset answers
          </Button>
        </div>
      </div>
      <div
        className={cn(
          'mx-auto transition-[max-width] duration-300',
          phone ? 'max-w-[390px]' : 'max-w-full',
        )}
      >
        <SurveyForm
          key={run}
          survey={draft}
          assets={resolve}
          stickyTop={stickyTop}
          onSubmit={(answers) => {
            if (!training) return undefined
            const scored = previewAttempt(draft, answers, attempts)
            setAttempts(scored.after)
            setResult(scored.result)
            return undefined
          }}
          onReset={reset}
          intro={
            training
              ? introText({
                  pass_mark: quiz.show_pass_mark ? quiz.pass_mark : null,
                  retakes: quiz.retakes,
                  max_attempts: quiz.max_attempts,
                  attempts_used: attempts.used,
                })
              : undefined
          }
          doneScreen={
            training && result
              ? (retake) => (
                  <ScoreScreen
                    result={result}
                    retakes={quiz.retakes}
                    maxAttempts={fixedAttempts(quiz.retakes, quiz.max_attempts)}
                    onRetake={retake}
                    onReset={reset}
                  />
                )
              : undefined
          }
          videos={training ? videos : undefined}
          allowSkipVideos
        />
      </div>
    </>
  )
}
