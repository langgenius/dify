import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactElement } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import InvitedModal from '../index'

let deploymentEdition: DeploymentEdition = 'COMMUNITY'
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

  it('should show invitation results', async () => {
    render(<InvitedModal invitationResults={results} onCancel={mockOnCancel} />)

    expect(await screen.findByText(/members\.invitationSent$/i)).toBeInTheDocument()
    expect(await screen.findByText(/members\.invitationLink/i)).toBeInTheDocument()
    expect(screen.getByText('http://invite.com/1')).toBeInTheDocument()
    expect(screen.getByText(/members\.alreadyInTeam$/i)).toBeInTheDocument()
    expect(screen.getByText('member@example.com')).toBeInTheDocument()
    expect(screen.getByText('failed@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'failed@example.com' })).toBeInTheDocument()
  })

  it('shows failure reasons on keyboard focus and dismisses the tooltip without closing the dialog', async () => {
    const user = userEvent.setup()
    render(
      <InvitedModal
        invitationResults={[
          { email: 'failed@example.com', status: 'failed', message: 'Quota exceeded' },
        ]}
        onCancel={mockOnCancel}
      />,
    )

    const closeButton = screen.getByRole('button', { name: /operation\.close/ })
    await waitFor(() => expect(closeButton).toHaveFocus())
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.tab()
    const failureTrigger = screen.getByRole('button', { name: 'failed@example.com' })
    expect(failureTrigger).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Quota exceeded')
    expect(failureTrigger).toHaveAccessibleDescription('Quota exceeded')

    await user.keyboard('{Enter}')
    expect(screen.getByRole('tooltip')).toBeVisible()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
    expect(mockOnCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(failureTrigger).toHaveFocus()
  })

  it('shows each failure reason when its email is hovered', async () => {
    const user = userEvent.setup()
    render(
      <InvitedModal
        invitationResults={[
          { email: 'first@example.com', status: 'failed', message: 'Quota exceeded' },
          { email: 'second@example.com', status: 'failed', message: 'Email delivery failed' },
        ]}
        onCancel={mockOnCancel}
      />,
    )

    const firstTrigger = screen.getByRole('button', { name: 'first@example.com' })
    await user.hover(firstTrigger)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Quota exceeded')
    expect(firstTrigger).toHaveAccessibleDescription('Quota exceeded')

    await user.unhover(firstTrigger)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())

    const secondTrigger = screen.getByRole('button', { name: 'second@example.com' })
    await user.hover(secondTrigger)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Email delivery failed')
    expect(secondTrigger).toHaveAccessibleDescription('Email delivery failed')
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

  it.each(['COMMUNITY', 'CLOUD'] as const)(
    'shows no-new-invitations copy when every email is already a member in %s',
    (edition) => {
      deploymentEdition = edition
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
    },
  )
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
})
