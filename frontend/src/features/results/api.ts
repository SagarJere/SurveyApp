import { api } from '@/lib/api'
import { downloadFile } from '@/lib/download'

/** Filters live in the URL so a filtered view can be shared. */
export interface ResultFilters {
  department: string | null
  location: string | null
  from: string | null
  to: string | null
  version: number | null
}

export interface ResultsSummary {
  small_group: boolean
  responses: number
  respondents: number
  invited: number | null
  response_rate: number | null
  responses_this_week: number
  last_response_at: string | null
  headline: { question_key: string; text: string; average: number | null } | null
  money: {
    question_key: string
    text: string
    currency: string
    median: number
    median_formatted: string
    median_words: string
  } | null
  title: string
  status: 'draft' | 'published' | 'closed'
  anonymous: boolean
  open_to_all: boolean
  versions: { version_no: number; published_at: string; responses: number }[]
  compatible_versions: boolean
  version_applied: number | null
  filter_options: { departments: string[]; locations: string[] }
  can_download_non_responders: boolean
  closes_at: string | null
}

export interface Timeline {
  days: { day: string; n: number }[]
  reminders: string[]
}

export interface DepartmentRow {
  department: string | null
  invited: number | null
  responded: number
  rate: number | null
}

export interface ParticipationResult {
  open_to_all: boolean
  departments: DepartmentRow[]
}

export interface QuestionResult {
  key: string
  number: number
  type: 'single' | 'multi' | 'dropdown' | 'rating' | 'short' | 'long' | 'money' | 'number'
  text: string
  required: boolean
  condition: { src: string; op: string; val: unknown } | null
  shown: number
  answered: number
  options?: { key: string; label: string; n: number; share: number }[] | null
  average?: number | null
  distribution?: { value: number; n: number; share: number }[] | null
  currency?: string | null
  /** Number questions: e.g. "people". */
  unit?: string | null
  stats?: {
    total: number | null
    average: number | null
    median: number | null
    min: number | null
    max: number | null
    average_words: string | null
    median_words: string | null
  } | null
  ranges?: { label: string; n: number; share: number }[] | null
}

export interface QuestionsResult {
  small_group: boolean
  responses: number
  sections: {
    key: string
    title: string
    description: string
    condition: { src: string; op: string; val: unknown } | null
    questions: QuestionResult[]
  }[]
}

export interface CommentsResult {
  small_group: boolean
  total: number
  page: number
  page_size: number
  items: {
    question_key: string
    number: number | null
    text: string
    department: string | null
    location: string | null
    submitted_on: string
    employee: { employee_id: string; name: string | null } | null
  }[]
}

export interface ResponseRow {
  id: string
  employee_id: string | null
  name: string | null
  department: string | null
  location: string | null
  submitted_at: string
  version_no: number
}

export interface ResponsesPage {
  total: number
  page: number
  page_size: number
  items: ResponseRow[]
}

export interface ResponseDetail extends ResponseRow {
  answers: { key: string; number: number; type: string; text: string; answer: string }[]
}

function params(filters: ResultFilters, extra: Record<string, string | number | undefined> = {}) {
  const out: Record<string, string | number> = {}
  if (filters.department !== null) out.department = filters.department
  if (filters.location !== null) out.location = filters.location
  if (filters.from) out.from = filters.from
  if (filters.to) out.to = filters.to
  if (filters.version) out.version = filters.version
  for (const [key, value] of Object.entries(extra))
    if (value !== undefined && value !== '') out[key] = value
  return out
}

export const resultKeys = {
  all: (id: string) => ['survey', id, 'results'] as const,
  part: (id: string, part: string, filters: ResultFilters, extra?: unknown) =>
    ['survey', id, 'results', part, filters, extra] as const,
}

const base = (id: string) => `/surveys/${id}/results`

async function fetchPart<T>(
  id: string,
  part: string,
  filters: ResultFilters,
  signal?: AbortSignal,
  extra?: Record<string, string | number | undefined>,
) {
  return (await api.get<T>(`${base(id)}/${part}`, { params: params(filters, extra), signal })).data
}

export const getSummary = (id: string, f: ResultFilters, signal?: AbortSignal) =>
  fetchPart<ResultsSummary>(id, 'summary', f, signal)
export const getTimeline = (id: string, f: ResultFilters, signal?: AbortSignal) =>
  fetchPart<Timeline>(id, 'timeline', f, signal)
export const getParticipation = (id: string, f: ResultFilters, signal?: AbortSignal) =>
  fetchPart<ParticipationResult>(id, 'participation', f, signal)
export const getQuestions = (id: string, f: ResultFilters, signal?: AbortSignal) =>
  fetchPart<QuestionsResult>(id, 'questions', f, signal)
export const getComments = (
  id: string,
  f: ResultFilters,
  query: { question_key?: string; search?: string; page: number },
  signal?: AbortSignal,
) => fetchPart<CommentsResult>(id, 'comments', f, signal, query)
export const getResponses = (id: string, f: ResultFilters, page: number, signal?: AbortSignal) =>
  fetchPart<ResponsesPage>(id, 'responses', f, signal, { page })
export async function getResponse(id: string, responseId: string): Promise<ResponseDetail> {
  return (await api.get<ResponseDetail>(`${base(id)}/responses/${responseId}`)).data
}

function query(filters: ResultFilters): string {
  const search = new URLSearchParams(
    Object.entries(params(filters)).map(([k, v]) => [k, String(v)]),
  )
  const text = search.toString()
  return text ? `?${text}` : ''
}

export type ExportKind = 'responses' | 'analytics'

const EXPORT_NAMES: Record<ExportKind, string> = {
  responses: 'responses',
  analytics: 'results with analytics',
}

/** `responses`: one row per response. `analytics`: summary with charts, participation, etc. */
export function downloadExport(
  id: string,
  filters: ResultFilters,
  title: string,
  kind: ExportKind,
): Promise<void> {
  const search = query(filters)
  return downloadFile(
    `${base(id)}/export.xlsx${search}${search ? '&' : '?'}kind=${kind}`,
    `${title || 'Survey'} - ${EXPORT_NAMES[kind]}.xlsx`,
  )
}

export function downloadNonResponders(
  id: string,
  filters: ResultFilters,
  title: string,
): Promise<void> {
  return downloadFile(
    `${base(id)}/non-responders.xlsx${query(filters)}`,
    `${title || 'Survey'} - not yet responded.xlsx`,
  )
}
