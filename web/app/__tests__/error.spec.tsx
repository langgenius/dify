import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CommonLayoutError from '@/app/(commonLayout)/error'
import AppError from '@/app/error'

describe('route error recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    {
      name: 'root error',
      renderError: (retry: () => void) => <AppError error={new Error('failed')} reset={retry} />,
    },
    {
      name: 'common layout error',
      renderError: (retry: () => void) => (
        <CommonLayoutError error={new Error('failed')} unstable_retry={retry} />
      ),
    },
  ])('resets failed queries before retrying the $name', async ({ renderError }) => {
    const user = userEvent.setup()
    const retry = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <QueryErrorResetBoundary>
        {({ isReset }) => renderError(() => retry(isReset()))}
      </QueryErrorResetBoundary>,
    )

    await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))

    expect(retry).toHaveBeenCalledWith(true)
  })
})
