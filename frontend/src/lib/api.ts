import axios, { AxiosError, type AxiosInstance } from 'axios'
import { toast } from 'sonner'

import { env } from './env'
import { tokenStore } from './token-store'

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Don't show the global error toast for this request (the caller shows its own UI). */
    skipErrorToast?: boolean
    /** Don't redirect to the login page on 401 (e.g. the login request itself). */
    skipAuthRedirect?: boolean
  }
}

/** The body the backend sends for every error: `{ error: { code, message, details } }`. */
export interface ApiErrorBody {
  code: string
  message: string
  details: Record<string, unknown>
}

/** Normalised error thrown by every API call. `status` is null for network failures. */
export class ApiError extends Error {
  readonly status: number | null
  readonly code: string
  readonly details: Record<string, unknown>
  readonly requestId: string | null

  constructor(params: {
    status: number | null
    code: string
    message: string
    details?: Record<string, unknown>
    requestId?: string | null
    cause?: unknown
  }) {
    super(params.message, { cause: params.cause })
    this.name = 'ApiError'
    this.status = params.status
    this.code = params.code
    this.details = params.details ?? {}
    this.requestId = params.requestId ?? null
  }

  get isNetworkError(): boolean {
    return this.status === null
  }

  get isServerError(): boolean {
    return this.status !== null && this.status >= 500
  }
}

const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again."
const SERVER_MESSAGE = 'Something went wrong on our side. Please try again.'
const TIMEOUT_MESSAGE = 'The server took too long to respond. Please try again.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readErrorBody(data: unknown): ApiErrorBody | null {
  if (!isRecord(data) || !isRecord(data.error)) return null
  const { code, message, details } = data.error
  if (typeof code !== 'string' || typeof message !== 'string') return null
  return { code, message, details: isRecord(details) ? details : {} }
}

/** Convert anything thrown by axios (or elsewhere) into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  if (error instanceof AxiosError) {
    const response = error.response
    if (!response) {
      const timedOut = error.code === AxiosError.ECONNABORTED || error.code === 'ETIMEDOUT'
      return new ApiError({
        status: null,
        code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE,
        cause: error,
      })
    }
    const body = readErrorBody(response.data)
    const requestId = (response.headers['x-request-id'] as string | undefined) ?? null
    if (body) {
      return new ApiError({ status: response.status, ...body, requestId, cause: error })
    }
    return new ApiError({
      status: response.status,
      code: response.status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR',
      message: response.status >= 500 ? SERVER_MESSAGE : `Request failed (${response.status}).`,
      requestId,
      cause: error,
    })
  }

  return new ApiError({
    status: null,
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : SERVER_MESSAGE,
    cause: error,
  })
}

export interface ApiHandlers {
  /** Called after a 401. The token has already been cleared. */
  onUnauthorized: (error: ApiError) => void
  /** Called for 5xx responses and network failures. */
  onServerError: (error: ApiError) => void
}

function redirectToLogin(): void {
  const { pathname, search } = window.location
  if (pathname === '/login') return
  const next = encodeURIComponent(`${pathname}${search}`)
  window.location.assign(`/login?next=${next}`)
}

function showErrorToast(error: ApiError): void {
  // A fixed id stops a burst of failing requests from stacking up identical toasts.
  toast.error(error.message, {
    id: `api-error-${error.code}`,
    description: error.requestId ? `Reference: ${error.requestId}` : undefined,
  })
}

const defaultHandlers: ApiHandlers = {
  onUnauthorized: redirectToLogin,
  onServerError: showErrorToast,
}

let handlers: ApiHandlers = { ...defaultHandlers }

/** Replace the default 401 / 5xx behaviour (the app wires in router navigation). */
export function configureApiHandlers(overrides: Partial<ApiHandlers>): () => void {
  handlers = { ...handlers, ...overrides }
  return () => {
    handlers = { ...defaultHandlers }
  }
}

export function createApiClient(baseURL: string = env.apiBaseUrl): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 30_000,
    headers: { Accept: 'application/json' },
  })

  client.interceptors.request.use((config) => {
    const token = tokenStore.get()
    if (token) config.headers.set('Authorization', `Bearer ${token}`)
    return config
  })

  client.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      // Cancelled requests (e.g. TanStack Query aborting a stale fetch) are not failures.
      if (axios.isCancel(error)) return Promise.reject(error as Error)

      const apiError = toApiError(error)
      const config = error instanceof AxiosError ? error.config : undefined

      if (apiError.status === 401 && !config?.skipAuthRedirect) {
        tokenStore.clear()
        handlers.onUnauthorized(apiError)
      } else if ((apiError.isServerError || apiError.isNetworkError) && !config?.skipErrorToast) {
        handlers.onServerError(apiError)
      }
      return Promise.reject(apiError)
    },
  )

  return client
}

/** The app-wide API client. Paths are relative to `/api`. */
export const api = createApiClient()
