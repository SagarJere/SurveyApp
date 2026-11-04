import type { ReactNode } from 'react'

import { Switch } from '@/components/ui/switch'
import { useBuilderStore } from '@/features/builder/store'
import type { Layout, SurveySettings } from '@/features/survey-logic/types'
import { cn } from '@/lib/utils'

const LAYOUTS: { value: Layout; title: string; description: string }[] = [
  {
    value: 'all',
    title: 'All on one page',
    description:
      'Everything on one scrolling page. Better for longer surveys where people like to review their answers.',
  },
  {
    value: 'section',
    title: 'One section per page',
    description:
      'Each section on its own page with Back and Next. Best when the survey is split into sections.',
  },
  {
    value: 'step',
    title: 'One question at a time',
    description:
      'One question per screen with Back and Next. Feels quicker and works best on phones.',
  },
]

function LayoutDiagram({ layout }: { layout: Layout }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-16 flex-col gap-[5px] rounded-[9px] border bg-card p-2',
        layout === 'step' && 'justify-center',
      )}
    >
      {layout === 'step' ? (
        <i className="block h-6 rounded bg-primary opacity-75" />
      ) : (
        <>
          <i
            className={cn(
              'block h-3 rounded bg-primary opacity-40',
              layout === 'section' && 'h-[7px] w-[55%] opacity-85',
            )}
          />
          <i className="block h-3 rounded bg-primary opacity-40" />
          <i className="block h-3 rounded bg-primary opacity-40" />
        </>
      )}
    </span>
  )
}

function Panel({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  const id = `panel-${title.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <section className="mb-3.5 rounded-2xl border bg-card px-5 py-4.5" aria-labelledby={id}>
      <h2 id={id} className="mb-1.5 text-[19px] font-semibold">
        {title}
      </h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  )
}

function SettingRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = `setting-${label.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <div className="flex items-center justify-between gap-4 border-t py-3.5 first-of-type:border-t-0">
      <div className="flex flex-col gap-0.5">
        <span id={`${id}-label`} className="font-semibold">
          {label}
        </span>
        <span id={`${id}-description`} className="text-sm text-muted-foreground">
          {description}
        </span>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        label={<span className="sr-only">{label}</span>}
        aria-describedby={`${id}-description`}
      />
    </div>
  )
}

/** Survey settings (docs/05-survey-builder.md, Settings tab). */
export function SettingsTab() {
  const settings = useBuilderStore((s) => s.draft.settings)
  const update = useBuilderStore((s) => s.updateSettings)
  const set =
    <K extends keyof SurveySettings>(key: K) =>
    (value: SurveySettings[K]) => {
      update({ [key]: value })
    }
  const datesWrong =
    !!settings.opens_at && !!settings.closes_at && settings.closes_at <= settings.opens_at

  return (
    <>
      <Panel title="Layout" description="How employees move through the questions.">
        <div role="radiogroup" aria-label="Layout" className="mt-3 grid gap-2.5 sm:grid-cols-3">
          {LAYOUTS.map((option) => (
            <label
              key={option.value}
              className="relative flex cursor-pointer flex-col gap-2.5 rounded-[14px] border-[1.5px] p-3.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name="layout"
                value={option.value}
                checked={settings.layout === option.value}
                className="absolute opacity-0"
                onChange={() => {
                  set('layout')(option.value)
                }}
              />
              <LayoutDiagram layout={option.value} />
              <span className="flex flex-col gap-0.5">
                <strong>{option.title}</strong>
                <span className="text-sm text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
        {settings.layout === 'step' ? (
          <div className="mt-2">
            <SettingRow
              label="Show question navigator"
              description="Numbered buttons under each question. People can jump back to any answered question."
              checked={settings.show_navigator}
              onChange={set('show_navigator')}
            />
            <SettingRow
              label="Move on automatically"
              description="After a single-choice, dropdown or rating answer, go to the next question without pressing Next."
              checked={settings.auto_next}
              onChange={set('auto_next')}
            />
          </div>
        ) : null}
      </Panel>

      <Panel title="Responses">
        <SettingRow
          label="One response per employee"
          description="Anyone who has already responded sees a confirmation instead of the form."
          checked={settings.one_response}
          onChange={set('one_response')}
        />
        <SettingRow
          label="Allow editing until the survey closes"
          description="Employees can reopen the survey and change their answers."
          checked={settings.allow_edit}
          onChange={set('allow_edit')}
        />
        <SettingRow
          label="Anonymous responses"
          description="Reports won’t show who answered. Participation is tracked separately, so no one can respond twice."
          checked={settings.anonymous}
          onChange={set('anonymous')}
        />
      </Panel>

      <Panel
        title="Schedule"
        description="Leave a date empty to open now or keep the survey open until you close it."
      >
        <div className="mt-2.5 flex flex-wrap gap-3.5">
          {(['opens_at', 'closes_at'] as const).map((key) => (
            <label key={key} className="flex flex-col gap-1 text-sm font-semibold">
              {key === 'opens_at' ? 'Opens' : 'Closes'}
              <input
                type="date"
                className="min-h-11 rounded-[10px] border bg-muted px-2.5 py-2 font-normal outline-none focus-visible:border-primary"
                value={settings[key] ?? ''}
                aria-invalid={key === 'closes_at' && datesWrong ? true : undefined}
                aria-describedby={key === 'closes_at' && datesWrong ? 'schedule-error' : undefined}
                onChange={(event) => {
                  set(key)(event.target.value || null)
                }}
              />
            </label>
          ))}
        </div>
        {datesWrong ? (
          <p id="schedule-error" className="mt-2 text-sm font-semibold text-warn" role="alert">
            The closing date must be after the opening date.
          </p>
        ) : null}
      </Panel>
    </>
  )
}
