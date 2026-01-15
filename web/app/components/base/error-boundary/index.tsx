'use client'
import type { ErrorInfo, ReactNode } from 'react'
import { RiAlertLine, RiBugLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/app/components/base/button'
import { IS_DEV } from '@/config'
import { cn } from '@/utils/classnames'

type ErrorBoundaryState = {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  errorCount: number
}

type ErrorBoundaryProps = {
  children: ReactNode
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  onReset?: () => void
  showDetails?: boolean
  className?: string
  resetKeys?: Array<string | number>
  resetOnPropsChange?: boolean
  isolate?: boolean
  enableRecovery?: boolean
  customTitle?: string
  customMessage?: string
}

// Internal class component for error catching
class ErrorBoundaryInner extends React.Component<
  ErrorBoundaryProps & {
    resetErrorBoundary: () => void
    onResetKeysChange: (prevResetKeys?: Array<string | number>) => void
  },
  ErrorBoundaryState
> {
  constructor(props: any) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (IS_DEV) {
      console.error('ErrorBoundary caught an error:', error)
      console.error('Error Info:', errorInfo)
    }

    this.setState(prevState => ({
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }))

    if (this.props.onError)
      this.props.onError(error, errorInfo)
  }

  componentDidUpdate(prevProps: any) {
    const { resetKeys, resetOnPropsChange } = this.props
    const { hasError } = this.state

    if (hasError && prevProps.resetKeys !== resetKeys) {
      if (resetKeys?.some((key, idx) => key !== prevProps.resetKeys?.[idx]))
        this.props.resetErrorBoundary()
    }

    if (hasError && resetOnPropsChange && prevProps.children !== this.props.children)
      this.props.resetErrorBoundary()

    if (prevProps.resetKeys !== resetKeys)
      this.props.onResetKeysChange(prevProps.resetKeys)
  }

  render() {
    const { hasError, error, errorInfo, errorCount } = this.state
    const {
      fallback,
      children,
      showDetails = false,
      className,
      isolate = true,
      enableRecovery = true,
      customTitle,
      customMessage,
      resetErrorBoundary,
    } = this.props

    if (hasError && error) {
      if (fallback) {
        if (typeof fallback === 'function')
          return fallback(error, resetErrorBoundary)

        return fallback
      }

      return (
        <div
          className={cn(
            'border-state-critical-border bg-state-critical-hover-alt flex flex-col items-center justify-center rounded-lg border p-8',
            isolate && 'min-h-[200px]',
            className,
          )}
        >
          <div className="mb-4 flex items-center gap-2">
            <RiAlertLine className="text-state-critical-solid h-8 w-8" />
            <h2 className="text-xl font-semibold text-text-primary">
              {customTitle || 'Something went wrong'}
            </h2>
          </div>

          <p className="mb-6 text-center text-text-secondary">
            {customMessage || 'An unexpected error occurred while rendering this component.'}
          </p>

          {showDetails && errorInfo && (
            <details className="mb-6 w-full max-w-2xl">
              <summary className="mb-2 cursor-pointer text-sm font-medium text-text-tertiary hover:text-text-secondary">
                <span className="inline-flex items-center gap-1">
                  <RiBugLine className="h-4 w-4" />
                  Error Details (Development Only)
                </span>
              </summary>
              <div className="rounded-lg bg-gray-100 p-4">
                <div className="mb-2">
                  <span className="font-mono text-xs font-semibold text-gray-600">Error:</span>
                  <pre className="mt-1 overflow-auto whitespace-pre-wrap font-mono text-xs text-gray-800">
                    {error.toString()}
                  </pre>
                </div>
                {errorInfo && (
                  <div>
                    <span className="font-mono text-xs font-semibold text-gray-600">Component Stack:</span>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-gray-700">
                      {errorInfo.componentStack}
                    </pre>
                  </div>
                )}
                {errorCount > 1 && (
                  <div className="mt-2 text-xs text-gray-600">
                    This error has occurred
                    {' '}
                    {errorCount}
                    {' '}
                    times
                  </div>
                )}
              </div>
            </details>
          )}

          {enableRecovery && (
            <div className="flex gap-3">
              <Button
                variant="primary"
                size="small"
                onClick={resetErrorBoundary}
              >
                Try Again
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </Button>
            </div>
          )}
        </div>
      )
    }

    return children
  }
}

// Main functional component wrapper
const ErrorBoundary: React.FC<ErrorBoundaryProps> = (props) => {
  const [errorBoundaryKey, setErrorBoundaryKey] = useState(0)
  const resetKeysRef = useRef(props.resetKeys)
  const prevResetKeysRef = useRef<Array<string | number> | undefined>(undefined)

  const resetErrorBoundary = useCallback(() => {
    setErrorBoundaryKey(prev => prev + 1)
    props.onReset?.()
  }, [props])

  const onResetKeysChange = useCallback((prevResetKeys?: Array<string | number>) => {
    prevResetKeysRef.current = prevResetKeys
  }, [])

  useEffect(() => {
    if (prevResetKeysRef.current !== props.resetKeys)
      resetKeysRef.current = props.resetKeys
  }, [props.resetKeys])

  return (
    <ErrorBoundaryInner
      {...props}
      key={errorBoundaryKey}
      resetErrorBoundary={resetErrorBoundary}
      onResetKeysChange={onResetKeysChange}
    />
  )
}

// Hook for imperative error handling
export function useErrorHandler() {
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (error)
      throw error
  }, [error])

  return setError
}

// Hook for catching async errors
export function useAsyncError() {
  const [, setError] = useState()

  return useCallback(
    (error: Error) => {
      setError(() => {
        throw error
      })
    },
    [setError],
  )
}

// HOC for wrapping components with error boundary
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>,
): React.ComponentType<P> {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  )

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name || 'Component'})`

  return WrappedComponent
}

// Simple error fallback component
export const ErrorFallback: React.FC<{
  error: Error
  resetErrorBoundaryAction: () => void
}> = ({ error, resetErrorBoundaryAction }) => {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-8">
      <h2 className="mb-2 text-lg font-semibold text-red-800">Oops! Something went wrong</h2>
      <p className="mb-4 text-center text-red-600">{error.message}</p>
      <Button onClick={resetErrorBoundaryAction} size="small">
        Try again
      </Button>
    </div>
  )
}

export default ErrorBoundary
