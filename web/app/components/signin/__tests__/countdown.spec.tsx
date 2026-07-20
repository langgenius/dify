import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import Countdown from '../countdown'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '../storage'

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the stored remaining time', () => {
    localStorage.setItem(COUNT_DOWN_KEY, '30000')
    render(<Countdown />)
    expect(screen.getByText('30s')).toBeInTheDocument()
  })

  it('restores the stored time after hydrating server markup', async () => {
    vi.useRealTimers()
    localStorage.setItem(COUNT_DOWN_KEY, '30000')
    const container = document.createElement('div')
    container.innerHTML = renderToString(<Countdown />)
    const root = hydrateRoot(container, <Countdown />)

    await waitFor(() => expect(container).toHaveTextContent('30s'))
    act(() => root.unmount())
  })

  it('removes the stored time when the countdown ends', () => {
    localStorage.setItem(COUNT_DOWN_KEY, '1000')
    render(<Countdown />)
    act(() => vi.advanceTimersByTime(2000))
    expect(localStorage.removeItem).toHaveBeenCalledWith(COUNT_DOWN_KEY)
  })

  it('resets the countdown and invokes the callback when resent', () => {
    localStorage.setItem(COUNT_DOWN_KEY, '0')
    const onResend = vi.fn()
    render(<Countdown onResend={onResend} />)

    fireEvent.click(screen.getByRole('button', { name: 'login.checkCode.resend' }))

    expect(localStorage.setItem).toHaveBeenCalledWith(COUNT_DOWN_KEY, String(COUNT_DOWN_TIME_MS))
    expect(onResend).toHaveBeenCalledOnce()
  })
})
