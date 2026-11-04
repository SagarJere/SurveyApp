import { api } from '@/lib/api'
import { downloadFile } from '@/lib/download'

export type UploadMode = 'append' | 'replace'

export interface RowToFix {
  row: number
  employee_id: string
  problem: string
}

export interface UploadPreview {
  upload_id: string
  file_name: string
  mode: UploadMode
  status: 'preview' | 'applied' | 'discarded'
  valid_count: number
  duplicate_count: number
  error_count: number
  errors: RowToFix[]
  errors_truncated: boolean
}

export interface AudienceMember {
  employee_id: string
  name: string | null
  email: string | null
  department: string | null
  location: string | null
  added_at: string
  responded: boolean
}

export interface AudienceList {
  open_to_all: boolean
  total: number
  matching: number
  page: number
  page_size: number
  items: AudienceMember[]
  departments: { department: string | null; count: number }[]
  can_replace: boolean
}

export interface AudienceQuery {
  search: string
  /** "" means "no department"; null means all. */
  department: string | null
  page: number
}

export const audienceKeys = {
  all: (surveyId: string) => ['survey', surveyId, 'audience'] as const,
  list: (surveyId: string, query: AudienceQuery) =>
    ['survey', surveyId, 'audience', query] as const,
}

const base = (surveyId: string) => `/surveys/${surveyId}/audience`

export async function listAudience(
  surveyId: string,
  query: AudienceQuery,
  signal?: AbortSignal,
): Promise<AudienceList> {
  const params: Record<string, string | number> = { page: query.page }
  if (query.search.trim()) params.search = query.search.trim()
  if (query.department !== null) params.department = query.department
  return (await api.get<AudienceList>(base(surveyId), { params, signal })).data
}

export async function uploadAudience(
  surveyId: string,
  file: File,
  mode: UploadMode,
): Promise<UploadPreview> {
  const form = new FormData()
  form.append('file', file)
  return (
    await api.post<UploadPreview>(`${base(surveyId)}/uploads`, form, {
      params: { mode },
      skipErrorToast: true, // problems with the file are shown on the upload card
    })
  ).data
}

export async function applyUpload(
  surveyId: string,
  uploadId: string,
): Promise<{ audience_count: number }> {
  return (await api.post<{ audience_count: number }>(`${base(surveyId)}/uploads/${uploadId}/apply`))
    .data
}

export async function discardUpload(surveyId: string, uploadId: string): Promise<void> {
  await api.post(`${base(surveyId)}/uploads/${uploadId}/discard`)
}

export async function removeMember(surveyId: string, employeeId: string): Promise<void> {
  await api.delete(`${base(surveyId)}/${encodeURIComponent(employeeId)}`)
}

export async function setOpenToAll(surveyId: string, openToAll: boolean): Promise<void> {
  await api.put(`${base(surveyId)}/open-to-all`, { open_to_all: openToAll })
}

export function downloadTemplate(surveyId: string): Promise<void> {
  return downloadFile(`${base(surveyId)}/template`, 'audience_template.xlsx')
}

export function downloadRowsToFix(surveyId: string, uploadId: string): Promise<void> {
  return downloadFile(`${base(surveyId)}/uploads/${uploadId}/errors.xlsx`, 'rows_to_fix.xlsx')
}
