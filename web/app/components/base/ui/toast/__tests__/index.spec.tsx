import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { toast, ToastHost } from '../index'

describe('base/ui/toast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    act(() => {
      toast.dismiss()
    })
  })

  afterEach(() => {
    act(() => {
      toast.dismiss()
      vi.runOnlyPendingTimers()
    })
    vi.useRealTimers()
  })

  // Core host and manager integration.
  it('should render a success toast when called through the typed shortcut', async () => {
    render(<ToastHost />)

    act(() => {
      toast.success('Saved', {
        description: 'Your changes are available now.',
      })
    })

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByText('Your changes are available now.')).toBeInTheDocument()
    const viewport = screen.getByRole('region', { name: 'Notifications' })
    expect(viewport).toHaveAttribute('aria-live', 'polite')
    expect(viewport).toHaveClass('z-1003')
    expect(viewport.firstElementChild).toHaveClass('top-4')
    expect(screen.getByRole('dialog')).not.toHaveClass('outline-hidden')
    expect(document.body.querySelector('[aria-hidden="true"].i-ri-checkbox-circle-fill')).toBeInTheDocument()
    expect(document.body.querySelector('button[aria-label="Close notification"][aria-hidden="true"]')).toBeInTheDocument()
  })

  // Collapsed stacks should keep multiple toast roots mounted for smooth stack animation.
  it('should keep multiple toast roots mounted in a collapsed stack', async () => {
    render(<ToastHost />)

    act(() => {
      toast('First toast')
    })

    expect(await screen.findByText('First toast')).toBeInTheDocument()

    act(() => {
      toast('Second toast')
      toast('Third toast')
    })

    expect(await screen.findByText('Third toast')).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(3)
    expect(document.body.querySelectorAll('button[aria-label="Close notification"][aria-hidden="true"]')).toHaveLength(3)

    fireEvent.mouseEnter(screen.getByRole('region', { name: 'Notifications' }))

    await waitFor(() => {
      expect(document.body.querySelector('button[aria-label="Close notification"][aria-hidden="true"]')).not.toBeInTheDocument()
    })
  })

  // Neutral calls should map directly to a toast with only a title.
  it('should render a neutral toast when called directly', async () => {
    render(<ToastHost />)

    act(() => {
      toast('Neutral toast')
    })

    expect(await screen.findByText('Neutral toast')).toBeInTheDocument()
    expect(document.body.querySelector('[aria-hidden="true"].i-ri-information-2-fill')).not.toBeInTheDocument()
  })

  // Base UI limit should cap the visible stack and mark overflow toasts as limited.
  it('should mark overflow toasts as limited when the stack exceeds the configured limit', async () => {
    render(<ToastHost limit={1} />)

    act(() => {
      toast('First toast')
      toast('Second toast')
    })

    expect(await screen.findByText('Second toast')).toBeInTheDocument()
    expect(document.body.querySelector('[data-limited]')).toBeInTheDocument()
  })

  // Closing should work through the public manager API.
  it('should dismiss a toast when dismiss(id) is called', async () => {
    render(<ToastHost />)

    let toastId = ''
    act(() => {
      toastId = toast('Closable', {
        description: 'This toast can be removed.',
      })
    })

    expect(await screen.findByText('Closable')).toBeInTheDocument()

    act(() => {
      toast.dismiss(toastId)
    })

    await waitFor(() => {
      expect(screen.queryByText('Closable')).not.toBeInTheDocument()
    })
  })

  // User dismissal needs to remain accessible.
  it('should close a toast when the dismiss button is clicked', async () => {
    const onClose = vi.fn()

    render(<ToastHost />)

    act(() => {
      toast('Dismiss me', {
        description: 'Manual dismissal path.',
        onClose,
      })
    })

    fireEvent.mouseEnter(screen.getByRole('region', { name: 'Notifications' }))

    const dismissButton = await screen.findByRole('button', { name: 'Close notification' })

    act(() => {
      dismissButton.click()
    })

    await waitFor(() => {
      expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // Base UI default timeout should apply when no timeout is provided.
  it('should auto dismiss toasts with the Base UI default timeout', async () => {
    render(<ToastHost />)

    act(() => {
      toast('Default timeout')
    })

    expect(await screen.findByText('Default timeout')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(4999)
    })

    expect(screen.getByText('Default timeout')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })

    await waitFor(() => {
      expect(screen.queryByText('Default timeout')).not.toBeInTheDocument()
    })
  })

  // Provider timeout should apply to all toasts when configured.
  it('should respect the host timeout configuration', async () => {
    render(<ToastHost timeout={3000} />)

    act(() => {
      toast('Configured timeout')
    })

    expect(await screen.findByText('Configured timeout')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2999)
    })

    expect(screen.getByText('Configured timeout')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })

    await waitFor(() => {
      expect(screen.queryByText('Configured timeout')).not.toBeInTheDocument()
    })
  })

  // Callers must be able to override or disable timeout per toast.
  it('should respect custom timeout values including zero', async () => {
    render(<ToastHost />)

    act(() => {
      toast('Custom timeout', {
        timeout: 1000,
      })
    })

    expect(await screen.findByText('Custom timeout')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    await waitFor(() => {
      expect(screen.queryByText('Custom timeout')).not.toBeInTheDocument()
    })

    act(() => {
      toast('Persistent', {
        timeout: 0,
      })
    })

    expect(await screen.findByText('Persistent')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(10000)
    })

    expect(screen.getByText('Persistent')).toBeInTheDocument()
  })

  // Updates should flow through the same manager state.
  it('should update an existing toast', async () => {
    render(<ToastHost />)

    let toastId = ''
    act(() => {
      toastId = toast.info('Loading', {
        description: 'Preparing your data…',
      })
    })

    expect(await screen.findByText('Loading')).toBeInTheDocument()

    act(() => {
      toast.update(toastId, {
        title: 'Done',
        description: 'Your data is ready.',
        type: 'success',
      })
    })

    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Your data is ready.')).toBeInTheDocument()
    expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  })

  // Re-adding the same toast id should upsert in place instead of stacking duplicates.
  it('should upsert an existing toast when add is called with the same id', async () => {
    render(<ToastHost />)

    act(() => {
      toast('Syncing', {
        id: 'sync-job',
        description: 'Uploading changes…',
      })
    })

    expect(await screen.findByText('Syncing')).toBeInTheDocument()

    act(() => {
      toast.success('Synced', {
        id: 'sync-job',
        description: 'All changes are uploaded.',
      })
    })

    expect(screen.queryByText('Syncing')).not.toBeInTheDocument()
    expect(screen.getByText('Synced')).toBeInTheDocument()
    expect(screen.getByText('All changes are uploaded.')).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  // Action props should pass through to the Base UI action button.
  it('should render and invoke toast action props', async () => {
    const onAction = vi.fn()

    render(<ToastHost />)

    act(() => {
      toast('Action toast', {
        actionProps: {
          children: 'Undo',
          onClick: onAction,
        },
      })
    })

    const actionButton = await screen.findByRole('button', { name: 'Undo' })

    act(() => {
      actionButton.click()
    })

    expect(onAction).toHaveBeenCalledTimes(1)
  })

  // Promise helpers are part of the public API and need a regression test.
  it('should transition a promise toast from loading to success', async () => {
    render(<ToastHost />)

    let resolvePromise: ((value: string) => void) | undefined
    const promise = new Promise<string>((resolve) => {
      resolvePromise = resolve
    })

    void act(() => toast.promise(promise, {
      loading: 'Saving…',
      success: result => ({
        title: 'Saved',
        description: result,
        type: 'success',
      }),
      error: 'Failed',
    }))

    expect(await screen.findByText('Saving…')).toBeInTheDocument()

    await act(async () => {
      resolvePromise?.('Your changes are available now.')
      await promise
    })

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByText('Your changes are available now.')).toBeInTheDocument()
  })
})
