import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactElement } from 'react'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import InvitedModal from '../index'

let deploymentEdition: DeploymentEdition | null = 'COMMUNITY'
const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, { systemFeatures: { deployment_edition: deploymentEdition } })

describe('InvitedModal', () => {
  const mockOnCancel = vi.fn()
  const results: MemberInviteResponse['invitation_results'] = [
    { email: 'success@example.com', status: 'success', url: 'http://invite.com/1' },
    {
      email: 'member@example.com',
      status: 'already_member',
      message: 'Account already in workspace.',
    },
    { email: 'failed@example.com', status: 'failed', message: 'Error msg' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    deploymentEdition = 'COMMUNITY'
  })

  it('should show success and failed invitation sections', async () => {
    render(<InvitedModal invitationResults={results} onCancel={mockOnCancel} />)

    expect(await screen.findByText(/members\.invitationSent$/i)).toBeInTheDocument()
    expect(await screen.findByText(/members\.invitationLink/i)).toBeInTheDocument()
    expect(screen.getByText('http://invite.com/1')).toBeInTheDocument()
    expect(screen.getByText(/members\.alreadyInTeam$/i)).toBeInTheDocument()
    expect(screen.getByText('member@example.com')).toBeInTheDocument()
    expect(screen.getByText('failed@example.com')).toBeInTheDocument()
  })

  it('should hide invitation link section when there are no successes', () => {
    const failedOnly: MemberInviteResponse['invitation_results'] = [
      { email: 'fail@example.com', status: 'failed', message: 'Quota exceeded' },
    ]

    render(<InvitedModal invitationResults={failedOnly} onCancel={mockOnCancel} />)

    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
    expect(screen.getByText(/members\.failedInvitationEmails/i)).toBeInTheDocument()
  })

  it('should hide failed section when there are only successes', () => {
    const successOnly: MemberInviteResponse['invitation_results'] = [
      { email: 'ok@example.com', status: 'success', url: 'http://invite.com/2' },
    ]

    render(<InvitedModal invitationResults={successOnly} onCancel={mockOnCancel} />)

    expect(screen.getByText(/members\.invitationLink/i)).toBeInTheDocument()
    expect(screen.queryByText(/members\.failedInvitationEmails/i)).not.toBeInTheDocument()
  })

  it('should show already-member message without invitation copy when every email is already a member', () => {
    const alreadyMembers: MemberInviteResponse['invitation_results'] = [
      {
        email: 'member@example.com',
        status: 'already_member',
        message: 'Account already in workspace.',
      },
    ]

    render(<InvitedModal invitationResults={alreadyMembers} onCancel={mockOnCancel} />)

    expect(screen.getByText(/members\.noNewInvitationsSent/i)).toBeInTheDocument()
    expect(screen.getByText(/members\.alreadyInTeamTip/i)).toBeInTheDocument()
    expect(screen.getByText('member@example.com')).toBeInTheDocument()
    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
  })

  it('should hide both sections when results are empty', () => {
    render(<InvitedModal invitationResults={[]} onCancel={mockOnCancel} />)

    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/members\.failedInvitationEmails/i)).not.toBeInTheDocument()
  })
})

describe('InvitedModal (Cloud edition)', () => {
  const mockOnCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    deploymentEdition = 'CLOUD'
  })

  it('should render invitationSentTip without self-hosted content', async () => {
    const results: MemberInviteResponse['invitation_results'] = [
      { email: 'success@example.com', status: 'success', url: 'http://invite.com/1' },
    ]

    render(<InvitedModal invitationResults={results} onCancel={mockOnCancel} />)

    expect(await screen.findByText(/members\.invitationSentTip/i)).toBeInTheDocument()
    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
  })

  it('should show already-member details', () => {
    const results: MemberInviteResponse['invitation_results'] = [
      {
        email: 'member@example.com',
        status: 'already_member',
        message: 'Account already in workspace.',
      },
    ]

    render(<InvitedModal invitationResults={results} onCancel={mockOnCancel} />)

    expect(screen.getByText(/members\.noNewInvitationsSent/i)).toBeInTheDocument()
    expect(screen.getByText(/members\.alreadyInTeam$/i)).toBeInTheDocument()
    expect(screen.getByText('member@example.com')).toBeInTheDocument()
  })
})

describe('InvitedModal (unknown deployment edition)', () => {
  it('does not render Cloud- or self-hosted-specific invitation copy', () => {
    deploymentEdition = null

    render(
      <InvitedModal
        invitationResults={[
          { email: 'success@example.com', status: 'success', url: 'http://invite.com/1' },
        ]}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByText(/members\.invitationSentTip/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
  })
})
