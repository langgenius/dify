import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './error-boundary'
import '@testing-library/jest-dom'

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Hello world</div>
      </ErrorBoundary>,
    )

    expect(screen.getByTestId('child')).toHaveTextContent('Hello world')
    expect(consoleErrorSpy).not.toHaveBeenCalled()
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

    expect(
      screen.getByText(/Oops! An error occurred/i),
    ).toBeInTheDocument()

    expect(consoleErrorSpy).toHaveBeenCalled()

    const hasLoggedOurError = consoleErrorSpy.mock.calls.some((call: unknown[]) =>
      call.includes(testError),
    )

    expect(hasLoggedOurError).toBe(true)
  })
})
