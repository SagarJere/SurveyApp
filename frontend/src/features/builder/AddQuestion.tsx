import { LayoutListIcon, PlusIcon } from 'lucide-react'

import { QUESTION_TYPE_LIST } from '@/features/question-types/registry'
import { cn } from '@/lib/utils'

import { useBuilderStore } from './store'

const DASHED =
  'text-muted-foreground hover:border-primary hover:text-primary flex min-h-11 w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed font-semibold transition-colors'

/** "Add question" button that opens the type picker for one section. */
export function AddQuestion({
  sectionKey,
  compact = false,
}: {
  sectionKey: string
  compact?: boolean
}) {
  const adding = useBuilderStore((s) => s.addingIn === sectionKey)
  const setAddingIn = useBuilderStore((s) => s.setAddingIn)
  const addQuestion = useBuilderStore((s) => s.addQuestion)

  if (!adding) {
    return (
      <button
        type="button"
        data-add-question={sectionKey}
        className={cn(DASHED, compact ? 'p-2.5 text-sm' : 'p-3.5')}
        onClick={() => {
          setAddingIn(sectionKey)
        }}
      >
        <PlusIcon className="size-[18px]" aria-hidden="true" />
        Add question
      </button>
    )
  }

  return (
    <div
      className="rounded-[14px] border bg-card p-3.5"
      role="group"
      aria-labelledby={`pick-${sectionKey}`}
    >
      <p id={`pick-${sectionKey}`} className="mb-2.5 font-semibold">
        Choose a question type
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {QUESTION_TYPE_LIST.map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            type="button"
            className="flex min-h-11 items-center gap-2.5 rounded-[10px] border bg-muted p-3 text-left font-semibold hover:border-primary"
            onClick={() => {
              addQuestion(type, sectionKey)
            }}
          >
            <Icon className="size-[18px] shrink-0 text-primary" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 min-h-10 text-sm font-semibold text-primary"
        onClick={() => {
          setAddingIn(null)
        }}
      >
        Cancel
      </button>
    </div>
  )
}

export function AddSectionButton({ className }: { className?: string }) {
  const addSection = useBuilderStore((s) => s.addSection)
  return (
    <button
      type="button"
      className={cn(DASHED, 'p-3.5 sm:w-auto sm:px-5', className)}
      onClick={addSection}
    >
      <LayoutListIcon className="size-[18px]" aria-hidden="true" />
      Add section
    </button>
  )
}
