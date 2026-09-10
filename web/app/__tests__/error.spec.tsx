import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import CommonLayoutError from '@/app/(commonLayout)/error'
import AppError from '@/app/error'

type ErrorRecoveryProps = Readonly<{
  retry: () => void
}>

const routeErrors = [
  {
    name: 'root error',
    renderError: (props: ErrorRecoveryProps) => <AppError error={new Error('failed')} {...props} />,
  },
  {
    name: 'common layout error',
    renderError: (props: ErrorRecoveryProps) => (
      <CommonLayoutError error={new Error('failed')} {...props} />
    ),
  },
]

describe('route error recovery', () => {
  afterEach(() => {
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
              retry: () => retry(isReset()),
            })
          }
        </QueryErrorResetBoundary>,
      )

      await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))

      expect(retry).toHaveBeenCalledWith(true)
    },
  )
})
