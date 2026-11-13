import type { Draft } from '@/features/survey-logic/types'
import type { Issue } from '@/features/survey-logic/validation'

export type SurveyStatus = 'draft' | 'published' | 'closed'
export type SurveyKind = 'survey' | 'training'
export type MemberRole = 'owner' | 'coowner' | 'viewer'

export interface SurveyListItem {
  id: string
  title: string
  kind: SurveyKind
  status: SurveyStatus
  version_no: number | null
  response_count: number
  responses_this_week: number
  audience_count: number
  response_rate: number | null
  opens_at: string | null
  closes_at: string | null
  has_unpublished_changes: boolean
  my_role: MemberRole | null
  can_edit: boolean
  can_delete: boolean
  open_to_all: boolean
  updated_at: string
  /**
   * Trainings: `response_count` counts people who completed. People who passed and their
   * share of those who completed (null with no pass mark), and the due date.
   */
  passed_count?: number | null
  pass_rate?: number | null
  due_date?: string | null
}

export interface SurveyDetail {
  id: string
  title: string
  kind: SurveyKind
  status: SurveyStatus
  version_no: number | null
  draft: Draft
  draft_updated_at: string
  has_unpublished_changes: boolean
  open_to_all: boolean
  my_role: MemberRole | null
  can_edit: boolean
  can_delete: boolean
  closed_at: string | null
  created_at: string
  updated_at: string
}

export interface PublishResponse {
  status: SurveyStatus
  version_no: number
  published_at: string
  has_unpublished_changes: boolean
}

export interface CloseResponse {
  status: SurveyStatus
  closed_at: string
}

export interface ThemeAsset {
  id: string
  kind: 'gallery' | 'upload'
  name: string
  width: number
  height: number
  /** Signed links: work in <img> without a token, for about a day. */
  url: string
  mobile_url: string
}

export interface ValidateResponse {
  issues: Issue[]
  /** Worth knowing, but publishing goes ahead. */
  warnings: Issue[]
}

export const UNTITLED_SURVEY = 'Untitled survey'
export const UNTITLED_TRAINING = 'Untitled training'

/** An uploaded training video. */
export interface VideoAsset {
  id: string
  file_name: string
  content_type: string
  size_bytes: number
  duration_seconds: number | null
  /** Signed link: plays in <video> without a token, for about a day. */
  url: string
  /** A published version uses it, so it can't be deleted. */
  published: boolean
}
