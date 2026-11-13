import { NumberField } from '@/components/number-field'
import { NativeSelect } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { useBuilderStore } from '@/features/builder/store'
import { Panel, SettingRow } from '@/features/settings/SettingsTab'
import type { QuizSettings, Retakes, ShowAnswers } from '@/features/survey-logic/types'

import { quizKey } from './scoring'
import { DEFAULT_QUIZ } from './training-rules'

/** A radio button as a card; the whole card is clickable (the label covers it). */
function RadioCard({
  name,
  option,
  checked,
  onSelect,
}: {
  name: string
  option: { value: string; title: string; description: string }
  checked: boolean
  onSelect: () => void
}) {
  const id = `${name}-${option.value}`
  return (
    <div className="relative flex items-start gap-3 rounded-xl border-[1.5px] p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
      <input
        id={id}
        type="radio"
        name={name}
        className="mt-1 accent-primary"
        checked={checked}
        aria-describedby={`${id}-description`}
        onChange={onSelect}
      />
      <div className="flex flex-col gap-0.5">
        <label
          htmlFor={id}
          className="cursor-pointer text-sm font-semibold after:absolute after:inset-0"
        >
          {option.title}
        </label>
        <span id={`${id}-description`} className="text-sm text-muted-foreground">
          {option.description}
        </span>
      </div>
    </div>
  )
}

const SHOW_ANSWERS: { value: ShowAnswers; title: string; description: string }[] = [
  {
    value: 'after_pass_or_last',
    title: 'Once they pass or have no attempts left',
    description: 'Recommended: people can’t copy the answers into a retake.',
  },
  { value: 'always', title: 'After every attempt', description: 'Good for practice quizzes.' },
  { value: 'never', title: 'Never', description: 'They only see their score.' },
]

const RETAKES: { value: Retakes; title: string; description: string }[] = [
  { value: 'none', title: 'No retakes', description: 'One attempt only.' },
  {
    value: 'limit',
    title: 'Up to a number of attempts',
    description: 'Passing ends the attempts.',
  },
  {
    value: 'until_pass',
    title: 'Until they pass',
    description: 'As many attempts as they need to reach the pass mark.',
  },
  {
    value: 'until_perfect',
    title: 'Until every answer is correct',
    description: 'As many attempts as they need to score 100%.',
  },
]

const ATTEMPT_CHOICES = [2, 3, 4, 5, 6, 7, 8, 9, 10]

/** Trainings: pass mark, what people see after submitting, retakes and a due date. */
export function QuizTab() {
  const settings = useBuilderStore((s) => s.draft.settings)
  const update = useBuilderStore((s) => s.updateSettings)
  const questions = useBuilderStore((s) => s.draft.questions)
  const marked = questions.flatMap((q) => {
    const key = quizKey(q)
    return key ? [key.points || 1] : []
  })
  const total = questions.length
  const quiz = settings.quiz ?? DEFAULT_QUIZ
  const set = (patch: Partial<QuizSettings>) => {
    update({ quiz: { ...quiz, ...patch } })
  }
  const points = marked.reduce((sum, p) => sum + p, 0)
  const needsPassMark = quiz.retakes === 'until_pass' && quiz.pass_mark === null

  return (
    <>
      <Panel
        title="Scoring"
        description={
          marked.length
            ? `${String(marked.length)} of ${String(total)} questions are marked, worth ${String(points)} point${points === 1 ? '' : 's'}. Mark questions on the Questions tab.`
            : 'No question is marked yet, so there’s no score. Open a single choice, dropdown, checkboxes or number question and turn on “Marked question”.'
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Switch
            checked={quiz.pass_mark !== null}
            label="Pass mark"
            onCheckedChange={(on) => {
              set({ pass_mark: on ? (DEFAULT_QUIZ.pass_mark ?? 80) : null })
            }}
          />
          {quiz.pass_mark !== null ? (
            <span className="inline-flex items-center gap-2 text-sm">
              <label htmlFor="quiz-pass-mark" className="sr-only">
                Pass mark in percent
              </label>
              <NumberField
                id="quiz-pass-mark"
                className="h-10 w-20"
                value={quiz.pass_mark}
                allowDecimals={false}
                allowNegative={false}
                onValueChange={(value) => {
                  set({ pass_mark: Math.min(100, Math.max(1, value ?? 1)) })
                }}
              />
              % or more to pass
            </span>
          ) : null}
        </div>
        {quiz.pass_mark !== null ? (
          <SettingRow
            label="Show the pass mark before they start"
            description="Shown under the training’s title."
            checked={quiz.show_pass_mark}
            onChange={(show_pass_mark) => {
              set({ show_pass_mark })
            }}
          />
        ) : null}
      </Panel>

      <Panel title="After submitting">
        <SettingRow
          label="Show the score"
          description="Their score, points and whether they passed."
          checked={quiz.show_score}
          onChange={(show_score) => {
            set({ show_score })
          }}
        />
        <fieldset className="mt-1">
          <legend className="mb-2 font-semibold">Show the correct answers</legend>
          <div className="grid gap-2">
            {SHOW_ANSWERS.map((option) => (
              <RadioCard
                key={option.value}
                name="show-answers"
                option={option}
                checked={quiz.show_answers === option.value}
                onSelect={() => {
                  set({ show_answers: option.value })
                }}
              />
            ))}
          </div>
        </fieldset>
      </Panel>

      <Panel
        title="Retakes"
        description="A retake skips the videos already watched. The best attempt counts."
      >
        <fieldset className="mt-3">
          <legend className="sr-only">Retakes</legend>
          <div className="grid gap-2">
            {RETAKES.map((option) => (
              <RadioCard
                key={option.value}
                name="retakes"
                option={option}
                checked={quiz.retakes === option.value}
                onSelect={() => {
                  set({ retakes: option.value })
                }}
              />
            ))}
          </div>
        </fieldset>
        {quiz.retakes === 'limit' ? (
          <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
            Attempts in total
            <NativeSelect
              className="h-10 w-24"
              value={quiz.max_attempts}
              onChange={(event) => {
                set({ max_attempts: Number(event.target.value) })
              }}
            >
              {ATTEMPT_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        {needsPassMark ? (
          <p className="mt-2 text-sm font-semibold text-warn" role="alert">
            “Until they pass” needs a pass mark. Turn on the pass mark above.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Due date"
        description="Optional. Shown on My trainings. People can still complete it after this date; reports mark them as late."
      >
        <label className="mt-2.5 flex w-fit flex-col gap-1 text-sm font-semibold">
          Due
          <input
            type="date"
            className="min-h-11 rounded-[10px] border bg-muted px-2.5 py-2 font-normal outline-none focus-visible:border-primary"
            value={settings.due_date ?? ''}
            onChange={(event) => {
              update({ due_date: event.target.value || null })
            }}
          />
        </label>
      </Panel>
    </>
  )
}
