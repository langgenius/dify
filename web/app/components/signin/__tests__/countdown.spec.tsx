import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import Countdown from '../countdown'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '../storage'

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.removeItem(COUNT_DOWN_KEY)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('restores the stored time after hydrating server markup', async () => {
    vi.useRealTimers()
    localStorage.setItem(COUNT_DOWN_KEY, '30000')
    const container = document.createElement('div')
    container.innerHTML = renderToString(<Countdown />)
    expect(container).toHaveTextContent('login.checkCode.didNotReceiveCode')
    expect(container).not.toHaveTextContent('30s')
    expect(container.querySelector('button')).toBeNull()

    const onRecoverableError = vi.fn()
    const root = hydrateRoot(container, <Countdown />, { onRecoverableError })

    try {
      await waitFor(() => expect(container).toHaveTextContent('30s'))
      expect(onRecoverableError).not.toHaveBeenCalled()
    } finally {
      act(() => root.unmount())
    }
  })

  it('enables resending when the stored countdown expires', () => {
    localStorage.setItem(COUNT_DOWN_KEY, '1000')
    render(<Countdown />)
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('button', { name: 'login.checkCode.resend' })).toBeEnabled()
    expect(Number(localStorage.getItem(COUNT_DOWN_KEY))).toBe(0)
  })

  it('resets the countdown and invokes the callback when resent', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    localStorage.setItem(COUNT_DOWN_KEY, '0')
    const onResend = vi.fn()
    render(<Countdown onResend={onResend} />)

    await user.click(screen.getByRole('button', { name: 'login.checkCode.resend' }))

    expect(localStorage.getItem(COUNT_DOWN_KEY)).toBe(String(COUNT_DOWN_TIME_MS))
    expect(onResend).toHaveBeenCalledOnce()
  })

  it('does not restart the countdown while resend is disabled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    localStorage.setItem(COUNT_DOWN_KEY, '0')
    const onResend = vi.fn()
    render(<Countdown onResend={onResend} resendDisabled />)

    await user.click(screen.getByRole('button', { name: 'login.checkCode.resend' }))

    expect(localStorage.getItem(COUNT_DOWN_KEY)).toBe('0')
    expect(onResend).not.toHaveBeenCalled()
  })

  it('lets the caller defer restarting the countdown until resend succeeds', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    localStorage.setItem(COUNT_DOWN_KEY, '0')
    const onResend = vi.fn()
    render(<Countdown onResend={onResend} restartOnResend={false} />)

    await user.click(screen.getByRole('button', { name: 'login.checkCode.resend' }))

    expect(localStorage.getItem(COUNT_DOWN_KEY)).toBe('0')
    expect(onResend).toHaveBeenCalledOnce()
  })
})
