import type { PendingWorkspaceInvitationResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import MembersPage from '../index'

const workspaceId = '74e6f5f1-621e-4ca0-910f-94c686e4ada1'
const email = 'invited@example.com'

it('shows the pending workspace invitation after sending it and reopening Members', async () => {
  let invitations: PendingWorkspaceInvitationResponse[] = []
  const { queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { id: workspaceId, role: 'owner' },
    systemFeatures: { deployment_edition: 'CLOUD', rbac_enabled: false, is_email_setup: true },
    workspacePermissionKeys: ['workspace.member.manage'],
  })
  const accounts = [
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
    vi.fn(async (input: RequestInfo | URL) => {
      const { pathname } = new URL(input instanceof Request ? input.url : String(input))
      if (pathname.endsWith('/workspaces/current/members/invite-email')) {
        invitations = [{ email, role: 'editor', expires_at: '2026-12-01T09:00:00Z' }]
        return Response.json({
          result: 'success',
          tenant_id: workspaceId,
          invitation_results: [{ status: 'success', email, url: 'https://example.com/invite' }],
        })
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

  const membersPage = () => (
    <QueryClientTestProvider queryClient={queryClient}>
      <MembersPage />
    </QueryClientTestProvider>
  )
  const screen = await render(membersPage())
  const pending = screen.getByRole('table', { name: /members\.pendingInvitations$/ })
  await expect.element(screen.getByText(/members\.awaitingAccountActivation$/)).toBeVisible()
  await expect.element(pending).not.toBeInTheDocument()

  await screen.getByRole('button', { name: /members\.invite$/ }).click()
  await screen.getByRole('textbox', { name: /members\.emailRecipients/ }).fill(email)
  await screen.getByRole('combobox', { name: /members\.role/ }).click()
  await screen.getByRole('option', { name: /Editor/ }).click()
  await screen.getByRole('button', { name: /members\.sendInvite/ }).click()
  const result = screen.getByRole('dialog', { name: /members\.invitationSent$/ })
  await result.getByRole('button', { name: /members\.ok$/ }).click()
  await expect.element(pending.getByRole('rowheader', { name: email })).toBeVisible()

  await screen.unmount()
  queryClient.removeQueries({
    queryKey: consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.key(),
  })
  const reopened = await render(membersPage())
  await expect
    .element(
      reopened
        .getByRole('table', { name: /members\.pendingInvitations$/ })
        .getByRole('rowheader', { name: email }),
    )
    .toBeVisible()
})
