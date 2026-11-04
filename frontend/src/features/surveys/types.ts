import type { Draft } from '@/features/survey-logic/types'
import type { Issue } from '@/features/survey-logic/validation'

export type SurveyStatus = 'draft' | 'published' | 'closed'
export type MemberRole = 'owner' | 'coowner' | 'viewer'

export interface SurveyListItem {
  id: string
  title: string
  status: SurveyStatus
  version_no: number | null
  response_count: number
  audience_count: number
  response_rate: number | null
  opens_at: string | null
  closes_at: string | null
  has_unpublished_changes: boolean
  my_role: MemberRole | null
  can_edit: boolean
  can_delete: boolean
  updated_at: string
}

export interface SurveyDetail {
  id: string
  title: string
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
}

export const UNTITLED_SURVEY = 'Untitled survey'
