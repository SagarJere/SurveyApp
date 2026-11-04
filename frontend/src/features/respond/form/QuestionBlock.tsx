import { forwardRef } from 'react'

import { moneyRangeError } from '@/features/survey-logic/answers'
import type { Question } from '@/features/survey-logic/types'
import { cn } from '@/lib/utils'

import { MoneyWords, QuestionInput } from './inputs'

interface QuestionBlockProps {
  question: Question
  number: number
  value: unknown
  onChange: (value: unknown) => void
  /** Fade in briefly: the question was just revealed by a condition. */
  reveal?: boolean
  /** One-question-at-a-time layout: larger question text, no divider. */
  large?: boolean
  headingLevel: 2 | 3
  className?: string
}

/** One question with its label, help text, input, amount in words and range error. */
export const QuestionBlock = forwardRef<HTMLHeadingElement, QuestionBlockProps>(
  function QuestionBlock(
    { question, number, value, onChange, reveal, large, headingLevel, className },
    headingRef,
  ) {
    const id = (part: string) => `q-${part}-${question.key}`
    const error = moneyRangeError(question, value)
    const describedBy =
      [
        question.help.trim() ? id('help') : null,
        question.type === 'money' ? id('words') : null,
        error ? id('error') : null,
      ]
        .filter(Boolean)
        .join(' ') || undefined
    const Heading = headingLevel === 2 ? 'h2' : 'h3'

    return (
      <div
        className={cn(
          large ? 'py-6' : 'border-b py-5 last:border-b-0',
          reveal && 'animate-reveal',
          className,
        )}
      >
        <Heading
          ref={headingRef}
          id={id('title')}
          tabIndex={-1}
          className={cn(
            'leading-snug font-semibold outline-none',
            large ? 'font-heading text-[21px] leading-tight' : 'text-[16.5px]',
          )}
        >
          <span className="mr-0.5 text-muted-foreground">{number}.</span>{' '}
          {question.text.trim() || 'Untitled question'}
          {question.required ? (
            <>
              <span className="text-warn" aria-hidden="true">
                {' '}
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          ) : null}
        </Heading>
        {question.help.trim() ? (
          <p id={id('help')} className="mt-1 text-sm text-muted-foreground">
            {question.help}
          </p>
        ) : null}
        <div className="mt-3">
          <QuestionInput
            question={question}
            value={value}
            onChange={onChange}
            labelledBy={id('title')}
            describedBy={describedBy}
            wordsId={id('words')}
          />
        </div>
        {question.type === 'money' ? (
          <MoneyWords question={question} value={value} id={id('words')} />
        ) : null}
        <p
          id={id('error')}
          aria-live="polite"
          className="mt-1 text-sm font-semibold text-warn empty:hidden"
        >
          {error ?? ''}
        </p>
      </div>
    )
  },
)
