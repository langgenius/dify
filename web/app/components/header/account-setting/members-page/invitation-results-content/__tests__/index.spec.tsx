import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactElement } from 'react'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import InvitationResultsContent from '../index'

const mockOnCancel = vi.fn()
let deploymentEdition: DeploymentEdition = 'COMMUNITY'
const render = (ui: ReactElement) =>
  renderWithConsoleQuery(
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) mockOnCancel()
      }}
    >
      <DialogContent>{ui}</DialogContent>
    </Dialog>,
    { systemFeatures: { deployment_edition: deploymentEdition } },
  )

describe('InvitationResultsContent', () => {
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
    render(<InvitationResultsContent invitationResults={results} />)

    expect(await screen.findByText(/members\.invitationSent$/i)).toBeInTheDocument()
    expect(await screen.findByText(/members\.invitationLink/i)).toBeInTheDocument()
    expect(screen.getByText('http://invite.com/1')).toBeInTheDocument()
    expect(screen.getByText(/members\.alreadyInTeam$/i)).toBeInTheDocument()
    expect(screen.getByText('member@example.com')).toBeInTheDocument()
    expect(screen.getByText('failed@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'failed@example.com' })).toBeInTheDocument()
  })

  it('opens and reopens a failure reason with the keyboard without closing the results dialog', async () => {
    const user = userEvent.setup()
    render(
      <InvitationResultsContent
        invitationResults={[
          { email: 'failed@example.com', status: 'failed', message: 'Quota exceeded' },
        ]}
      />,
    )

    const closeButton = screen.getByRole('button', { name: /operation\.close/ })
    await waitFor(() => expect(closeButton).toHaveFocus())
    expect(screen.queryByRole('dialog', { name: 'failed@example.com' })).not.toBeInTheDocument()

    await user.tab()
    const failureTrigger = screen.getByRole('button', { name: 'failed@example.com' })
    expect(failureTrigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'failed@example.com' })).toHaveTextContent(
      'Quota exceeded',
    )

    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'failed@example.com' })).not.toBeInTheDocument(),
    )
    expect(mockOnCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /members\.invitationSent$/ })).toBeVisible()
    expect(failureTrigger).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'failed@example.com' })).toHaveTextContent(
      'Quota exceeded',
    )
  })

  it('opens a failure reason by clicking without hovering first', async () => {
    const user = userEvent.setup({ skipHover: true })
    render(<InvitationResultsContent invitationResults={results} />)

    await user.click(screen.getByRole('button', { name: 'failed@example.com' }))

    expect(await screen.findByRole('dialog', { name: 'failed@example.com' })).toHaveTextContent(
      'Error msg',
    )
    expect(mockOnCancel).not.toHaveBeenCalled()
  })

  it('shows each failure reason when its email is hovered', async () => {
    const user = userEvent.setup()
    render(
      <InvitationResultsContent
        invitationResults={[
          { email: 'first@example.com', status: 'failed', message: 'Quota exceeded' },
          { email: 'second@example.com', status: 'failed', message: 'Email delivery failed' },
        ]}
      />,
    )

    const firstTrigger = screen.getByRole('button', { name: 'first@example.com' })
    await user.hover(firstTrigger)
    expect(await screen.findByRole('dialog', { name: 'first@example.com' })).toHaveTextContent(
      'Quota exceeded',
    )

    await user.unhover(firstTrigger)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'first@example.com' })).not.toBeInTheDocument(),
    )

    const secondTrigger = screen.getByRole('button', { name: 'second@example.com' })
    await user.hover(secondTrigger)
    expect(await screen.findByRole('dialog', { name: 'second@example.com' })).toHaveTextContent(
      'Email delivery failed',
    )
  })

  it('should hide invitation link section when there are no successes', () => {
    const failedOnly: MemberInviteResponse['invitation_results'] = [
      { email: 'fail@example.com', status: 'failed', message: 'Quota exceeded' },
    ]

    render(<InvitationResultsContent invitationResults={failedOnly} />)

    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
    expect(screen.getByText(/members\.failedInvitationEmails/i)).toBeInTheDocument()
  })

  it('should hide failed section when there are only successes', () => {
    const successOnly: MemberInviteResponse['invitation_results'] = [
      { email: 'ok@example.com', status: 'success', url: 'http://invite.com/2' },
    ]

    render(<InvitationResultsContent invitationResults={successOnly} />)

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

      render(<InvitationResultsContent invitationResults={alreadyMembers} />)

      expect(screen.getByText(/members\.noNewInvitationsSent/i)).toBeInTheDocument()
      expect(screen.getByText(/members\.alreadyInTeamTip/i)).toBeInTheDocument()
      expect(screen.getByText('member@example.com')).toBeInTheDocument()
      expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
    },
  )
})

describe('InvitationResultsContent (Cloud edition)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deploymentEdition = 'CLOUD'
  })

  it('should render invitationSentTip without self-hosted content', async () => {
    const results: MemberInviteResponse['invitation_results'] = [
      { email: 'success@example.com', status: 'success', url: 'http://invite.com/1' },
    ]

    render(<InvitationResultsContent invitationResults={results} />)

    expect(await screen.findByText(/members\.invitationSentTip/i)).toBeInTheDocument()
    expect(screen.queryByText(/members\.invitationLink/i)).not.toBeInTheDocument()
  })
})
