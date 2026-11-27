import type {
  MemberInviteResponse,
  PendingWorkspaceInvitationResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { createMutationInvalidation } from '@/service/console/mutation-invalidation'
import { TEST_WORKSPACE_ID } from '@/test/console/ids'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { apiError, installFakeApi } from '@/test/fake-api'
import { MembersPage } from '../index'

let fake: ReturnType<typeof installFakeApi>

const setup = (
  inviteResults: MemberInviteResponse['invitation_results'],
  acceptedMeanwhile?: string,
  isEmailSetup = true,
) => {
  let invitations: PendingWorkspaceInvitationResponse[] = []
  const { queryClient } = createConsoleQueryWrapper({
    // Like the app's client: a write refreshes its domain in the background.
    queryClient: createConsoleQueryClient({ invalidation: createMutationInvalidation() }),
    currentWorkspace: { role: 'owner' },
    systemFeatures: {
      deployment_edition: 'CLOUD',
      rbac_enabled: false,
      is_email_setup: isEmailSetup,
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

  const features = queryClient.getQueryData(consoleQuery.features.get.queryKey())!
  onTestFinished(() => queryClient.clear())
  fake = installFakeApi({
    console: {
      features: { get: () => features },
      workspaces: {
        current: {
          members: {
            get: () => ({ accounts }),
            inviteEmail: {
              post: () => {
                invitations = inviteResults
                  .filter(({ status }) => status === 'success')
                  .map(({ email }) => ({
                    email,
                    role: 'editor',
                    expires_at: '2026-12-01T09:00:00Z',
                  }))
                return {
                  result: 'success',
                  tenant_id: TEST_WORKSPACE_ID,
                  invitation_results: inviteResults,
                }
              },
            },
          },
          rbac: {
            roles: {
              get: () => ({
                data: [
                  {
                    id: 'editor',
                    tenant_id: TEST_WORKSPACE_ID,
                    type: 'workspace',
                    category: 'global_system_default',
                    name: 'Editor',
                    description: 'Edit apps',
                    is_builtin: true,
                    permission_keys: [],
                    role_tag: '',
                  },
                ],
                pagination: { total_count: 1, per_page: 20, current_page: 1, total_pages: 1 },
              }),
            },
          },
        },
        byWorkspaceId: {
          members: {
            pendingInvitations: {
              get: () => ({ invitations }),
              revoke: {
                post: ({ body: { email } }) => {
                  const live =
                    invitations.some((invitation) => invitation.email === email) ||
                    accounts.some(
                      (account) => account.email === email && account.status === 'pending',
                    )
                  invitations = invitations.filter((invitation) => invitation.email !== email)
                  accounts = accounts.filter(
                    (account) => !(account.email === email && account.status === 'pending'),
                  )
                  if (!live || email === acceptedMeanwhile)
                    throw apiError({
                      status: 404,
                      code: 'pending_invitation_not_found',
                      message: 'No live invitation exists for this email in the workspace.',
                    })
                  return { result: 'success' }
                },
              },
            },
          },
        },
      },
    },
  })
  onTestFinished(fake)
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

it('keeps the revoke dialog open with the action failure when revoking fails', async () => {
  const email = 'invited@example.com'
  const queryClient = setup([{ status: 'success', email, url: 'https://example.com/invite' }])
  fake.console.workspaces.byWorkspaceId.members.pendingInvitations.revoke.post.mockRejectedValueOnce(
    apiError({ status: 503, code: 'service_unavailable', message: 'Server says why' }),
  )
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <MembersPage />
    </QueryClientTestProvider>,
  )
  await sendInvite(screen, email)

  await screen
    .getByRole('table')
    .getByRole('button', { name: new RegExp(`members\\.invitationActions.*${email}`) })
    .click()
  await screen.getByRole('menuitem', { name: /members\.revokeInvitation$/ }).click()
  const confirm = screen.getByRole('alertdialog', { name: /members\.revokeInvitationTitle/ })
  await confirm.getByRole('button', { name: /members\.revokeInvitation$/ }).click()

  await expect.element(confirm.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
})

it('shows the new invitation link after a resend without email delivery', async () => {
  const email = 'invited@example.com'
  const queryClient = setup(
    [{ status: 'success', email, url: 'https://example.com/invite' }],
    undefined,
    false,
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

it('reports the action failure when a resend fails', async () => {
  const toastError = vi.spyOn(toast, 'error')
  onTestFinished(() => toastError.mockRestore())
  const email = 'invited@example.com'
  const queryClient = setup(
    [{ status: 'success', email, url: 'https://example.com/invite' }],
    undefined,
    false,
  )
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <MembersPage />
    </QueryClientTestProvider>,
  )
  await sendInvite(screen, email)
  await screen.getByRole('button', { name: /members\.ok$/ }).click()
  fake.console.workspaces.current.members.inviteEmail.post.mockRejectedValueOnce(
    apiError({ status: 503, code: 'service_unavailable', message: 'Server says why' }),
  )

  await screen
    .getByRole('table')
    .getByRole('button', { name: new RegExp(`members\\.invitationActions.*${email}`) })
    .click()
  await screen.getByRole('menuitem', { name: /members\.resendInvitation$/ }).click()

  await expect.poll(() => toastError).toHaveBeenCalledWith('common.api.actionFailed')
})
