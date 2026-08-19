import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import InvitationLink from '../invitation-link'

vi.mock('copy-to-clipboard')

describe('InvitationLink', () => {
  const value = { email: 'test@example.com', status: 'success' as const, url: '/invite/123' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('should copy relative url with origin', async () => {
    const user = userEvent.setup()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost:3000' },
      configurable: true,
    })

    render(<InvitationLink value={value} />)

    const copyBtn = screen.getByRole('button', { name: 'appApi.copy' })
    await user.click(copyBtn)

    expect(copy).toHaveBeenCalledWith('http://localhost:3000/invite/123')

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    })
  })

  it('should copy absolute url as is', async () => {
    const user = userEvent.setup()
    const absoluteValue = { ...value, url: 'https://dify.ai/invite/123' }

    render(<InvitationLink value={absoluteValue} />)

    await user.click(screen.getByRole('button', { name: 'https://dify.ai/invite/123' }))

    expect(copy).toHaveBeenCalledWith('https://dify.ai/invite/123')
  })
})
