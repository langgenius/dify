import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary, { ErrorFallback, useAsyncError, useErrorHandler, withErrorBoundary } from './index'

const mockConfig = vi.hoisted(() => ({
  isDev: false,
}))

vi.mock('@/config', () => ({
  get IS_DEV() {
    return mockConfig.isDev
  },
}))

type ThrowOnRenderProps = {
  message?: string
  shouldThrow: boolean
}

const ThrowOnRender = ({ shouldThrow, message = 'render boom' }: ThrowOnRenderProps) => {
  if (shouldThrow)
    throw new Error(message)

  return <div>Child content rendered</div>
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.isDev = false
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  // Verify default render and default fallback behavior.
  describe('Rendering', () => {
    it('should render children when no error occurs', () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender shouldThrow={false} />
        </ErrorBoundary>,
      )

      expect(screen.getByText('Child content rendered')).toBeInTheDocument()
    })

    it('should render default fallback with title and message when child throws', async () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender shouldThrow={true} />
        </ErrorBoundary>,
      )

      expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
      expect(screen.getByText('An unexpected error occurred while rendering this component.')).toBeInTheDocument()
    })

    it('should render custom title, message, and className in fallback', async () => {
      render(
        <ErrorBoundary
          className="custom-boundary"
          customMessage="Custom recovery message"
          customTitle="Custom crash title"
          isolate={false}
        >
          <ThrowOnRender shouldThrow={true} />
        </ErrorBoundary>,
      )

      expect(await screen.findByText('Custom crash title')).toBeInTheDocument()
      expect(screen.getByText('Custom recovery message')).toBeInTheDocument()

      const fallbackRoot = document.querySelector('.custom-boundary')
      expect(fallbackRoot).toBeInTheDocument()
      expect(fallbackRoot).not.toHaveClass('min-h-[200px]')
    })
  })

  // Validate explicit fallback prop variants.
  describe('Fallback props', () => {
    it('should render node fallback when fallback prop is a React node', async () => {
      render(
        <ErrorBoundary fallback={<div>Node fallback content</div>}>
          <ThrowOnRender shouldThrow={true} />
        </ErrorBoundary>,
      )

      expect(await screen.findByText('Node fallback content')).toBeInTheDocument()
    })

    it('should render function fallback with error message when fallback prop is a function', async () => {
      render(
        <ErrorBoundary
          fallback={error => (
            <div>
              Function fallback:
              {' '}
              {error.message}
            </div>
          )}
        >
          <ThrowOnRender message="function fallback boom" shouldThrow={true} />
        </ErrorBoundary>,
      )

      expect(await screen.findByText('Function fallback: function fallback boom')).toBeInTheDocument()
    })
  })

  // Validate error reporting and details panel behavior.
  describe('Error reporting', () => {
    it('should call onError with error and errorInfo when child throws', async () => {
      const onError = vi.fn()

      render(
        <ErrorBoundary onError={onError}>
          <ThrowOnRender shouldThrow={true} />
        </ErrorBoundary>,
      )

      await screen.findByText('Something went wrong')

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'render boom' }),
        expect.objectContaining({ componentStack: expect.any(String) }),
      )
    })

    it('should render details block when showDetails is true', async () => {
      render(
        <ErrorBoundary showDetails={true}>
          <ThrowOnRender message="details boom" shouldThrow={true} />
        </ErrorBoundary>,
      )

      expect(await screen.findByText('Error Details (Development Only)')).toBeInTheDocument()
      expect(screen.getByText('Error:')).toBeInTheDocument()
      expect(screen.getByText(/details boom/i)).toBeInTheDocument()
    })

    it('should log boundary errors in development mode', async () => {
      mockConfig.isDev = true

      render(
        <ErrorBoundary>
          <ThrowOnRender message="dev boom" shouldThrow={true} />
        </ErrorBoundary>,
      )

      await screen.findByText('Something went wrong')

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'ErrorBoundary caught an error:',
        expect.objectContaining({ message: 'dev boom' }),
      )
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error Info:',
        expect.objectContaining({ componentStack: expect.any(String) }),
      )
    })
  })

  // Validate recovery controls and automatic reset triggers.
  describe('Recovery', () => {
    it('should hide recovery actions when enableRecovery is false', async () => {
      render(
        <ErrorBoundary enableRecovery={false}>
          <ThrowOnRender shouldThrow={true} />
        </ErrorBoundary>,
      )

      await screen.findByText('Something went wrong')

      expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reload Page' })).not.toBeInTheDocument()
    })

    it('should reset and render children when Try Again is clicked', async () => {
      const onReset = vi.fn()

      const RecoveryHarness = () => {
        const [shouldThrow, setShouldThrow] = React.useState(true)
        return (
          <ErrorBoundary
            onReset={() => {
              onReset()
              setShouldThrow(false)
            }}
          >
            <ThrowOnRender shouldThrow={shouldThrow} />
          </ErrorBoundary>
        )
      }

      render(<RecoveryHarness />)
      fireEvent.click(await screen.findByRole('button', { name: 'Try Again' }))

      await screen.findByText('Child content rendered')
      expect(onReset).toHaveBeenCalledTimes(1)
    })

    it('should reset after resetKeys change when boundary is in error state', async () => {
      const ResetKeysHarness = () => {
        const [shouldThrow, setShouldThrow] = React.useState(true)
        const [boundaryKey, setBoundaryKey] = React.useState(0)

        return (
          <>
            <button
              onClick={() => {
                setShouldThrow(false)
                setBoundaryKey(1)
              }}
            >
              Recover with keys
            </button>
            <ErrorBoundary resetKeys={[boundaryKey]}>
              <ThrowOnRender shouldThrow={shouldThrow} />
            </ErrorBoundary>
          </>
        )
      }

      render(<ResetKeysHarness />)
      await screen.findByText('Something went wrong')

      fireEvent.click(screen.getByRole('button', { name: 'Recover with keys' }))

      await waitFor(() => {
        expect(screen.getByText('Child content rendered')).toBeInTheDocument()
      })
    })

    it('should reset after children change when resetOnPropsChange is true', async () => {
      const ResetOnPropsHarness = () => {
        const [shouldThrow, setShouldThrow] = React.useState(true)
        const [childLabel, setChildLabel] = React.useState('first child')

        return (
          <>
            <button
              onClick={() => {
                setShouldThrow(false)
                setChildLabel('second child')
              }}
            >
              Replace children
            </button>
            <ErrorBoundary resetOnPropsChange={true}>
              {shouldThrow ? <ThrowOnRender shouldThrow={true} /> : <div>{childLabel}</div>}
            </ErrorBoundary>
          </>
        )
      }

      render(<ResetOnPropsHarness />)
      await screen.findByText('Something went wrong')

      fireEvent.click(screen.getByRole('button', { name: 'Replace children' }))

      await waitFor(() => {
        expect(screen.getByText('second child')).toBeInTheDocument()
      })
    })
  })
})

describe('ErrorBoundary utility exports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  // Validate imperative error hook behavior.
  describe('useErrorHandler', () => {
    it('should trigger error boundary fallback when setError is called', async () => {
      const HookConsumer = () => {
        const setError = useErrorHandler()
        return (
          <button onClick={() => setError(new Error('handler boom'))}>
            Trigger hook error
          </button>
        )
      }

      render(
        <ErrorBoundary fallback={<div>Hook fallback shown</div>}>
          <HookConsumer />
        </ErrorBoundary>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Trigger hook error' }))

      expect(await screen.findByText('Hook fallback shown')).toBeInTheDocument()
    })
  })

  // Validate async error bridge hook behavior.
  describe('useAsyncError', () => {
    it('should trigger error boundary fallback when async error callback is called', async () => {
      const AsyncHookConsumer = () => {
        const throwAsyncError = useAsyncError()
        return (
          <button onClick={() => throwAsyncError(new Error('async hook boom'))}>
            Trigger async hook error
          </button>
        )
      }

      render(
        <ErrorBoundary fallback={<div>Async fallback shown</div>}>
          <AsyncHookConsumer />
        </ErrorBoundary>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Trigger async hook error' }))

      expect(await screen.findByText('Async fallback shown')).toBeInTheDocument()
    })
  })

  // Validate HOC wrapper behavior and metadata.
  describe('withErrorBoundary', () => {
    it('should wrap component and render custom title when wrapped component throws', async () => {
      type WrappedProps = {
        shouldThrow: boolean
      }

      const WrappedTarget = ({ shouldThrow }: WrappedProps) => {
        if (shouldThrow)
          throw new Error('wrapped boom')
        return <div>Wrapped content</div>
      }

      const Wrapped = withErrorBoundary(WrappedTarget, {
        customTitle: 'Wrapped boundary title',
      })

      render(<Wrapped shouldThrow={true} />)

      expect(await screen.findByText('Wrapped boundary title')).toBeInTheDocument()
    })

    it('should set displayName using wrapped component name', () => {
      const NamedComponent = () => <div>named content</div>
      const Wrapped = withErrorBoundary(NamedComponent)

      expect(Wrapped.displayName).toBe('withErrorBoundary(NamedComponent)')
    })
  })

  // Validate simple fallback helper component.
  describe('ErrorFallback', () => {
    it('should render message and call reset action when button is clicked', () => {
      const resetErrorBoundaryAction = vi.fn()

      render(
        <ErrorFallback
          error={new Error('fallback helper message')}
          resetErrorBoundaryAction={resetErrorBoundaryAction}
        />,
      )

      expect(screen.getByText('Oops! Something went wrong')).toBeInTheDocument()
      expect(screen.getByText('fallback helper message')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

      expect(resetErrorBoundaryAction).toHaveBeenCalledTimes(1)
    })
  })
})
