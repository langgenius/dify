import type { ReactNode } from 'react'
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import Toast, { ToastProvider, useToastContext } from '.'
import '@testing-library/jest-dom'
import { noop } from 'lodash-es'

// Mock timers for testing timeouts
jest.useFakeTimers()

const TestComponent = () => {
  const { notify, close } = useToastContext()

  return (
    <div>
      <button type="button" onClick={() => notify({ message: 'Notification message', type: 'info' })}>
        Show Toast
      </button>
      <button type="button" onClick={close}>Close Toast</button>
    </div>
  )
}

describe('Toast', () => {
  describe('Toast Component', () => {
    test('renders toast with correct type and message', () => {
      render(
        <ToastProvider>
          <Toast type="success" message="Success message" />
        </ToastProvider>,
      )

      expect(screen.getByText('Success message')).toBeInTheDocument()
    })

    test('renders with different types', () => {
      const { rerender } = render(
        <ToastProvider>
          <Toast type="success" message="Success message" />
        </ToastProvider>,
      )

      expect(document.querySelector('.text-text-success')).toBeInTheDocument()

      rerender(
        <ToastProvider>
          <Toast type="error" message="Error message" />
        </ToastProvider>,
      )

      expect(document.querySelector('.text-text-destructive')).toBeInTheDocument()
    })

    test('renders with custom component', () => {
      render(
        <ToastProvider>
          <Toast
            message="Message with custom component"
            customComponent={<span data-testid="custom-component">Custom</span>}
          />
        </ToastProvider>,
      )

      expect(screen.getByTestId('custom-component')).toBeInTheDocument()
    })

    test('renders children content', () => {
      render(
        <ToastProvider>
          <Toast message="Message with children">
            <span>Additional information</span>
          </Toast>
        </ToastProvider>,
      )

      expect(screen.getByText('Additional information')).toBeInTheDocument()
    })

    test('does not render close button when close is undefined', () => {
      // Create a modified context where close is undefined
      const CustomToastContext = React.createContext({ notify: noop, close: undefined })

      // Create a wrapper component using the custom context
      const Wrapper = ({ children }: { children: ReactNode }) => (
        <CustomToastContext.Provider value={{ notify: noop, close: undefined }}>
          {children}
        </CustomToastContext.Provider>
      )

      render(
        <Wrapper>
          <Toast message="No close button" type="info" />
        </Wrapper>,
      )

      expect(screen.getByText('No close button')).toBeInTheDocument()
      // Ensure the close button is not rendered
      expect(document.querySelector('.h-4.w-4.shrink-0.text-text-tertiary')).not.toBeInTheDocument()
    })
  })

  describe('ToastProvider and Context', () => {
    test('shows and hides toast using context', async () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>,
      )

      // No toast initially
      expect(screen.queryByText('Notification message')).not.toBeInTheDocument()

      // Show toast
      act(() => {
        screen.getByText('Show Toast').click()
      })
      expect(screen.getByText('Notification message')).toBeInTheDocument()

      // Close toast
      act(() => {
        screen.getByText('Close Toast').click()
      })
      expect(screen.queryByText('Notification message')).not.toBeInTheDocument()
    })

    test('automatically hides toast after duration', async () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>,
      )

      // Show toast
      act(() => {
        screen.getByText('Show Toast').click()
      })
      expect(screen.getByText('Notification message')).toBeInTheDocument()

      // Fast-forward timer
      act(() => {
        jest.advanceTimersByTime(3000) // Default for info type is 3000ms
      })

      // Toast should be gone
      await waitFor(() => {
        expect(screen.queryByText('Notification message')).not.toBeInTheDocument()
      })
    })
  })

  describe('Toast.notify static method', () => {
    test('creates and removes toast from DOM', async () => {
      act(() => {
        // Call the static method
        Toast.notify({ message: 'Static notification', type: 'warning' })
      })

      // Toast should be in document
      expect(screen.getByText('Static notification')).toBeInTheDocument()

      // Fast-forward timer
      act(() => {
        jest.advanceTimersByTime(6000) // Default for warning type is 6000ms
      })

      // Toast should be removed
      await waitFor(() => {
        expect(screen.queryByText('Static notification')).not.toBeInTheDocument()
      })
    })

    test('calls onClose callback after duration', async () => {
      const onCloseMock = jest.fn()
      act(() => {
        Toast.notify({
          message: 'Closing notification',
          type: 'success',
          onClose: onCloseMock,
        })
      })

      // Fast-forward timer
      act(() => {
        jest.advanceTimersByTime(3000) // Default for success type is 3000ms
      })

      // onClose should be called
      await waitFor(() => {
        expect(onCloseMock).toHaveBeenCalled()
      })
    })
  })
})
