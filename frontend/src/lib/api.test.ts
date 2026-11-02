import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, configureApiHandlers, createApiClient, toApiError } from './api'
import { tokenStore } from './token-store'

interface Reply {
  status: number
  data?: unknown
  headers?: Record<string, string>
}

/** Build an axios adapter that answers like a server would, recording each request. */
function fakeServer(reply: Reply | 'network-error') {
  const requests: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = (config) => {
    requests.push(config)
    if (reply === 'network-error') {
      return Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config))
    }
    const response = {
      data: reply.data ?? {},
      status: reply.status,
      statusText: String(reply.status),
      headers: new AxiosHeaders(reply.headers ?? {}),
      config,
    }
    if (reply.status >= 400) {
      return Promise.reject(
        new AxiosError(`Status ${reply.status}`, 'ERR_BAD_RESPONSE', config, null, response),
      )
    }
    return Promise.resolve(response)
  }
  return { adapter, requests }
}

function clientFor(reply: Reply | 'network-error') {
  const server = fakeServer(reply)
  const client = createApiClient('/api')
  client.defaults.adapter = server.adapter
  return { client, requests: server.requests }
}

async function rejectionOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw new Error(`Expected ApiError, got ${String(error)}`)
  }
  throw new Error('Expected the request to fail')
}

describe('api client', () => {
  const onUnauthorized = vi.fn()
  const onServerError = vi.fn()
  let reset: () => void

  beforeEach(() => {
    reset = configureApiHandlers({ onUnauthorized, onServerError })
  })

  afterEach(() => {
    reset()
    tokenStore.clear()
    onUnauthorized.mockReset()
    onServerError.mockReset()
  })

  it('sends the stored token as a bearer header', async () => {
    tokenStore.set('jwt-123')
    const { client, requests } = clientFor({ status: 200, data: { ok: true } })

    await client.get('/health')

    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer jwt-123')
  })

  it('sends no Authorization header without a token', async () => {
    const { client, requests } = clientFor({ status: 200 })

    await client.get('/health')

    expect(requests[0]?.headers.has('Authorization')).toBe(false)
  })

  it('maps the backend error body into ApiError', async () => {
    const { client } = clientFor({
      status: 409,
      data: {
        error: { code: 'CONFLICT', message: 'Someone else edited this survey.', details: { a: 1 } },
      },
      headers: { 'x-request-id': 'req-1' },
    })

    const error = await rejectionOf(client.put('/surveys/1/draft'))

    expect(error.status).toBe(409)
    expect(error.code).toBe('CONFLICT')
    expect(error.message).toBe('Someone else edited this survey.')
    expect(error.details).toEqual({ a: 1 })
    expect(error.requestId).toBe('req-1')
    expect(onServerError).not.toHaveBeenCalled()
  })

  it('clears the token and calls onUnauthorized on 401', async () => {
    tokenStore.set('expired')
    const { client } = clientFor({
      status: 401,
      data: { error: { code: 'UNAUTHORIZED', message: 'Session expired.', details: {} } },
    })

    await rejectionOf(client.get('/auth/me'))

    expect(tokenStore.get()).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it('skips the 401 redirect when asked', async () => {
    const { client } = clientFor({ status: 401 })

    await rejectionOf(client.post('/auth/login', {}, { skipAuthRedirect: true }))

    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('reports 5xx responses to onServerError', async () => {
    const { client } = clientFor({ status: 500, data: 'Internal Server Error' })

    const error = await rejectionOf(client.get('/health'))

    expect(error.code).toBe('INTERNAL_ERROR')
    expect(error.isServerError).toBe(true)
    expect(onServerError).toHaveBeenCalledWith(error)
  })

  it('reports network failures with a friendly message', async () => {
    const { client } = clientFor('network-error')

    const error = await rejectionOf(client.get('/health'))

    expect(error.status).toBeNull()
    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.message).toMatch(/can't reach the server/i)
    expect(onServerError).toHaveBeenCalledOnce()
  })

  it('does not toast when the request opts out', async () => {
    const { client } = clientFor({ status: 503 })

    await rejectionOf(client.get('/health', { skipErrorToast: true }))

    expect(onServerError).not.toHaveBeenCalled()
  })

  it('does not toast 4xx errors', async () => {
    const { client } = clientFor({ status: 404 })

    await rejectionOf(client.get('/missing'))

    expect(onServerError).not.toHaveBeenCalled()
  })
})

describe('toApiError', () => {
  it('wraps unknown errors', () => {
    const error = toApiError(new Error('boom'))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('UNKNOWN_ERROR')
    expect(error.message).toBe('boom')
  })

  it('returns ApiError instances unchanged', () => {
    const original = new ApiError({ status: 400, code: 'BAD_REQUEST', message: 'Bad' })

    expect(toApiError(original)).toBe(original)
  })

  it('reports timeouts distinctly', () => {
    const error = toApiError(new AxiosError('timeout', AxiosError.ECONNABORTED))

    expect(error.code).toBe('TIMEOUT')
  })
})
