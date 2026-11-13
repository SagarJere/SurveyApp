import type { SurveyListItem, SurveyStatus } from '@/features/surveys/types'

export interface HomeKpis {
  live: number
  responsesThisWeek: number
  /** Average response rate across live surveys that have an invite list. Null when none do. */
  averageRate: number | null
  /** Trainings: average pass rate across live trainings with a pass mark and completions. */
  averagePassRate: number | null
}

function average(values: (number | null | undefined)[]): number | null {
  const known = values.filter((v): v is number => v !== null && v !== undefined)
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null
}

export function homeKpis(surveys: SurveyListItem[]): HomeKpis {
  const live = surveys.filter((s) => s.status === 'published')
  return {
    live: live.length,
    // Trainings count people completing (first attempts), not every retake.
    responsesThisWeek: surveys.reduce((sum, s) => sum + s.responses_this_week, 0),
    averageRate: average(live.map((s) => s.response_rate)),
    averagePassRate: average(live.map((s) => s.pass_rate)),
  }
}

/** "Due 16 Nov", "Due today", "Due tomorrow", "Overdue since 12 Nov" relative to today. */
export function dueText(dueDate: string, today: string = localToday()): string {
  const days = dayNumber(dueDate) - dayNumber(today)
  if (days < 0) return `Overdue since ${formatDay(dueDate)}`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days <= CLOSING_SOON_DAYS) return `Due in ${String(days)} days`
  return `Due ${formatDay(dueDate)}`
}

function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1)))
}

/** Today's date as YYYY-MM-DD in the browser's time zone. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1) / 86_400_000
}

export const CLOSING_SOON_DAYS = 7

/** "Closes today", "Closes tomorrow", "Closes in 3 days" for live surveys closing within a week. */
export function closingSoon(survey: SurveyListItem, today: string = localToday()): string | null {
  if (survey.status !== 'published' || !survey.closes_at) return null
  const days = dayNumber(survey.closes_at) - dayNumber(today)
  if (days < 0 || days > CLOSING_SOON_DAYS) return null
  if (days === 0) return 'Closes today'
  if (days === 1) return 'Closes tomorrow'
  return `Closes in ${String(days)} days`
}

export type StatusFilter = SurveyStatus | 'all'

export function filterSurveys(
  surveys: SurveyListItem[],
  status: StatusFilter,
  search: string,
): SurveyListItem[] {
  const term = search.trim().toLocaleLowerCase()
  return surveys.filter(
    (s) =>
      (status === 'all' || s.status === status) &&
      (!term || (s.title.trim() || 'Untitled survey').toLocaleLowerCase().includes(term)),
  )
}
