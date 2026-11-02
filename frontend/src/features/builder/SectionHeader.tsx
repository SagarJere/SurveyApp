import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  GitBranchIcon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'

import { sectionConditionProblem } from '@/features/survey-logic/conditions'
import type { Section } from '@/features/survey-logic/types'
import { cn } from '@/lib/utils'

import { conditionSummary } from './condition-text'
import { ConditionPanel } from './ConditionPanel'
import { ConditionTag } from './ConditionTag'
import { useBuilderStore } from './store'

const ICON_BUTTON =
  'text-muted-foreground hover:bg-muted hover:text-foreground grid size-10 place-items-center rounded-lg disabled:pointer-events-none disabled:opacity-35'

interface SectionHeaderProps {
  section: Section
  index: number
  total: number
  questionCount: number
  collapsed: boolean
}

/** Header card shown for each section once a survey has two or more. */
export function SectionHeader({
  section,
  index,
  total,
  questionCount,
  collapsed,
}: SectionHeaderProps) {
  const problem = useBuilderStore((s) =>
    section.condition ? sectionConditionProblem(s.draft, section.key) : null,
  )
  const summary = useBuilderStore((s) =>
    section.condition ? conditionSummary(s.draft, section.condition) : '',
  )
  const prompt = useBuilderStore((s) => s.conditionPrompt === section.key)
  const flagged = useBuilderStore(
    (s) => s.issues?.some((issue) => issue.section_key === section.key) ?? false,
  )
  const actions = useBuilderStore.getState()
  const label = section.title.trim() || `Section ${index + 1}`
  const target = { kind: 'section', key: section.key } as const

  const remove = () => {
    const deleted = actions.deleteSection(section.key)
    if (!deleted) return
    const moved = deleted.movedCount
    toast(
      `Deleted “${deleted.section.title.trim() || 'Untitled section'}”.${
        moved
          ? ` Its ${moved} question${moved > 1 ? 's' : ''} moved to “${
              deleted.movedTo.title.trim() || 'Untitled section'
            }”.`
          : ''
      }`,
      {
        action: {
          label: 'Undo',
          onClick: () => {
            useBuilderStore.getState().restoreDraft(deleted.before)
          },
        },
      },
    )
  }

  return (
    <div
      className={cn(
        'rounded-[14px] border border-l-[5px] border-l-primary bg-card px-4 py-3',
        flagged && 'border-warn',
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-xs font-bold tracking-wider text-primary uppercase">
          Section {index + 1} of {total}
        </span>
        {section.condition ? <ConditionTag text={summary} broken={problem !== null} /> : null}
        <span className="flex-1" />
        <span className="flex gap-0.5">
          <button
            type="button"
            data-section-move={`up:${section.key}`}
            className={ICON_BUTTON}
            aria-label={`Move ${label} up`}
            title="Move section up"
            disabled={index === 0}
            onClick={() => {
              actions.moveSection(section.key, -1)
            }}
          >
            <ArrowUpIcon className="size-[17px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-section-move={`down:${section.key}`}
            className={ICON_BUTTON}
            aria-label={`Move ${label} down`}
            title="Move section down"
            disabled={index === total - 1}
            onClick={() => {
              actions.moveSection(section.key, 1)
            }}
          >
            <ArrowDownIcon className="size-[17px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={`Delete ${label}`}
            title="Delete section"
            onClick={remove}
          >
            <Trash2Icon className="size-[17px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            aria-expanded={!collapsed}
            aria-controls={`section-body-${section.key}`}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => {
              actions.toggleCollapsed(section.key)
            }}
          >
            <ChevronDownIcon
              className={cn('size-[17px] transition-transform', !collapsed && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
        </span>
      </div>
      <input
        data-section-title={section.key}
        className="w-full bg-transparent py-1 font-heading text-[19px] font-semibold tracking-tight outline-none focus-visible:shadow-[0_2px_0_var(--primary)] sm:text-[21px]"
        placeholder="Section title"
        aria-label={`Section ${index + 1} title`}
        maxLength={300}
        value={section.title}
        onChange={(event) => {
          actions.updateSection(section.key, { title: event.target.value })
        }}
      />
      <textarea
        className="w-full resize-none bg-transparent pt-0.5 pb-1.5 text-muted-foreground outline-none focus-visible:shadow-[0_2px_0_var(--primary)]"
        rows={1}
        placeholder="Description (optional)"
        aria-label={`Section ${index + 1} description`}
        maxLength={2000}
        value={section.description}
        onChange={(event) => {
          actions.updateSection(section.key, { description: event.target.value })
        }}
      />
      {collapsed ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {questionCount} question{questionCount === 1 ? '' : 's'} hidden. Expand to edit.
        </p>
      ) : section.condition || prompt ? (
        <ConditionPanel target={target} condition={section.condition} problem={problem} />
      ) : (
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg pr-2 text-sm font-semibold text-logic hover:bg-logic-soft"
          onClick={() => {
            actions.addCondition(target)
          }}
        >
          <GitBranchIcon className="size-4" aria-hidden="true" />
          Show this section only when…
        </button>
      )}
    </div>
  )
}
