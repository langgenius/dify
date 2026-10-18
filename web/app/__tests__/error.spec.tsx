import { ORPCError } from '@orpc/client'
import { QueryClient, QueryErrorResetBoundary } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import CommonLayoutError from '@/app/(commonLayout)/error'
import AppError from '@/app/error'
import { userProfileQueryOptions } from '@/features/account-profile/client'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('@/service/refresh-token', () => ({ refreshAccessTokenOrReLogin: refresh }))

type ErrorRecoveryProps = Readonly<{
  error: Error
  retry: () => void
}>

const routeErrors = [
  {
    name: 'root error',
    renderError: (props: ErrorRecoveryProps) => <AppError {...props} />,
  },
  {
    name: 'common layout error',
    renderError: (props: ErrorRecoveryProps) => <CommonLayoutError {...props} />,
  },
]

describe('route error recovery', () => {
  const originalUrl = window.location.href
  beforeEach(() => {
    refresh.mockReset()
  })

  afterEach(() => {
    window.history.replaceState({}, '', originalUrl)
    vi.restoreAllMocks()
  })

  it.each(routeErrors)(
    'retries the $name after resetting query errors',
    async ({ renderError }) => {
      const user = userEvent.setup()
      const retry = vi.fn()
      vi.spyOn(console, 'error').mockImplementation(() => {})

      render(
        <QueryErrorResetBoundary>
          {({ isReset }) =>
            renderError({
              error: new Error('failed'),
              retry: () => retry(isReset()),
            })
          }
        </QueryErrorResetBoundary>,
      )

      await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))

      expect(retry).toHaveBeenCalledWith(true)
    },
  )

  it.each(routeErrors)(
    'keeps the $name recoverable when token refresh is temporarily unavailable',
    async ({ renderError }) => {
      const user = userEvent.setup()
      const retry = vi.fn()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      window.history.replaceState({}, '', '/apps')
      const initialUrl = window.location.href
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        Response.json({ code: 'unauthorized', message: 'Expired access token' }, { status: 401 }),
      )
      const refreshError = new ORPCError('HTTP_ERROR', { status: 503 })
      refresh.mockRejectedValue(refreshError)
      const queryClient = new QueryClient()

      const error: unknown = await queryClient
        .query({ ...userProfileQueryOptions(), retryDelay: 0 })
        .catch((error: unknown) => error)

      expect(refresh).toHaveBeenCalled()
      expect(window.location.href).toBe(initialUrl)
      if (!(error instanceof Error)) throw new Error('Expected a profile request failure')
      render(
        <QueryErrorResetBoundary>
          {({ isReset }) => renderError({ error, retry: () => retry(isReset()) })}
        </QueryErrorResetBoundary>,
      )

      await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))
      expect(retry).toHaveBeenCalledWith(true)
      queryClient.clear()
    },
  )
})
