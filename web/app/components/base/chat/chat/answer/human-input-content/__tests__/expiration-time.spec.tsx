import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import ExpirationTime from '../expiration-time'

const now = new Date('2026-01-15T12:00:00Z')

describe('ExpirationTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the remaining time until the deadline and changes to expired after it', () => {
    const deadline = now.getTime() + 2 * 60 * 60 * 1000
    const { rerender } = render(<ExpirationTime expirationTime={deadline} />)

    expect(
      screen.getByText('share.humanInput.expirationTimeNowOrFuture:{"relativeTime":"in 2 hours"}'),
    ).toBeInTheDocument()
    expect(screen.queryByText('share.humanInput.expiredTip')).not.toBeInTheDocument()

    vi.setSystemTime(deadline + 1)
    rerender(<ExpirationTime expirationTime={deadline} />)

    expect(screen.getByText('share.humanInput.expiredTip')).toBeInTheDocument()
    expect(screen.queryByText(/expirationTimeNowOrFuture/)).not.toBeInTheDocument()
  })

  it('treats the exact deadline as current rather than expired', () => {
    render(<ExpirationTime expirationTime={now.getTime()} />)

    expect(screen.getByText(/share.humanInput.expirationTimeNowOrFuture/)).toBeInTheDocument()
    expect(screen.queryByText('share.humanInput.expiredTip')).not.toBeInTheDocument()
  })
})
