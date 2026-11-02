import { api } from '@/lib/api'

export interface HealthResponse {
  status: 'ok'
  database: 'ok'
  environment: string
  version: string
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  // The status indicator shows failures itself, so skip the global error toast.
  const response = await api.get<HealthResponse>('/health', { signal, skipErrorToast: true })
  return response.data
}
