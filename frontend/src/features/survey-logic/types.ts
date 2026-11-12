/** The builder's draft document. Mirrors backend/app/schemas/draft.py (docs/03-data-model.md). */

export type QuestionType =
  'single' | 'multi' | 'dropdown' | 'rating' | 'short' | 'long' | 'money' | 'number'
export type ConditionOp = 'is' | 'not' | 'gte' | 'lte' | 'gt' | 'lt'
export type Currency = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED'
export type Layout = 'all' | 'section' | 'step'
export type BackgroundStyle = 'none' | 'color' | 'image'

export interface Condition {
  /** Key of the question this depends on. */
  src: string
  op: ConditionOp
  /** Option key for choice sources, a number for rating, money and number sources. */
  val: string | number | null
}

export interface Option {
  key: string
  label: string
}

export interface MoneyConfig {
  currency: Currency
  min: number | null
  max: number | null
  decimals: boolean
}

/** Number settings. Prefixed, so switching between Money and Number keeps both. */
export interface NumberConfig {
  number_min: number | null
  number_max: number | null
  number_decimals: boolean
  /** Shown after the answer box and in results, e.g. "people", "km". */
  number_unit: string
}

export interface Question {
  key: string
  section_key: string
  type: QuestionType
  text: string
  help: string
  required: boolean
  options: Option[]
  /** Money or number settings. Kept when the type changes, so changing back restores them. */
  config: Partial<MoneyConfig> & Partial<NumberConfig> & Record<string, unknown>
  condition: Condition | null
}

/** Trainings: the video at the top of a section (docs/09-trainings.md). */
export interface SectionVideo {
  source: 'upload' | 'link'
  /** source "upload": the uploaded video's id. */
  asset_id?: string | null
  /** source "link": an http(s) address of an MP4/WebM on the internal video server. */
  url?: string | null
  allow_seek: boolean
  allow_speed: boolean
}

export interface Section {
  key: string
  title: string
  description: string
  condition: Condition | null
  /** Trainings only. */
  video?: SectionVideo | null
}

export interface SurveySettings {
  layout: Layout
  show_navigator: boolean
  auto_next: boolean
  one_response: boolean
  allow_edit: boolean
  anonymous: boolean
  opens_at: string | null
  closes_at: string | null
}

export interface Theme {
  cover: string | null
  background_style: BackgroundStyle
  background: string | null
  background_color: string
  blur: boolean
  overlay: number
  accent: string
}

export interface Draft {
  title: string
  description: string
  settings: SurveySettings
  theme: Theme
  sections: Section[]
  /** Always in display order, grouped by section in section order. */
  questions: Question[]
}

/** Answers keyed by question key. */
export type Answers = Record<string, unknown>
