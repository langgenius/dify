import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createToast, createToastManager, toast, ToastHost } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

type BaseUIAnimationGlobal = typeof globalThis & {
  BASE_UI_ANIMATIONS_DISABLED: boolean
}

describe('@langgenius/dify-ui/toast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    toast.dismiss()
  })

  afterEach(() => {
    toast.dismiss()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('should render a success toast when called through the typed shortcut', async () => {
    const screen = await render(<ToastHost />)

    toast.success('Saved', {
      description: 'Your changes are available now.',
    })

    await expect.element(screen.getByText('Saved')).toBeInTheDocument()
    await expect.element(screen.getByText('Your changes are available now.')).toBeInTheDocument()
    const viewport = screen.getByRole('region', { name: 'Notifications' })
    await expect.element(viewport).toHaveAttribute('aria-live', 'polite')
  })

  it('should keep multiple toast roots mounted in a collapsed stack', async () => {
    const screen = await render(<ToastHost />)

    toast('First toast')
    await expect.element(screen.getByText('First toast')).toBeInTheDocument()

    toast('Second toast')
    toast('Third toast')

    await expect.element(screen.getByText('Third toast')).toBeInTheDocument()
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(3)
  })

  it('should not intercept pointer events below a collapsed top-anchored stack', async () => {
    const screen = await render(
      <>
        <style>{'[role="dialog"] { transition: none !important; }'}</style>
        <button
          type="button"
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: 400,
            height: 300,
          }}
        >
          Underlying action
        </button>
        <ToastHost timeout={0} />
      </>,
    )

    toast('Older notification')
    toast('Newest notification')

    const newestToast = screen.getByRole('dialog', { name: 'Newest notification' })
    await expect.element(newestToast).toBeInTheDocument()

    const toastDialogs = Array.from(document.body.querySelectorAll<HTMLElement>('[role="dialog"]'))
    const newestBounds = newestToast.element().getBoundingClientRect()
    const stackBottom = Math.max(
      ...toastDialogs.map((dialog) => dialog.getBoundingClientRect().bottom),
    )
    const elementBelowStack = document.elementFromPoint(
      newestBounds.left + newestBounds.width / 2,
      stackBottom + 4,
    )

    expect(elementBelowStack).toBe(
      screen.getByRole('button', { name: 'Underlying action' }).element(),
    )
  })

  it('should reject a downward swipe and dismiss upward from the top-right viewport', async () => {
    const baseUIAnimationGlobal = globalThis as BaseUIAnimationGlobal
    const animationState = baseUIAnimationGlobal.BASE_UI_ANIMATIONS_DISABLED
    baseUIAnimationGlobal.BASE_UI_ANIMATIONS_DISABLED = false

    try {
      const screen = await render(
        <>
          <style>
            {`
            [role="dialog"]:not([data-ending-style]) {
              transition: none !important;
            }
            [role="dialog"][data-ending-style] {
              transition: opacity 10000s !important;
            }
          `}
          </style>
          <button
            type="button"
            aria-label="Swipe up destination"
            style={{
              position: 'fixed',
              top: 0,
              right: 200,
              zIndex: 1000,
              width: 20,
              height: 20,
            }}
          />
          <button
            type="button"
            aria-label="Swipe down destination"
            style={{
              position: 'fixed',
              top: 360,
              right: 200,
              zIndex: 1000,
              width: 20,
              height: 20,
            }}
          />
          <ToastHost timeout={0} offset={{ top: 120 }} />
        </>,
      )

      toast('Directional notification')

      const toastDialog = screen.getByRole('dialog', { name: 'Directional notification' })
      await expect.element(toastDialog).toBeInTheDocument()
      const toastElement = toastDialog.element()
      const initialBounds = toastElement.getBoundingClientRect()

      await userEvent.dragAndDrop(toastElement, screen.getByLabelText('Swipe down destination'), {
        steps: 10,
      })

      await expect.element(toastDialog).toBeInTheDocument()
      expect(toastElement).not.toHaveAttribute('data-ending-style')
      expect(toastElement.getBoundingClientRect().top).toBeCloseTo(initialBounds.top, 0)

      await userEvent.dragAndDrop(toastElement, screen.getByLabelText('Swipe up destination'), {
        steps: 10,
      })

      await vi.waitFor(() => {
        expect(toastElement).toHaveAttribute('data-ending-style')
        expect(toastElement).toHaveAttribute('data-swipe-direction', 'up')
      })
      expect(toastElement.getBoundingClientRect().bottom).toBeLessThan(initialBounds.top)
    } finally {
      baseUIAnimationGlobal.BASE_UI_ANIMATIONS_DISABLED = animationState
    }
  })

  it('should dismiss an expanded background toast from its current row when swiped right', async () => {
    const baseUIAnimationGlobal = globalThis as BaseUIAnimationGlobal
    const animationState = baseUIAnimationGlobal.BASE_UI_ANIMATIONS_DISABLED
    baseUIAnimationGlobal.BASE_UI_ANIMATIONS_DISABLED = false

    try {
      const screen = await render(
        <>
          <style>
            {`
            [role="dialog"][data-ending-style] {
              transition: opacity 10000s !important;
            }
          `}
          </style>
          <button
            type="button"
            aria-label="Swipe destination"
            style={{
              position: 'fixed',
              top: 100,
              right: 0,
              zIndex: 1000,
              width: 20,
              height: 20,
            }}
          />
          <ToastHost timeout={0} />
        </>,
      )

      toast('Background notification')
      toast('Front notification')

      const backgroundToast = screen.getByRole('dialog', { name: 'Background notification' })
      await expect.element(backgroundToast).toBeInTheDocument()
      await backgroundToast.hover()
      await expect.element(backgroundToast).toHaveAttribute('data-expanded')

      const toastElement = backgroundToast.element()
      const bounds = toastElement.getBoundingClientRect()

      await userEvent.dragAndDrop(toastElement, screen.getByLabelText('Swipe destination'), {
        steps: 10,
      })

      await vi.waitFor(() => {
        expect(toastElement).toHaveAttribute('data-ending-style')
      })
      expect(toastElement.getBoundingClientRect().top).toBeCloseTo(bounds.top, 0)
    } finally {
      await userEvent.unhover(document.body)
      baseUIAnimationGlobal.BASE_UI_ANIMATIONS_DISABLED = animationState
    }
  })

  it('should render a neutral toast when called directly', async () => {
    const screen = await render(<ToastHost />)

    toast('Neutral toast')

    await expect.element(screen.getByText('Neutral toast')).toBeInTheDocument()
  })

  it('should isolate toasts between managers', async () => {
    const localManager = createToastManager()
    const localToast = createToast(localManager)
    const screen = await render(
      <>
        <ToastHost />
        <ToastHost manager={localManager} />
      </>,
    )

    localToast.error('Local error')
    toast.success('Global success')

    await expect.element(screen.getByText('Local error')).toBeInTheDocument()
    await expect.element(screen.getByText('Global success')).toBeInTheDocument()
    const globalViewport = screen.getByText('Global success').element().closest('[role="region"]')
    const localViewport = screen.getByText('Local error').element().closest('[role="region"]')
    expect(globalViewport).not.toBe(localViewport)
    expect(globalViewport).not.toHaveTextContent('Local error')
    expect(localViewport).not.toHaveTextContent('Global success')

    localToast.dismiss()
  })

  it('should apply custom positioning to the viewport', async () => {
    const localManager = createToastManager()
    const localToast = createToast(localManager)
    const screen = await render(<ToastHost manager={localManager} offset={{ top: 80 }} />)

    localToast('Positioned viewport')

    const viewport = screen.getByRole('region', { name: 'Notifications' })
    await expect.element(screen.getByText('Positioned viewport')).toBeInTheDocument()
    await vi.waitFor(() => {
      expect(viewport.element().getBoundingClientRect().top).toBeCloseTo(80, 0)
    })

    localToast.dismiss()
  })

  it('should mark overflow toasts as limited when the stack exceeds the configured limit', async () => {
    const screen = await render(<ToastHost limit={1} />)

    toast('First toast')
    toast('Second toast')

    await expect.element(screen.getByText('Second toast')).toBeInTheDocument()
    expect(document.body.querySelector('[data-limited]')).toBeInTheDocument()
  })

  it('should dismiss a toast when dismiss(id) is called', async () => {
    const screen = await render(<ToastHost />)

    const toastId = toast('Closable', {
      description: 'This toast can be removed.',
    })

    await expect.element(screen.getByText('Closable')).toBeInTheDocument()

    toast.dismiss(toastId)

    await vi.waitFor(() => {
      expect(document.body).not.toHaveTextContent('Closable')
    })
  })

  it('should close a toast when the dismiss button is clicked', async () => {
    const onClose = vi.fn()
    const screen = await render(<ToastHost />)

    toast('Dismiss me', {
      description: 'Manual dismissal path.',
      onClose,
    })

    await screen.getByRole('dialog', { name: 'Dismiss me' }).hover()

    await expect
      .element(screen.getByRole('button', { name: 'Close notification' }))
      .toBeInTheDocument()
    await screen.getByRole('button', { name: 'Close notification' }).click()

    await vi.waitFor(() => {
      expect(document.body).not.toHaveTextContent('Dismiss me')
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should let pointer events pass through a toast while it is exiting', async () => {
    const onClick = vi.fn()
    const baseUIAnimationGlobal = globalThis as BaseUIAnimationGlobal
    const animationState = baseUIAnimationGlobal.BASE_UI_ANIMATIONS_DISABLED
    baseUIAnimationGlobal.BASE_UI_ANIMATIONS_DISABLED = false

    try {
      const screen = await render(
        <>
          <style>
            {`
            [role="dialog"][data-ending-style] {
              transition: opacity 10000s, transform 10000s !important;
              opacity: 0 !important;
              transform: translateY(-150%) !important;
            }
            .data-ending-style\\:pointer-events-none[data-ending-style] {
              pointer-events: none;
            }
            .data-ending-style\\:after\\:pointer-events-none[data-ending-style]::after {
              pointer-events: none;
            }
          `}
          </style>
          <button
            type="button"
            onClick={onClick}
            style={{
              position: 'fixed',
              top: '16px',
              right: '32px',
              width: '360px',
              height: '96px',
            }}
          >
            Underlying action
          </button>
          <ToastHost />
        </>,
      )

      toast('Dismiss me', {
        timeout: 0,
      })

      const toastDialog = screen.getByRole('dialog', { name: 'Dismiss me' })
      await expect.element(toastDialog).toBeInTheDocument()
      await toastDialog.hover()

      await expect
        .element(screen.getByRole('button', { name: 'Close notification' }))
        .toBeInTheDocument()
      await screen.getByRole('button', { name: 'Close notification' }).click()

      await vi.waitFor(() => {
        expect(toastDialog.element()).toHaveAttribute('data-ending-style')
      })
      expect(getComputedStyle(toastDialog.element()).pointerEvents).toBe('none')

      const underlyingAction = asHTMLElement(
        screen.getByRole('button', { name: 'Underlying action' }).element(),
      )
      const rect = underlyingAction.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2

      document.elementFromPoint(x, y)?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }),
      )

      expect(onClick).toHaveBeenCalledTimes(1)
    } finally {
      baseUIAnimationGlobal.BASE_UI_ANIMATIONS_DISABLED = animationState
    }
  })

  it('should pass the host timeout to added toasts', async () => {
    const screen = await render(<ToastHost timeout={1000} />)

    toast('Auto dismiss')
    await expect.element(screen.getByText('Auto dismiss')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(999)
    expect(document.body).toHaveTextContent('Auto dismiss')

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => {
      const toastDialog = document.body.querySelector('[role="dialog"]')
      expect(toastDialog === null || toastDialog.hasAttribute('data-ending-style')).toBe(true)
    })
  })

  it('should keep a toast persistent when its timeout is zero', async () => {
    const screen = await render(<ToastHost timeout={1000} />)

    toast('Persistent', {
      timeout: 0,
    })

    await expect.element(screen.getByText('Persistent')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(5000)
    expect(document.body).toHaveTextContent('Persistent')
  })

  it('should update an existing toast', async () => {
    const screen = await render(<ToastHost />)

    const toastId = toast.info('Loading', {
      description: 'Preparing your data…',
    })
    await expect.element(screen.getByText('Loading')).toBeInTheDocument()

    toast.update(toastId, {
      title: 'Done',
      description: 'Your data is ready.',
      type: 'success',
    })

    await expect.element(screen.getByText('Done')).toBeInTheDocument()
    await expect.element(screen.getByText('Your data is ready.')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Loading')
  })

  it('should upsert an existing toast when add is called with the same id', async () => {
    const screen = await render(<ToastHost />)

    toast('Draft saving', {
      id: 'draft-save-status',
      description: 'Saving changes…',
    })
    await expect.element(screen.getByText('Draft saving')).toBeInTheDocument()

    toast.success('Draft saved', {
      id: 'draft-save-status',
      description: 'All changes are saved.',
    })

    await vi.waitFor(() => {
      expect(document.body).not.toHaveTextContent('Draft saving')
    })
    await expect.element(screen.getByText('Draft saved')).toBeInTheDocument()
    await expect.element(screen.getByText('All changes are saved.')).toBeInTheDocument()
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  })

  it('should render and invoke toast action props', async () => {
    const onAction = vi.fn()
    const screen = await render(<ToastHost />)

    toast('Action toast', {
      actionProps: {
        children: 'Undo',
        onClick: onAction,
      },
    })

    await expect.element(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    await screen.getByRole('button', { name: 'Undo' }).click()

    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('should transition a promise toast from loading to success', async () => {
    const screen = await render(<ToastHost />)

    let resolvePromise: ((value: string) => void) | undefined
    const promise = new Promise<string>((resolve) => {
      resolvePromise = resolve
    })

    void toast.promise(promise, {
      loading: 'Saving…',
      success: (result) => ({
        title: 'Saved',
        description: result,
        type: 'success',
      }),
      error: 'Failed',
    })

    await expect.element(screen.getByText('Saving…')).toBeInTheDocument()

    resolvePromise?.('Your changes are available now.')
    await promise

    await expect.element(screen.getByText('Saved')).toBeInTheDocument()
    await expect.element(screen.getByText('Your changes are available now.')).toBeInTheDocument()
  })
})
