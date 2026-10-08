import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { QueryClient } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { InviteModal } from '../index'

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }))
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
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))

const features = zGetFeaturesResponse.parse({
  workspace_members: { enabled: true, size: 1, limit: 10 },
})

afterEach(() => vi.unstubAllGlobals())

it('holds focus and ignores dismissal while an Enter submission is pending, then returns focus to Invite', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  seedCurrentWorkspaceQuery(queryClient)
  queryClient.setQueryData(
    systemFeaturesQueryOptions().queryKey,
    createSystemFeaturesFixture({ deployment_edition: 'CLOUD' }),
  )
  queryClient.setQueryData(consoleQuery.features.get.queryKey(), features)
  let resolveInvite!: (value: MemberInviteResponse) => void
  transport.mockImplementation(async (path: string[]) => {
    const operation = path.join('.')
    if (operation === 'workspaces.current.members.inviteEmail.post')
      return new Promise<MemberInviteResponse>((resolve) => {
        resolveInvite = resolve
      })
    if (operation === 'features.get') return features
    throw new Error(`Unexpected transport: ${operation}`)
  })
  const onSend = vi.fn()
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <InviteModal isEmailSetup onSend={onSend} />
    </QueryClientTestProvider>,
  )
  const trigger = screen.getByRole('button', { name: /members\.invite$/ })
  await trigger.click()
  const dialog = screen.getByRole('dialog', { name: /members\.inviteTeamMember$/ })
  const input = screen.getByRole('textbox', { name: /members\.emailRecipients/ })
  await expect.element(input).toHaveFocus()
  await input.fill('person@example.com')
  await userEvent.keyboard('{Enter}')
  await expect.element(input).toHaveValue('')
  await screen.getByRole('combobox', { name: /members\.role/ }).click()
  await screen.getByRole('option', { name: /Admin/ }).click()
  await input.click()
  await userEvent.keyboard('{Enter}')

  const submit = screen.getByRole('button', { name: /members\.sendInvite/ })
  await expect.element(submit).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  const outside = document.elementFromPoint(4, 4)!
  await userEvent.click(outside, { position: { x: 4, y: 4 } })
  await userEvent.tab()
  await expect.element(submit).toHaveFocus()
  await expect.element(dialog).toBeVisible()
  await expect.element(screen.getByRole('button', { name: /operation\.close/ })).toBeDisabled()

  resolveInvite({ result: 'success', tenant_id: 'tenant-id', invitation_results: [] })
  await expect.element(dialog).not.toBeInTheDocument()
  expect(onSend).toHaveBeenCalledExactlyOnceWith([])
  await expect.element(trigger).toHaveFocus()
})
