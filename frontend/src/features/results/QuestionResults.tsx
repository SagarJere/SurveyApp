import { Skeleton } from '@/components/ui/skeleton'

import type { QuestionResult, QuestionsResult, ResultFilters } from './api'
import { CommentsList } from './CommentsList'
import { conditionText, questionIndex, shownNote } from './shown-note'
import { isTextType, REPORT_WIDGETS, TYPE_LABELS } from './report-widgets'

interface QuestionResultsProps {
  surveyId: string
  filters: ResultFilters
  result: QuestionsResult
}

/** Question cards in survey order, under their section headings. */
export function QuestionResults({ surveyId, filters, result }: QuestionResultsProps) {
  const index = questionIndex(result)
  const showSections = result.sections.length > 1
  return (
    <div className="flex flex-col gap-8">
      {result.sections.map((section) => (
        <section
          key={section.key}
          aria-label={showSections ? undefined : 'Questions'}
          aria-labelledby={showSections ? `section-${section.key}` : undefined}
          className="flex flex-col gap-4"
        >
          {showSections ? (
            <div>
              <h2 id={`section-${section.key}`} className="font-heading text-xl font-semibold">
                {section.title || 'Untitled section'}
              </h2>
              {section.condition ? (
                <p className="text-sm text-muted-foreground">
                  Only shown to {conditionText(section.condition, index)}.
                </p>
              ) : section.description ? (
                <p className="text-sm text-muted-foreground">{section.description}</p>
              ) : null}
            </div>
          ) : null}
          {section.questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No questions in this section.</p>
          ) : (
            section.questions.map((question) => (
              <QuestionCard
                key={question.key}
                surveyId={surveyId}
                filters={filters}
                question={question}
                note={shownNote(question, index, section.condition)}
                level={showSections ? 3 : 2}
              />
            ))
          )}
        </section>
      ))}
    </div>
  )
}

function QuestionCard({
  surveyId,
  filters,
  question,
  note,
  level,
}: {
  surveyId: string
  filters: ResultFilters
  question: QuestionResult
  note: string
  level: 2 | 3
}) {
  const Heading = level === 2 ? 'h2' : 'h3'
  const typeLabel = TYPE_LABELS[question.type]
  const type = question.type
  const Widget = isTextType(type) ? null : REPORT_WIDGETS[type]
  return (
    <article
      aria-labelledby={`q-${question.key}`}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <Heading id={`q-${question.key}`} className="font-semibold">
          <span className="text-muted-foreground">Q{question.number}.</span>{' '}
          {question.text || 'Untitled question'}
        </Heading>
        <p className="text-sm text-muted-foreground">
          {typeLabel} · {note}
        </p>
      </header>
      {question.shown === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody in this group was shown this question.
        </p>
      ) : Widget ? (
        <Widget question={question} />
      ) : (
        <CommentsList surveyId={surveyId} filters={filters} question={question} />
      )}
    </article>
  )
}

export function QuestionResultsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="h-64 rounded-xl border bg-card p-5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/3" />
          <Skeleton className="mt-6 h-3 w-full" />
          <Skeleton className="mt-4 h-3 w-5/6" />
          <Skeleton className="mt-4 h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}
