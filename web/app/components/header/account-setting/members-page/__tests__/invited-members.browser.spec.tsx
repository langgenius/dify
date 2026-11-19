import type {
  MemberInviteResponse,
  PendingWorkspaceInvitationResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { MembersPage } from '../index'

const workspaceId = '74e6f5f1-621e-4ca0-910f-94c686e4ada1'

const setup = (
  inviteResults: MemberInviteResponse['invitation_results'],
  acceptedMeanwhile?: string,
  deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'CLOUD',
) => {
  let invitations: PendingWorkspaceInvitationResponse[] = []
  const { queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { id: workspaceId, role: 'owner' },
    systemFeatures: {
      deployment_edition: deploymentEdition,
      rbac_enabled: false,
      is_email_setup: true,
    },
    workspacePermissionKeys: ['workspace.member.manage'],
  })
  let accounts = [
    {
      id: 'new-member',
      name: 'New Member',
      email: 'new@example.com',
      created_at: 1770000000,
      last_login_at: null,
      last_active_at: null,
      avatar: null,
      avatar_url: null,
      status: 'pending',
      role: 'editor',
      roles: [{ id: 'editor', name: 'editor' }],
    },
  ]

  onTestFinished(() => {
    queryClient.clear()
    vi.unstubAllGlobals()
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = new URL(input instanceof Request ? input.url : String(input))
      if (pathname.endsWith('/workspaces/current/members/invite-email')) {
        invitations = inviteResults
          .filter(({ status }) => status === 'success')
          .map(({ email }) => ({ email, role: 'editor', expires_at: '2026-12-01T09:00:00Z' }))
        return Response.json({
          result: 'success',
          tenant_id: workspaceId,
          invitation_results: inviteResults,
        })
      }
      if (pathname.endsWith(`/workspaces/${workspaceId}/members/pending-invitations/revoke`)) {
        const body = input instanceof Request ? await input.clone().text() : String(init?.body)
        const { email } = JSON.parse(body)
        const live =
          invitations.some((invitation) => invitation.email === email) ||
          accounts.some((account) => account.email === email && account.status === 'pending')
        invitations = invitations.filter((invitation) => invitation.email !== email)
        accounts = accounts.filter(
          (account) => !(account.email === email && account.status === 'pending'),
        )
        if (!live || email === acceptedMeanwhile)
          return Response.json(
            {
              code: 'pending_invitation_not_found',
              message: 'No live invitation exists for this email in the workspace.',
              status: 404,
            },
            { status: 404 },
          )
        return Response.json({ result: 'success' })
      }
      if (pathname.endsWith(`/workspaces/${workspaceId}/members/pending-invitations`))
        return Response.json({ invitations })
      if (pathname.endsWith('/workspaces/current/rbac/roles'))
        return Response.json({
          data: [{ id: 'editor', name: 'Editor', description: 'Edit apps' }],
          pagination: { total_count: 1, per_page: 20, current_page: 1, total_pages: 1 },
        })
      if (pathname.endsWith('/workspaces/current/members')) return Response.json({ accounts })
      if (pathname.endsWith('/features'))
        return Response.json(queryClient.getQueryData(consoleQuery.features.get.queryKey()))
      throw new Error(`Unexpected request: ${pathname}`)
    }),
  )
  return queryClient
}

const sendInvite = async (screen: Awaited<ReturnType<typeof render>>, emails: string) => {
  await screen.getByRole('button', { name: /members\.invite$/ }).click()
  await screen.getByRole('textbox', { name: /members\.emailRecipients/ }).fill(emails)
  await screen.getByRole('combobox', { name: /members\.role/ }).click()
  await screen.getByRole('option', { name: /Editor/ }).click()
  await screen.getByRole('button', { name: /members\.sendInvite/ }).click()
}

it('lists everyone who has not joined yet as invited in the members table', async () => {
  const email = 'invited@example.com'
  const queryClient = setup([{ status: 'success', email, url: 'https://example.com/invite' }])
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <MembersPage />
    </QueryClientTestProvider>,
  )
  const members = screen.getByRole('table')
  await expect
    .element(members.getByRole('row', { name: /new@example\.com/ }).getByText(/members\.invited$/))
    .toBeVisible()

  await sendInvite(screen, email)

  await expect
    .element(screen.getByRole('dialog', { name: /members\.inviteTeamMember$/ }))
    .not.toBeInTheDocument()
  const invitedRow = members.getByRole('row', { name: new RegExp(email) })
  await expect.element(invitedRow.getByText(/members\.invited$/)).toBeVisible()
  await expect.element(invitedRow.getByText(/members\.invitationExpiresOn/)).toBeVisible()
})

it('keeps unsent recipients in the invite dialog with their reasons', async () => {
  const queryClient = setup([
    { status: 'success', email: 'sent@example.com', url: 'https://example.com/invite' },
    { status: 'failed', email: 'failed@example.com', message: 'Rate limited.' },
    { status: 'already_member', email: 'new@example.com', message: 'Already in workspace.' },
  ])
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <MembersPage />
    </QueryClientTestProvider>,
  )

  await sendInvite(screen, 'sent@example.com, failed@example.com, new@example.com')

  const dialog = screen.getByRole('dialog', { name: /members\.inviteTeamMember$/ })
  await expect.element(dialog.getByText(/members\.invitePartiallyFailed/)).toBeVisible()
  await expect.element(dialog.getByText('Rate limited.')).toBeVisible()
  await expect.element(dialog.getByText(/members\.alreadyInWorkspace/)).toBeVisible()
  // Only the unsent recipient stays in the field for a retry.
  await expect.element(dialog.getByText('failed@example.com').first()).toBeVisible()
  await expect.element(dialog.getByText('sent@example.com')).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(screen.getByRole('table').getByRole('row', { name: /sent@example\.com/ }))
    .toBeVisible()
})

it('revokes both kinds of invited people through the same row menu', async () => {
  const email = 'invited@example.com'
  const queryClient = setup([{ status: 'success', email, url: 'https://example.com/invite' }])
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <MembersPage />
    </QueryClientTestProvider>,
  )
  await sendInvite(screen, email)
  const members = screen.getByRole('table')

  for (const invitee of [email, 'new@example.com']) {
    await members
      .getByRole('button', { name: new RegExp(`members\\.invitationActions.*${invitee}`) })
      .click()
    await screen.getByRole('menuitem', { name: /members\.revokeInvitation$/ }).click()
    const confirm = screen.getByRole('alertdialog', { name: /members\.revokeInvitationTitle/ })
    await confirm.getByRole('button', { name: /members\.revokeInvitation$/ }).click()
    await expect.element(confirm).not.toBeInTheDocument()
    await expect
      .element(members.getByRole('row', { name: new RegExp(invitee) }))
      .not.toBeInTheDocument()
  }
})

it('closes the revoke dialog and refreshes when the invitation was accepted meanwhile', async () => {
  const email = 'invited@example.com'
  const queryClient = setup(
    [{ status: 'success', email, url: 'https://example.com/invite' }],
    email,
  )
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <MembersPage />
    </QueryClientTestProvider>,
  )
  await sendInvite(screen, email)
  const members = screen.getByRole('table')

  await members
    .getByRole('button', { name: new RegExp(`members\\.invitationActions.*${email}`) })
    .click()
  await screen.getByRole('menuitem', { name: /members\.revokeInvitation$/ }).click()
  const confirm = screen.getByRole('alertdialog', { name: /members\.revokeInvitationTitle/ })
  await confirm.getByRole('button', { name: /members\.revokeInvitation$/ }).click()

  await expect.element(confirm).not.toBeInTheDocument()
  await expect
    .element(members.getByRole('row', { name: new RegExp(email) }))
    .not.toBeInTheDocument()
})

it('shows the new invitation link after a resend outside Cloud', async () => {
  const email = 'invited@example.com'
  const queryClient = setup(
    [{ status: 'success', email, url: 'https://example.com/invite' }],
    undefined,
    'COMMUNITY',
  )
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <MembersPage />
    </QueryClientTestProvider>,
  )
  await sendInvite(screen, email)
  await screen.getByRole('button', { name: /members\.ok$/ }).click()

  await screen
    .getByRole('table')
    .getByRole('button', { name: new RegExp(`members\\.invitationActions.*${email}`) })
    .click()
  await screen.getByRole('menuitem', { name: /members\.resendInvitation$/ }).click()

  const result = screen.getByRole('dialog', { name: /members\.invitationSent$/ })
  await expect.element(result.getByText(/members\.invitationLink$/)).toBeVisible()
})
