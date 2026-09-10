import { act, render } from '@testing-library/react'
import { StrictMode } from 'react'
import CooldownTimer from '../cooldown-timer'

describe('CooldownTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([0, undefined])('does not show an inactive cooldown (%s)', (secondsRemaining) => {
    const { container } = render(<CooldownTimer secondsRemaining={secondsRemaining} />)
    expect(container.firstChild).toBeNull()
  })

  it('clears the cooldown indicator and finishes once when the deadline is reached', () => {
    const onFinish = vi.fn()
    const { container } = render(
      <StrictMode>
        <CooldownTimer secondsRemaining={2} onFinish={onFinish} />
      </StrictMode>,
    )

    expect(container.firstChild).not.toBeNull()
    act(() => vi.advanceTimersByTime(1000))
    expect(onFinish).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1000))
    expect(container.firstChild).toBeNull()
    expect(onFinish).toHaveBeenCalledTimes(1)

    act(() => vi.advanceTimersByTime(5000))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('uses the latest completion callback without restarting the cooldown', () => {
    const onFinish = vi.fn()
    const onUpdatedFinish = vi.fn()
    const { rerender } = render(<CooldownTimer secondsRemaining={3} onFinish={onFinish} />)

    act(() => vi.advanceTimersByTime(1000))
    rerender(<CooldownTimer secondsRemaining={3} onFinish={onUpdatedFinish} />)
    act(() => vi.advanceTimersByTime(2000))

    expect(onFinish).not.toHaveBeenCalled()
    expect(onUpdatedFinish).toHaveBeenCalledTimes(1)
  })

  it('restarts from an updated cooldown duration', () => {
    const onFinish = vi.fn()
    const { rerender } = render(<CooldownTimer secondsRemaining={2} onFinish={onFinish} />)

    act(() => vi.advanceTimersByTime(1000))
    rerender(<CooldownTimer secondsRemaining={4} onFinish={onFinish} />)
    act(() => vi.advanceTimersByTime(3000))
    expect(onFinish).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1000))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('does not finish a cooldown after its row is removed', () => {
    const onFinish = vi.fn()
    const { unmount } = render(<CooldownTimer secondsRemaining={2} onFinish={onFinish} />)

    act(() => vi.advanceTimersByTime(1000))
    unmount()
    act(() => vi.advanceTimersByTime(5000))

    expect(onFinish).not.toHaveBeenCalled()
  })
})
