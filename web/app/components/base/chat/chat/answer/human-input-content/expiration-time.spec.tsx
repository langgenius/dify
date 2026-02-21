import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ExpirationTime from './expiration-time'
import * as utils from './utils'

// Mock utils to control time-based logic
vi.mock('./utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils')>()
  return {
    ...actual,
    getRelativeTime: vi.fn(),
    isRelativeTimeSameOrAfter: vi.fn(),
  }
})

describe('ExpirationTime', () => {
  it('should render "Future" state with relative time', () => {
    vi.mocked(utils.getRelativeTime).mockReturnValue('in 2 hours')
    vi.mocked(utils.isRelativeTimeSameOrAfter).mockReturnValue(true)

    const { container } = render(<ExpirationTime expirationTime={1234567890} />)

    expect(screen.getByTestId('expiration-time')).toHaveClass('text-text-tertiary')
    expect(screen.getByText('share.humanInput.expirationTimeNowOrFuture:{"relativeTime":"in 2 hours"}')).toBeInTheDocument()
    expect(container.querySelector('.i-ri-time-line')).toBeInTheDocument()
  })

  it('should render "Expired" state when time is in the past', () => {
    vi.mocked(utils.getRelativeTime).mockReturnValue('2 hours ago')
    vi.mocked(utils.isRelativeTimeSameOrAfter).mockReturnValue(false)

    const { container } = render(<ExpirationTime expirationTime={1234567890} />)

    expect(screen.getByTestId('expiration-time')).toHaveClass('text-text-warning')
    expect(screen.getByText('share.humanInput.expiredTip')).toBeInTheDocument()
    expect(container.querySelector('.i-ri-alert-fill')).toBeInTheDocument()
  })
})
