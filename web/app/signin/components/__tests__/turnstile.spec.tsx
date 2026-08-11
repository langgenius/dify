import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  scriptProps: undefined as ScriptProps | undefined,
}))

let turnstileOptions: TurnstileOptions | undefined

vi.mock('@/next/script', () => ({
  default: (props: ScriptProps) => {
    mocks.scriptProps = props
    return null
  },
}))

describe('Turnstile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scriptProps = undefined
    turnstileOptions = undefined
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: undefined,
    })
  })

  it('shows a recoverable error when the script fails to load', async () => {
    const user = userEvent.setup()
    const onInvalidate = vi.fn()
    render(<Turnstile siteKey="site-key" onVerify={vi.fn()} onInvalidate={onInvalidate} />)
    const initialScriptSrc = mocks.scriptProps?.src

    act(() => {
      mocks.scriptProps?.onError?.()
    })

    expect(screen.getByRole('alert')).toHaveTextContent('login.turnstile.loadError')
    expect(onInvalidate).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onInvalidate).toHaveBeenCalledTimes(1)
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
    render(<Turnstile siteKey="site-key" onVerify={vi.fn()} onInvalidate={onInvalidate} />)

    act(() => {
      mocks.scriptProps?.onReady?.()
    })
    act(() => {
      turnstileOptions?.['expired-callback']()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    act(() => {
      turnstileOptions?.['error-callback']('network-error')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('login.turnstile.loadError')

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(mocks.remove).toHaveBeenCalledWith('widget-id')
    expect(mocks.render).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
