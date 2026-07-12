import { render } from 'vitest-browser-react'
import { toast, ToastHost } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

type BaseUIAnimationGlobal = typeof globalThis & {
  BASE_UI_ANIMATIONS_DISABLED: boolean
}

const dispatchToastMouseOver = (element: HTMLElement | SVGElement) => {
  element.dispatchEvent(
    new MouseEvent('mouseover', {
      bubbles: true,
    }),
  )
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

  it('should render a neutral toast when called directly', async () => {
    const screen = await render(<ToastHost />)

    toast('Neutral toast')

    await expect.element(screen.getByText('Neutral toast')).toBeInTheDocument()
  })

  it('should wrap long unbroken toast content within the card width', async () => {
    const screen = await render(<ToastHost />)
    const longTitle =
      'operation error S3: PutObject, exceeded maximum number of attempts, 3, StatusCode: 0, RequestID: , HostID: , request send failed'
    const longDescription =
      'Put "https://plugin/assets/1bd032bb73218a5d141b80cab7111?x-id=PutObject": dial tcp 192.168.0.200:19000: connect: connection refused, icon small en_US failed to remap assets failed to store plugin asset'

    toast.error(longTitle, {
      description: longDescription,
    })

    await expect.element(screen.getByText(longTitle)).toBeInTheDocument()
    await expect.element(screen.getByText(longDescription)).toBeInTheDocument()

    const title = asHTMLElement(screen.getByText(longTitle).element())
    const description = asHTMLElement(screen.getByText(longDescription).element())
    expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth)
    expect(description.scrollWidth).toBeLessThanOrEqual(description.clientWidth)
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

    const viewport = screen.getByRole('region', { name: 'Notifications' }).element()
    dispatchToastMouseOver(viewport)

    await expect
      .element(screen.getByRole('button', { name: 'Close notification' }))
      .toBeInTheDocument()
    asHTMLElement(screen.getByRole('button', { name: 'Close notification' }).element()).click()

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
            [role="dialog"] {
              transition: opacity 10000s, transform 10000s !important;
            }
            [role="dialog"][data-ending-style] {
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

      await expect.element(screen.getByRole('dialog', { name: 'Dismiss me' })).toBeInTheDocument()
      asHTMLElement(screen.getByRole('dialog', { name: 'Dismiss me' }).element()).click()

      const viewport = screen.getByRole('region', { name: 'Notifications' }).element()
      dispatchToastMouseOver(viewport)

      await expect
        .element(screen.getByRole('button', { name: 'Close notification' }))
        .toBeInTheDocument()
      asHTMLElement(screen.getByRole('button', { name: 'Close notification' }).element()).click()

      await vi.waitFor(() => {
        expect(screen.getByRole('dialog', { name: 'Dismiss me' }).element()).toHaveAttribute(
          'data-ending-style',
        )
      })

      asHTMLElement(screen.getByRole('dialog', { name: 'Dismiss me' }).element()).click()

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
    asHTMLElement(screen.getByRole('button', { name: 'Undo' }).element()).click()

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
