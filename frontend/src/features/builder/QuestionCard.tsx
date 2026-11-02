import { ArrowDownIcon, ArrowUpIcon, CopyIcon, GitBranchIcon, Trash2Icon } from 'lucide-react'
import { memo } from 'react'
import { toast } from 'sonner'

import { NativeSelect } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { QUESTION_TYPE_LIST, QUESTION_TYPES } from '@/features/question-types/registry'
import { countDependents, questionConditionProblem } from '@/features/survey-logic/conditions'
import type { Question, QuestionType } from '@/features/survey-logic/types'
import { cn } from '@/lib/utils'

import { conditionSummary } from './condition-text'
import { ConditionPanel } from './ConditionPanel'
import { ConditionTag } from './ConditionTag'
import { useBuilderStore } from './store'

const ICON_BUTTON =
  'text-muted-foreground hover:bg-muted hover:text-foreground grid size-10 place-items-center rounded-lg disabled:pointer-events-none disabled:opacity-35'

/** One question in the builder. Re-renders only when its own question or position changes. */
export const QuestionCard = memo(function QuestionCard({ questionKey }: { questionKey: string }) {
  const question = useBuilderStore((s) => s.draft.questions.find((q) => q.key === questionKey))
  const number = useBuilderStore(
    (s) => s.draft.questions.findIndex((q) => q.key === questionKey) + 1,
  )
  const open = useBuilderStore((s) => s.openKey === questionKey)
  const setOpen = useBuilderStore((s) => s.setOpen)
  const problem = useBuilderStore((s) =>
    question?.condition ? questionConditionProblem(s.draft, questionKey) : null,
  )
  const summary = useBuilderStore((s) =>
    question?.condition ? conditionSummary(s.draft, question.condition) : '',
  )
  const flagged = useBuilderStore(
    (s) => s.issues?.some((issue) => issue.question_key === questionKey) ?? false,
  )
  if (!question) return null

  const conditional = question.condition !== null
  const typeLabel = QUESTION_TYPES[question.type].label

  return (
    <li
      id={`card-${question.key}`}
      className={cn(
        'relative rounded-[14px] border bg-card transition-[border-color,box-shadow]',
        open && 'border-primary ring-[3px] ring-primary-soft',
        flagged && !open && 'border-warn',
        conditional &&
          'ml-[22px] before:absolute before:-top-[13px] before:-left-[15px] before:h-9 before:w-[11px] before:rounded-bl-[10px] before:border-b-2 before:border-l-2 before:border-logic sm:ml-9 sm:before:-left-6 sm:before:w-[18px]',
      )}
    >
      {conditional ? (
        <ConditionTag className="mx-4 mt-3" text={summary} broken={problem !== null} />
      ) : null}
      <button
        type="button"
        data-question-head={question.key}
        className="flex w-full items-baseline gap-3 rounded-[14px] px-4 py-3.5 text-left"
        aria-expanded={open}
        onClick={() => {
          setOpen(open ? null : question.key)
        }}
      >
        <span className="min-w-7 font-heading font-bold text-muted-foreground">Q{number}</span>
        <span className="min-w-0 flex-1 font-semibold break-words">
          {question.text.trim() || (
            <span className="font-medium text-muted-foreground">Untitled question</span>
          )}
        </span>
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {typeLabel}
          {question.required ? (
            <span className="font-bold text-warn" title="Required">
              {' '}
              *<span className="sr-only">required</span>
            </span>
          ) : null}
        </span>
      </button>
      {open ? <QuestionBody question={question} number={number} /> : null}
    </li>
  )
})

function QuestionBody({ question, number }: { question: Question; number: number }) {
  const total = useBuilderStore((s) => s.draft.questions.length)
  const dependents = useBuilderStore((s) => countDependents(s.draft, question.key))
  const prompt = useBuilderStore((s) => s.conditionPrompt === question.key)
  const problem = useBuilderStore((s) =>
    question.condition ? questionConditionProblem(s.draft, question.key) : null,
  )
  const actions = useBuilderStore.getState()
  const Editor = QUESTION_TYPES[question.type].Editor
  const target = { kind: 'question', key: question.key } as const

  const remove = () => {
    const deleted = actions.deleteQuestion(question.key)
    if (!deleted) return
    toast(
      `Deleted Q${number}.${
        dependents ? ` It was used in ${dependents} condition${dependents > 1 ? 's' : ''}.` : ''
      }`,
      {
        action: {
          label: 'Undo',
          onClick: () => {
            useBuilderStore.getState().restoreQuestion(deleted)
          },
        },
      },
    )
  }

  return (
    <div className="px-4 pb-3">
      <div className="grid gap-2.5 sm:grid-cols-[1fr_190px]">
        <Textarea
          data-question-text={question.key}
          className="resize-y font-medium"
          rows={2}
          maxLength={1000}
          placeholder="Type your question"
          aria-label={`Question ${number} text`}
          value={question.text}
          onChange={(event) => {
            actions.updateQuestion(question.key, { text: event.target.value })
          }}
        />
        <NativeSelect
          aria-label={`Question ${number} type`}
          className="h-11 self-start"
          value={question.type}
          onChange={(event) => {
            actions.changeType(question.key, event.target.value as QuestionType)
          }}
        >
          {QUESTION_TYPE_LIST.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <input
        className="mt-2 min-h-10 w-full border-b border-dashed bg-transparent px-0.5 text-sm text-muted-foreground outline-none focus-visible:border-solid focus-visible:border-primary focus-visible:text-foreground"
        placeholder="Help text (optional)"
        aria-label={`Question ${number} help text`}
        maxLength={500}
        value={question.help}
        onChange={(event) => {
          actions.updateQuestion(question.key, { help: event.target.value })
        }}
      />

      <Editor question={question} />

      {question.condition || prompt ? (
        <ConditionPanel target={target} condition={question.condition} problem={problem} />
      ) : null}

      {dependents ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-logic">
          <GitBranchIcon className="size-3.5" aria-hidden="true" />
          Used in {dependents} condition{dependents > 1 ? 's' : ''}.
        </p>
      ) : null}

      <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t pt-2.5">
        <Switch
          checked={question.required}
          onCheckedChange={(required) => {
            actions.updateQuestion(question.key, { required })
          }}
          label="Required"
        />
        {question.condition || prompt ? null : (
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-logic hover:bg-logic-soft"
            onClick={() => {
              actions.addCondition(target)
            }}
          >
            <GitBranchIcon className="size-4" aria-hidden="true" />
            Add condition
          </button>
        )}
        <span className="flex-1" />
        <span className="flex gap-0.5">
          <button
            type="button"
            data-move={`up:${question.key}`}
            className={ICON_BUTTON}
            aria-label={`Move Q${number} up`}
            title="Move up"
            disabled={number === 1}
            onClick={() => {
              actions.moveQuestion(question.key, -1)
            }}
          >
            <ArrowUpIcon className="size-[17px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-move={`down:${question.key}`}
            className={ICON_BUTTON}
            aria-label={`Move Q${number} down`}
            title="Move down"
            disabled={number === total}
            onClick={() => {
              actions.moveQuestion(question.key, 1)
            }}
          >
            <ArrowDownIcon className="size-[17px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={`Duplicate Q${number}`}
            title="Duplicate"
            onClick={() => {
              actions.duplicateQuestion(question.key)
            }}
          >
            <CopyIcon className="size-[17px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={`Delete Q${number}`}
            title="Delete"
            onClick={remove}
          >
            <Trash2Icon className="size-[17px]" aria-hidden="true" />
          </button>
        </span>
      </div>
    </div>
  )
}
