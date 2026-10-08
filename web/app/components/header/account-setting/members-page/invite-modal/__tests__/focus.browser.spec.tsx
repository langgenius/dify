import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import MembersPage from '../../index'

const { inviteMember } = vi.hoisted(() => ({ inviteMember: vi.fn() }))
vi.mock('#i18n', () => ({ useLocale: () => 'en-US' }))
vi.mock('@/service/access-control/use-workspace-roles', () => ({
  useWorkspaceRoleList: () => ({
    data: { pages: [{ data: [{ id: 'admin', name: 'Admin', description: 'Manage members' }] }] },
    isLoading: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}))

let queryClient: QueryClient

beforeEach(() => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  inviteMember.mockReset()
  queryClient = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD', is_email_setup: true },
    workspacePermissionKeys: ['workspace.member.manage'],
    features: { workspace_members: { enabled: true, size: 1, limit: 10 } },
  }).queryClient
  queryClient.setQueryData([...commonQueryKeys.members, 'en'], { accounts: [] })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const { pathname } = new URL(input instanceof Request ? input.url : String(input))
      if (pathname.endsWith('/workspaces/current/members/invite-email'))
        return Response.json(await inviteMember())
      // A successful invitation refreshes seats and members in the background.
      if (pathname.endsWith('/features'))
        return Response.json(queryClient.getQueryData(consoleQuery.features.get.queryKey()))
      if (pathname.endsWith('/workspaces/current/members')) return Response.json({ accounts: [] })
      throw new Error(`Unexpected request: ${pathname}`)
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

it.each(['click', 'Enter'] as const)(
  'holds focus through %s submission, hands it to the results dialog and returns it to Invite',
  async (submission) => {
    let resolveInvite!: (value: MemberInviteResponse) => void
    inviteMember.mockReturnValue(
      new Promise<MemberInviteResponse>((resolve) => {
        resolveInvite = resolve
      }),
    )
    const screen = await render(
      <QueryClientTestProvider queryClient={queryClient}>
        <MembersPage />
      </QueryClientTestProvider>,
    )
    const trigger = screen.getByRole('button', { name: /members\.invite$/ })
    await trigger.click()
    const inviteDialog = screen.getByRole('dialog', { name: /members\.inviteTeamMember$/ })
    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/ })
    await expect.element(input).toHaveFocus()
    await input.fill('person@example.com')
    if (submission === 'Enter') {
      await userEvent.keyboard('{Enter}')
      await expect.element(input).toHaveValue('')
    }
    await screen.getByRole('combobox', { name: /members\.role/ }).click()
    await screen.getByRole('option', { name: /Admin/ }).click()
    const submit = screen.getByRole('button', { name: /members\.sendInvite/ })
    if (submission === 'Enter') {
      await input.click()
      await userEvent.keyboard('{Enter}')
    } else {
      await submit.click()
    }

    await expect.element(submit).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    const outside = document.elementFromPoint(4, 4)!
    await userEvent.click(outside, { position: { x: 4, y: 4 } })
    await userEvent.tab()
    await expect.element(submit).toHaveFocus()
    await expect.element(inviteDialog).toBeVisible()
    await expect
      .element(inviteDialog.getByRole('button', { name: /operation\.close/ }))
      .toBeDisabled()

    resolveInvite({ result: 'success', tenant_id: 'tenant-id', invitation_results: [] })
    const result = screen.getByRole('dialog', { name: /members\.invitationSent$/ })
    await expect.element(result).toBeVisible()
    await expect.element(result.getByRole('button', { name: /operation\.close/ })).toHaveFocus()
    // The closing invitation dialog must not take focus back while it exits.
    await expect.element(inviteDialog).not.toBeInTheDocument()
    expect(result.element().contains(document.activeElement)).toBe(true)

    await result.getByRole('button', { name: /members\.ok$/ }).click()
    await expect.element(result).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  },
)
