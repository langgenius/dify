import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactElement } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { InvitedDialog } from '../index'

let deploymentEdition: DeploymentEdition = 'COMMUNITY'
const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, { systemFeatures: { deployment_edition: deploymentEdition } })

describe('InvitedDialog', () => {
  const mockOnOpenChange = vi.fn()
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
    render(
      <InvitedDialog
        open
        onOpenChangeComplete={vi.fn()}
        invitationResults={results}
        onOpenChange={mockOnOpenChange}
      />,
    )

    expect(
      await screen.findByRole('dialog', { name: /members\.invitationSent$/i }),
    ).toHaveAccessibleDescription('workspaceMembers.members.invitationSentTip')
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

    render(
      <InvitedDialog
        open
        onOpenChangeComplete={vi.fn()}
        invitationResults={failedOnly}
        onOpenChange={mockOnOpenChange}
      />,
    )

    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
    expect(screen.getByText(/members\.failedInvitationEmails/i)).toBeInTheDocument()
  })

  it('should hide failed section when there are only successes', () => {
    const successOnly: MemberInviteResponse['invitation_results'] = [
      { email: 'ok@example.com', status: 'success', url: 'http://invite.com/2' },
    ]

    render(
      <InvitedDialog
        open
        onOpenChangeComplete={vi.fn()}
        invitationResults={successOnly}
        onOpenChange={mockOnOpenChange}
      />,
    )

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

    render(
      <InvitedDialog
        open
        onOpenChangeComplete={vi.fn()}
        invitationResults={alreadyMembers}
        onOpenChange={mockOnOpenChange}
      />,
    )

    expect(screen.getByText(/members\.noNewInvitationsSent/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'workspaceMembers.members.alreadyInTeamTip',
    )
    expect(screen.getAllByText(/members\.alreadyInTeamTip/i)).toHaveLength(1)
    expect(screen.getByText('member@example.com')).toBeInTheDocument()
    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
  })

  it('should hide both sections when results are empty', () => {
    render(
      <InvitedDialog
        open
        onOpenChangeComplete={vi.fn()}
        invitationResults={[]}
        onOpenChange={mockOnOpenChange}
      />,
    )

    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/members\.failedInvitationEmails/i)).not.toBeInTheDocument()
  })
})

describe('InvitedDialog (Cloud edition)', () => {
  const mockOnOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    deploymentEdition = 'CLOUD'
  })

  it('should render invitationSentTip without self-hosted content', async () => {
    const results: MemberInviteResponse['invitation_results'] = [
      { email: 'success@example.com', status: 'success', url: 'http://invite.com/1' },
    ]

    render(
      <InvitedDialog
        open
        onOpenChangeComplete={vi.fn()}
        invitationResults={results}
        onOpenChange={mockOnOpenChange}
      />,
    )

    expect(await screen.findByRole('dialog')).toHaveAccessibleDescription(
      'workspaceMembers.members.invitationSentTip',
    )
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

    render(
      <InvitedDialog
        open
        onOpenChangeComplete={vi.fn()}
        invitationResults={results}
        onOpenChange={mockOnOpenChange}
      />,
    )

    expect(screen.getByText(/members\.noNewInvitationsSent/i)).toBeInTheDocument()
    expect(screen.getByText(/members\.alreadyInTeam$/i)).toBeInTheDocument()
    expect(screen.getByText('member@example.com')).toBeInTheDocument()
  })
})

describe('InvitedDialog closing', () => {
  it.each(['common.operation.close', 'workspaceMembers.members.ok'])(
    'closes through %s and reports completion',
    async (name) => {
      deploymentEdition = 'COMMUNITY'
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      const onOpenChangeComplete = vi.fn()
      function ResultSession() {
        const [open, setOpen] = useState(true)
        return (
          <InvitedDialog
            open={open}
            invitationResults={[
              { email: 'new@example.com', status: 'success', url: 'https://invite.example/new' },
            ]}
            onOpenChange={(nextOpen) => {
              onOpenChange(nextOpen)
              setOpen(nextOpen)
            }}
            onOpenChangeComplete={onOpenChangeComplete}
          />
        )
      }
      render(<ResultSession />)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name }))
      expect(onOpenChange).toHaveBeenCalledWith(false)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(onOpenChangeComplete).toHaveBeenCalledWith(false))
    },
  )
})
