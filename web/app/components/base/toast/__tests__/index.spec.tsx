import type { ReactNode } from 'react'
import type { ToastHandle } from '../index'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import Toast, { ToastProvider } from '..'
import { useToastContext } from '../context'

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
  const getToastElementByMessage = (message: string): HTMLElement => {
    const messageElement = screen.getByText(message)
    const toastElement = messageElement.closest('.fixed')
    expect(toastElement).toBeInTheDocument()
    return toastElement as HTMLElement
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('Toast Component', () => {
    it('renders toast with correct type and message', () => {
      render(
        <ToastProvider>
          <Toast type="success" message="Success message" />
        </ToastProvider>,
      )

      expect(screen.getByText('Success message')).toBeInTheDocument()
    })

    it('renders with different types', () => {
      const { rerender } = render(
        <ToastProvider>
          <Toast type="success" message="Success message" />
        </ToastProvider>,
      )

      const successToast = getToastElementByMessage('Success message')
      expect(successToast).toHaveClass('z-[1101]')
      const successIcon = within(successToast).getByTestId('toast-icon-success')
      expect(successIcon).toHaveClass('text-text-success')

      rerender(
        <ToastProvider>
          <Toast type="error" message="Error message" />
        </ToastProvider>,
      )

      const errorToast = getToastElementByMessage('Error message')
      const errorIcon = within(errorToast).getByTestId('toast-icon-error')
      expect(errorIcon).toHaveClass('text-text-destructive')
    })

    it('renders with custom component', () => {
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

    it('renders children content', () => {
      render(
        <ToastProvider>
          <Toast message="Message with children">
            <span>Additional information</span>
          </Toast>
        </ToastProvider>,
      )

      expect(screen.getByText('Additional information')).toBeInTheDocument()
    })

    it('does not render close button when close is undefined', () => {
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
      const toastElement = getToastElementByMessage('No close button')
      expect(within(toastElement).queryByRole('button')).not.toBeInTheDocument()
    })

    it('returns null when message is not a string', () => {
      const { container } = render(
        <ToastProvider>
          {/* @ts-expect-error - testing invalid input */}
          <Toast message={<div>Invalid</div>} />
        </ToastProvider>,
      )
      // Toast returns null, and provider adds no DOM elements
      expect(container.firstChild).toBeNull()
    })

    it('renders with size sm', () => {
      const { rerender } = render(
        <ToastProvider>
          <Toast type="info" message="Small size" size="sm" />
        </ToastProvider>,
      )
      const infoToast = getToastElementByMessage('Small size')
      const infoIcon = within(infoToast).getByTestId('toast-icon-info')
      expect(infoIcon).toHaveClass('text-text-accent', 'h-4', 'w-4')
      expect(infoIcon.parentElement).toHaveClass('p-1')

      rerender(
        <ToastProvider>
          <Toast type="success" message="Small size" size="sm" />
        </ToastProvider>,
      )
      const successToast = getToastElementByMessage('Small size')
      const successIcon = within(successToast).getByTestId('toast-icon-success')
      expect(successIcon).toHaveClass('text-text-success', 'h-4', 'w-4')

      rerender(
        <ToastProvider>
          <Toast type="warning" message="Small size" size="sm" />
        </ToastProvider>,
      )
      const warningToast = getToastElementByMessage('Small size')
      const warningIcon = within(warningToast).getByTestId('toast-icon-warning')
      expect(warningIcon).toHaveClass('text-text-warning-secondary', 'h-4', 'w-4')

      rerender(
        <ToastProvider>
          <Toast type="error" message="Small size" size="sm" />
        </ToastProvider>,
      )
      const errorToast = getToastElementByMessage('Small size')
      const errorIcon = within(errorToast).getByTestId('toast-icon-error')
      expect(errorIcon).toHaveClass('text-text-destructive', 'h-4', 'w-4')
    })
  })

  describe('ToastProvider and Context', () => {
    it('shows and hides toast using context', async () => {
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

    it('automatically hides toast after duration', async () => {
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
        vi.advanceTimersByTime(3000) // Default for info type is 3000ms
      })

      // Toast should be gone
      await waitFor(() => {
        expect(screen.queryByText('Notification message')).not.toBeInTheDocument()
      })
    })

    it('automatically hides toast after duration for error type in provider', async () => {
      const TestComponentError = () => {
        const { notify } = useToastContext()
        return (
          <button type="button" onClick={() => notify({ message: 'Error notify', type: 'error' })}>
            Show Error
          </button>
        )
      }

      render(
        <ToastProvider>
          <TestComponentError />
        </ToastProvider>,
      )

      act(() => {
        screen.getByText('Show Error').click()
      })
      expect(screen.getByText('Error notify')).toBeInTheDocument()

      // Error type uses 6000ms default
      act(() => {
        vi.advanceTimersByTime(6000)
      })

      await waitFor(() => {
        expect(screen.queryByText('Error notify')).not.toBeInTheDocument()
      })
    })
  })

  describe('Toast.notify static method', () => {
    it('creates and removes toast from DOM', async () => {
      act(() => {
        // Call the static method
        Toast.notify({ message: 'Static notification', type: 'warning' })
      })

      // Toast should be in document
      expect(screen.getByText('Static notification')).toBeInTheDocument()

      // Fast-forward timer
      act(() => {
        vi.advanceTimersByTime(6000) // Default for warning type is 6000ms
      })

      // Toast should be removed
      await waitFor(() => {
        expect(screen.queryByText('Static notification')).not.toBeInTheDocument()
      })
    })

    it('calls onClose callback after duration', async () => {
      const onCloseMock = vi.fn()
      act(() => {
        Toast.notify({
          message: 'Closing notification',
          type: 'success',
          onClose: onCloseMock,
        })
      })

      // Fast-forward timer
      act(() => {
        vi.advanceTimersByTime(3000) // Default for success type is 3000ms
      })

      // onClose should be called
      await waitFor(() => {
        expect(onCloseMock).toHaveBeenCalled()
      })
    })

    it('closes when close button is clicked in static toast', async () => {
      const onCloseMock = vi.fn()
      act(() => {
        Toast.notify({ message: 'Static close test', type: 'info', onClose: onCloseMock })
      })

      expect(screen.getByText('Static close test')).toBeInTheDocument()

      const toastElement = getToastElementByMessage('Static close test')
      const closeButton = within(toastElement).getByRole('button')

      act(() => {
        closeButton.click()
      })

      expect(screen.queryByText('Static close test')).not.toBeInTheDocument()
      expect(onCloseMock).toHaveBeenCalled()
    })

    it('does not auto close when duration is 0', async () => {
      act(() => {
        Toast.notify({ message: 'No auto close', type: 'info', duration: 0 })
      })

      expect(screen.getByText('No auto close')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(10000)
      })

      expect(screen.getByText('No auto close')).toBeInTheDocument()

      // manual clear to clean up
      act(() => {
        const toastElement = getToastElementByMessage('No auto close')
        within(toastElement).getByRole('button').click()
      })
    })

    it('returns a toast handler that can clear the toast', async () => {
      let handler: ToastHandle = {}
      const onCloseMock = vi.fn()
      act(() => {
        handler = Toast.notify({ message: 'Clearable toast', type: 'warning', onClose: onCloseMock })
      })

      expect(screen.getByText('Clearable toast')).toBeInTheDocument()

      act(() => {
        handler.clear?.()
      })

      expect(screen.queryByText('Clearable toast')).not.toBeInTheDocument()
      expect(onCloseMock).toHaveBeenCalled()
    })
  })
})
