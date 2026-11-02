import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import { renderWithProviders } from '@/test/render'

import * as healthApi from './api'
import { HealthStatus } from './HealthStatus'

const OK = { status: 'ok', database: 'ok', environment: 'test', version: '0.1.0' } as const

describe('HealthStatus', () => {
  it('shows "Connected" when the API answers', async () => {
    vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue(OK)

    renderWithProviders(<HealthStatus />)

    expect(screen.getByRole('status')).toHaveTextContent('Checking connection…')
    expect(await screen.findByText('Connected')).toBeInTheDocument()
  })

  it('shows "Server unreachable" with the reason when the API fails', async () => {
    vi.spyOn(healthApi, 'fetchHealth').mockRejectedValue(
      new ApiError({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'The database is not reachable.',
      }),
    )

    renderWithProviders(<HealthStatus />)

    expect(await screen.findByText('Server unreachable', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute(
      'title',
      'The database is not reachable. Click to check again.',
    )
  })

  it('re-checks when clicked', async () => {
    const fetchHealth = vi
      .spyOn(healthApi, 'fetchHealth')
      .mockRejectedValueOnce(
        new ApiError({ status: null, code: 'NETWORK_ERROR', message: 'Offline' }),
      )
      .mockRejectedValueOnce(
        new ApiError({ status: null, code: 'NETWORK_ERROR', message: 'Offline' }),
      )
      .mockResolvedValue(OK)

    renderWithProviders(<HealthStatus />)
    await screen.findByText('Server unreachable', {}, { timeout: 4000 })

    await userEvent.click(screen.getByRole('button'))

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchHealth).toHaveBeenCalledTimes(3)
    })
  })
})
