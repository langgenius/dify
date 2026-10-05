import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import InvitedModal from '../../invited-modal'
import { InviteModal } from '../index'

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
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleQuery: new Proxy(actual.consoleQuery, {
      get(target, key) {
        if (key !== 'workspaces') return Reflect.get(target, key)
        return {
          current: {
            summary: target.workspaces.current.summary,
            members: {
              inviteEmail: {
                post: {
                  mutationOptions: (
                    options: Parameters<
                      typeof actual.consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions
                    >[0],
                  ) => ({ ...options, mutationFn: inviteMember }),
                },
              },
            },
          },
        }
      },
    }),
  }
})

function InvitationFlow() {
  const [results, setResults] = useState<MemberInviteResponse['invitation_results'] | null>(null)
  return (
    <>
      <InviteModal isEmailSetup onSend={setResults} />
      {results && <InvitedModal invitationResults={results} onCancel={() => setResults(null)} />}
    </>
  )
}

afterEach(() => vi.unstubAllGlobals())

it.each(['click', 'Enter'] as const)(
  'holds focus through %s submission and refresh, transfers it to results and returns it to Invite',
  async (submission) => {
    vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    seedCurrentWorkspaceQuery(queryClient)
    queryClient.setQueryData(
      systemFeaturesQueryOptions().queryKey,
      createSystemFeaturesFixture({ deployment_edition: 'CLOUD' }),
    )
    queryClient.setQueryData(
      consoleQuery.features.get.queryKey(),
      zGetFeaturesResponse.parse({
        workspace_members: { enabled: true, size: 1, limit: 10 },
      }),
    )
    let resolveInvite!: (value: MemberInviteResponse) => void
    inviteMember.mockReturnValue(
      new Promise<MemberInviteResponse>((resolve) => {
        resolveInvite = resolve
      }),
    )
    const refreshes: Array<() => void> = []
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(() => new Promise<void>((resolve) => refreshes.push(resolve)))
    const screen = await render(
      <QueryClientTestProvider queryClient={queryClient}>
        <InvitationFlow />
      </QueryClientTestProvider>,
    )
    const trigger = screen.getByRole('button', { name: /members\.invite$/ })
    await trigger.click()
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
    await expect
      .element(screen.getByRole('dialog', { name: /members\.inviteTeamMember$/ }))
      .toBeVisible()
    await expect.element(screen.getByRole('button', { name: /operation\.close/ })).toBeDisabled()
    resolveInvite({ result: 'success', tenant_id: 'tenant-id', invitation_results: [] })
    await expect.poll(() => invalidate.mock.calls.length).toBe(2)
    await userEvent.keyboard('{Escape}')
    await expect.element(submit).toHaveFocus()
    refreshes.forEach((resolve) => resolve())
    const result = screen.getByRole('dialog', { name: /members\.invitationSent$/ })
    await expect.element(result).toBeVisible()
    await expect.element(result.getByRole('button', { name: /operation\.close/ })).toHaveFocus()
    await result.getByRole('button', { name: /members\.ok$/ }).click()
    await expect.element(result).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  },
)
