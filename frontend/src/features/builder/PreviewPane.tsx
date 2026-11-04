import { RotateCcwIcon, SmartphoneIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { SurveyForm } from '@/features/respond/form/SurveyForm'
import { useThemeAssets } from '@/features/theme/use-theme-assets'
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
  const [phone, setPhone] = useState(false)
  const [run, setRun] = useState(0)
  const reset = () => {
    setRun((n) => n + 1)
  }

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
            className="aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary"
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
          onSubmit={() => undefined}
          onReset={reset}
        />
      </div>
    </>
  )
}
