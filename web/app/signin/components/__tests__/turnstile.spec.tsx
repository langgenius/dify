import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import Turnstile from '../turnstile'

type ScriptProps = {
  id: string
  src: string
  onReady?: () => void
  onError?: () => void
}

type TurnstileOptions = {
  callback: (token: string) => void
  'error-callback': (errorCode: string) => boolean
  'expired-callback': () => void
  'timeout-callback': () => void
  'unsupported-callback': () => void
}

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  render: vi.fn(),
  scriptIsCached: false,
  scriptProps: undefined as ScriptProps | undefined,
}))

let turnstileOptions: TurnstileOptions | undefined

vi.mock('@/next/script', async () => {
  const { useEffect, useRef } = await vi.importActual<typeof import('react')>('react')

  function ScriptMock(props: ScriptProps) {
    const { onReady } = props
    const hasCalledOnReadyRef = useRef(false)
    mocks.scriptProps = props

    useEffect(() => {
      if (!mocks.scriptIsCached || hasCalledOnReadyRef.current) return
      hasCalledOnReadyRef.current = true
      onReady?.()
    }, [onReady])

    return null
  }

  return {
    default: ScriptMock,
  }
})

describe('Turnstile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scriptIsCached = false
    mocks.scriptProps = undefined
    turnstileOptions = undefined
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: undefined,
    })
  })

  it('keeps a cached-script widget mounted after Strict Mode replays effects', async () => {
    const mountedWidgets = new Map<string, HTMLElement>()
    mocks.scriptIsCached = true
    mocks.render.mockImplementation((container: HTMLElement) => {
      const widgetId = `widget-${mocks.render.mock.calls.length}`
      const widget = document.createElement('div')
      widget.setAttribute('role', 'region')
      widget.setAttribute('aria-label', 'Turnstile challenge')
      container.appendChild(widget)
      mountedWidgets.set(widgetId, widget)
      return widgetId
    })
    mocks.remove.mockImplementation((widgetId: string) => {
      mountedWidgets.get(widgetId)?.remove()
      mountedWidgets.delete(widgetId)
    })
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: {
        remove: mocks.remove,
        render: mocks.render,
      },
    })

    render(
      <StrictMode>
        <Turnstile
          action="signin_code"
          siteKey="site-key"
          onVerify={vi.fn()}
          onInvalidate={vi.fn()}
        />
      </StrictMode>,
    )

    expect(await screen.findByRole('region', { name: 'Turnstile challenge' })).toBeInTheDocument()
  })

  it('shows a recoverable error when the script fails to load', async () => {
    const user = userEvent.setup()
    const onInvalidate = vi.fn()
    const onError = vi.fn()
    render(
      <Turnstile
        action="signin_code"
        siteKey="site-key"
        onVerify={vi.fn()}
        onInvalidate={onInvalidate}
        onError={onError}
      />,
    )
    const initialScriptSrc = mocks.scriptProps?.src

    act(() => {
      mocks.scriptProps?.onError?.()
    })

    expect(screen.getByRole('alert')).toHaveTextContent('login.turnstile.loadError')
    expect(onInvalidate).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(mocks.scriptProps?.src).not.toBe(initialScriptSrc)

    mocks.render.mockReturnValue('widget-id')
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: {
        remove: mocks.remove,
        render: mocks.render,
      },
    })
    act(() => {
      mocks.scriptProps?.onReady?.()
    })

    await waitFor(() => {
      expect(mocks.render).toHaveBeenCalledTimes(1)
    })
  })

  it('recreates the widget after a challenge error without treating token expiry as a load failure', async () => {
    const user = userEvent.setup()
    const onInvalidate = vi.fn()
    const onError = vi.fn()
    mocks.render.mockImplementation((_container: HTMLElement, options: TurnstileOptions) => {
      turnstileOptions = options
      return 'widget-id'
    })
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: {
        remove: mocks.remove,
        render: mocks.render,
      },
    })
    render(
      <Turnstile
        action="signin_code"
        siteKey="site-key"
        onVerify={vi.fn()}
        onInvalidate={onInvalidate}
        onError={onError}
      />,
    )

    act(() => {
      mocks.scriptProps?.onReady?.()
    })
    act(() => {
      turnstileOptions?.['expired-callback']()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onInvalidate).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()

    act(() => {
      turnstileOptions?.['error-callback']('network-error')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('login.turnstile.loadError')
    expect(onInvalidate).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(mocks.remove).toHaveBeenCalledWith('widget-id')
    expect(mocks.render).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
