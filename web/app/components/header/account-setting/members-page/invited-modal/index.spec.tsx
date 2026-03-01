import type { InvitationResult } from '@/models/common'
import { render, screen } from '@testing-library/react'
import InvitedModal from './index'

vi.mock('@/config', () => ({
  IS_CE_EDITION: true,
}))

describe('InvitedModal', () => {
  const mockOnCancel = vi.fn()
  const results: InvitationResult[] = [
    { email: 'success@example.com', status: 'success', url: 'http://invite.com/1' },
    { email: 'failed@example.com', status: 'failed', message: 'Error msg' },
  ]

  it('should show success and failed invitation sections', async () => {
    render(<InvitedModal invitationResults={results} onCancel={mockOnCancel} />)

    expect(await screen.findByText(/members\.invitationSent$/i)).toBeInTheDocument()
    expect(await screen.findByText(/members\.invitationLink/i)).toBeInTheDocument()
    expect(screen.getByText('http://invite.com/1')).toBeInTheDocument()
    expect(screen.getByText('failed@example.com')).toBeInTheDocument()
  })
})
