import { useShallow } from 'zustand/react/shallow'

import { AddQuestion, AddSectionButton } from './AddQuestion'
import { QuestionCard } from './QuestionCard'
import { SectionHeader } from './SectionHeader'
import { useBuilderStore } from './store'

function SectionBlock({ sectionKey, index }: { sectionKey: string; index: number }) {
  const section = useBuilderStore((s) => s.draft.sections.find((x) => x.key === sectionKey))
  const total = useBuilderStore((s) => s.draft.sections.length)
  const questionKeys = useBuilderStore(
    useShallow((s) =>
      s.draft.questions.filter((q) => q.section_key === sectionKey).map((q) => q.key),
    ),
  )
  const collapsed = useBuilderStore((s) => total > 1 && s.collapsed.has(sectionKey))
  if (!section) return null

  const multi = total > 1
  const label = section.title.trim() || `Section ${index + 1}`

  return (
    <section className={multi ? 'mt-6' : 'mt-4'} aria-label={multi ? label : undefined}>
      {multi ? (
        <SectionHeader
          section={section}
          index={index}
          total={total}
          questionCount={questionKeys.length}
          collapsed={collapsed}
        />
      ) : null}
      {collapsed ? null : (
        <div id={`section-body-${section.key}`}>
          {questionKeys.length ? (
            <ol className={multi ? 'mt-3 flex flex-col gap-3' : 'flex flex-col gap-3'}>
              {questionKeys.map((key) => (
                <QuestionCard key={key} questionKey={key} />
              ))}
            </ol>
          ) : multi ? (
            <p className="mt-3 rounded-xl bg-muted p-3.5 text-center text-sm text-muted-foreground">
              No questions in this section yet.
            </p>
          ) : null}
          {multi ? (
            <div className="mt-2.5">
              <AddQuestion sectionKey={section.key} compact />
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

/** All sections and their questions. With one section, section UI is hidden. */
export function SectionList() {
  const sectionKeys = useBuilderStore(useShallow((s) => s.draft.sections.map((x) => x.key)))
  const firstSection = sectionKeys[0]
  const single = sectionKeys.length === 1
  const adding = useBuilderStore((s) => s.addingIn !== null)

  return (
    <>
      {sectionKeys.map((key, index) => (
        <SectionBlock key={key} sectionKey={key} index={index} />
      ))}
      <div className="mt-3.5 flex flex-col gap-2.5 sm:flex-row">
        {single && firstSection ? (
          <div className="flex-1">
            <AddQuestion sectionKey={firstSection} />
          </div>
        ) : null}
        {single && adding ? null : <AddSectionButton className={single ? '' : 'sm:w-full'} />}
      </div>
    </>
  )
}
