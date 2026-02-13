import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InvitationLink from './invitation-link'

describe('InvitationLink', () => {
  const value = { email: 'test@example.com', status: 'success' as const, url: '/invite/123' }

  it('should render invitation url and keep it visible after click', async () => {
    const user = userEvent.setup()

    render(<InvitationLink value={value} />)

    const url = screen.getByText('/invite/123')
    await user.click(url)

    expect(url).toBeInTheDocument()
  })

  it('should keep link visible after copy feedback timeout passes', async () => {
    const user = userEvent.setup()

    render(<InvitationLink value={value} />)

    await user.click(screen.getByText('/invite/123'))

    await waitFor(() => {
      expect(screen.getByText('/invite/123')).toBeInTheDocument()
    }, { timeout: 1500 })
  })
})
