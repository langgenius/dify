import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import ErrorBoundary from '../error-boundary'

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('catches errors thrown in children, shows fallback UI and logs the error', () => {
    const testError = new Error('Test render error')

    const Thrower: React.FC = () => {
      throw testError
    }

    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>,
    )

    expect(screen.getByText(/Oops! An error occurred/i)).toBeInTheDocument()

    expect(consoleErrorSpy).toHaveBeenCalledWith(testError, expect.anything())
  })
})
