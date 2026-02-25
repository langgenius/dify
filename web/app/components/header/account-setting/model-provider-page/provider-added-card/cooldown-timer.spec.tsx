import { render } from '@testing-library/react'
import CooldownTimer from './cooldown-timer'

describe('CooldownTimer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render timer when secondsRemaining is positive', () => {
    const { container } = render(<CooldownTimer secondsRemaining={10} />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should not render when secondsRemaining is zero', () => {
    const { container } = render(<CooldownTimer secondsRemaining={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('should not render when secondsRemaining is undefined', () => {
    const { container } = render(<CooldownTimer />)
    expect(container.firstChild).toBeNull()
  })

  it('should call onFinish after countdown completes', () => {
    vi.useFakeTimers()
    const onFinish = vi.fn()
    render(<CooldownTimer secondsRemaining={1} onFinish={onFinish} />)

    vi.advanceTimersByTime(2000)
    expect(onFinish).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
