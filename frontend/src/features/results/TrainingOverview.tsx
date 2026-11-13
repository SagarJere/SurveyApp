import { TriangleAlertIcon } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { shortDate } from '@/lib/format'

import type { TrainingFigures } from './api'
import { percent, whole } from './format'
import { Tile } from './HeadlineTiles'
import { ShareBars } from './widgets'

function Panel({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border bg-card p-5" aria-label={title}>
      <h2 className="font-heading text-lg font-semibold">{title}</h2>
      {note ? <p className="mt-0.5 text-sm text-muted-foreground">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Completed, passed, average score and attempts: each person's best attempt. */
export function TrainingTiles({ figures }: { figures: TrainingFigures }) {
  const { completed, invited } = figures
  return (
    <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="Completed"
        value={whole(completed)}
        note={
          invited !== null
            ? `of ${whole(invited)} invited (${percent(invited ? completed / invited : null)})`
            : 'Open to all employees'
        }
      />
      <Tile
        label="Passed"
        value={figures.pass_rate !== null ? percent(figures.pass_rate) : '–'}
        note={
          figures.pass_mark === null
            ? 'No pass mark'
            : `${whole(figures.passed ?? 0)} of ${whole(completed)} completed · pass mark ${String(figures.pass_mark)}%`
        }
      />
      <Tile
        label="Average score"
        value={figures.average_score !== null ? `${figures.average_score.toFixed(1)}%` : '–'}
        note="Best attempt of each person"
      />
      <Tile
        label="Average attempts"
        value={figures.average_attempts !== null ? figures.average_attempts.toFixed(1) : '–'}
        note={figures.due_date ? `Due ${shortDate(figures.due_date)}` : 'No due date'}
      />
    </dl>
  )
}

/** % correct per question (lowest first), attempts needed to pass, and videos watched. */
export function TrainingPanels({ figures }: { figures: TrainingFigures }) {
  const attention = figures.questions.filter((q) => q.needs_attention).length
  const passedTotal = figures.attempts_to_pass.reduce((sum, b) => sum + b.people, 0)
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel
        title="Correct answers per question"
        note={
          figures.questions.length === 0
            ? undefined
            : attention
              ? `${String(attention)} question${attention === 1 ? ' needs' : 's need'} attention: under 60% got ${attention === 1 ? 'it' : 'them'} right.`
              : 'Of the people shown each question, how many got it right. Lowest first.'
        }
      >
        {figures.questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No question has a correct answer.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Correct answers per question">
            {figures.questions.map((q) => (
              <li key={q.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words">
                    <span className="font-semibold text-muted-foreground">Q{q.number} </span>
                    {q.text || 'Untitled question'}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {percent(q.share)} · {whole(q.correct)} of {whole(q.shown)}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-chart-1"
                    style={{ width: `${String(Math.min(100, (q.share ?? 0) * 100))}%` }}
                  />
                </div>
                {q.needs_attention ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-warn">
                    <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
                    Needs attention
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="flex flex-col gap-6">
        {figures.pass_mark !== null ? (
          <Panel
            title="Attempts needed to pass"
            note={passedTotal ? `${whole(passedTotal)} people passed.` : 'Nobody has passed yet.'}
          >
            <ShareBars
              label="Attempts needed to pass"
              items={figures.attempts_to_pass.map((b) => ({
                key: String(b.attempts),
                label: b.attempts === 1 ? 'First attempt' : `${b.label} attempts`,
                n: b.people,
                share: passedTotal ? b.people / passedTotal : 0,
              }))}
            />
          </Panel>
        ) : null}
        {figures.videos.length ? (
          <Panel
            title="Videos watched to the end"
            note={
              figures.invited !== null
                ? `Out of ${whole(figures.invited)} invited.`
                : 'People who finished each video.'
            }
          >
            {figures.invited ? (
              <ShareBars
                label="Videos watched to the end"
                items={figures.videos.map((v) => ({
                  key: v.section_key,
                  label: v.title,
                  n: v.watched,
                  share: v.watched / (figures.invited ?? 1),
                }))}
              />
            ) : (
              <ul className="flex flex-col gap-2 text-sm" aria-label="Videos watched to the end">
                {figures.videos.map((v) => (
                  <li key={v.section_key} className="flex justify-between gap-3">
                    <span className="min-w-0 break-words">{v.title}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {whole(v.watched)} {v.watched === 1 ? 'person' : 'people'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  )
}

export function TrainingSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-2" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="min-h-60 rounded-xl border bg-card p-5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="mt-6 h-36 w-full" />
        </div>
      ))}
    </div>
  )
}
