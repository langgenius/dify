import type { InvitationResult } from '@/models/common'
import { render, screen } from '@testing-library/react'
import InvitedModal from '../index'

const mockConfigState = vi.hoisted(() => ({ isCeEdition: true }))

vi.mock('@/config', () => ({
  get IS_CE_EDITION() {
    return mockConfigState.isCeEdition
  },
}))

describe('InvitedModal', () => {
  const mockOnCancel = vi.fn()
  const results: InvitationResult[] = [
    { email: 'success@example.com', status: 'success', url: 'http://invite.com/1' },
    { email: 'failed@example.com', status: 'failed', message: 'Error msg' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigState.isCeEdition = true
  })

  it('should show success and failed invitation sections', async () => {
    render(<InvitedModal invitationResults={results} onCancel={mockOnCancel} />)

    expect(await screen.findByText(/members\.invitationSent$/i)).toBeInTheDocument()
    expect(await screen.findByText(/members\.invitationLink/i)).toBeInTheDocument()
    expect(screen.getByText('http://invite.com/1')).toBeInTheDocument()
    expect(screen.getByText('failed@example.com')).toBeInTheDocument()
  })

  it('should hide invitation link section when there are no successes', () => {
    const failedOnly: InvitationResult[] = [
      { email: 'fail@example.com', status: 'failed', message: 'Quota exceeded' },
    ]

    render(<InvitedModal invitationResults={failedOnly} onCancel={mockOnCancel} />)

    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
    expect(screen.getByText(/members\.failedInvitationEmails/i)).toBeInTheDocument()
  })

  it('should hide failed section when there are only successes', () => {
    const successOnly: InvitationResult[] = [
      { email: 'ok@example.com', status: 'success', url: 'http://invite.com/2' },
    ]

    render(<InvitedModal invitationResults={successOnly} onCancel={mockOnCancel} />)

    expect(screen.getByText(/members\.invitationLink/i)).toBeInTheDocument()
    expect(screen.queryByText(/members\.failedInvitationEmails/i)).not.toBeInTheDocument()
  })

  it('should hide both sections when results are empty', () => {
    render(<InvitedModal invitationResults={[]} onCancel={mockOnCancel} />)

    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/members\.failedInvitationEmails/i)).not.toBeInTheDocument()
  })
})

describe('InvitedModal (non-CE edition)', () => {
  const mockOnCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigState.isCeEdition = false
  })

  afterEach(() => {
    mockConfigState.isCeEdition = true
  })

  it('should render invitationSentTip without CE edition content when IS_CE_EDITION is false', async () => {
    const results: InvitationResult[] = [
      { email: 'success@example.com', status: 'success', url: 'http://invite.com/1' },
    ]

    render(<InvitedModal invitationResults={results} onCancel={mockOnCancel} />)

    // The !IS_CE_EDITION branch - should show the tip text
    expect(await screen.findByText(/members\.invitationSentTip/i)).toBeInTheDocument()
    // CE-only content should not be shown
    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
  })
})
