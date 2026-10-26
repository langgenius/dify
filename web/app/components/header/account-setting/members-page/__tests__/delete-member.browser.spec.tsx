import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import MembersPage from '../index'

const api = vi.hoisted(() => ({
  features: vi.fn<typeof consoleClient.features.get>(),
  members: vi.fn<typeof consoleClient.workspaces.current.members.get>(),
  remove: vi.fn<typeof consoleClient.workspaces.current.members.byMemberId.delete>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.members.get': api.members,
      'features.get': api.features,
      'workspaces.current.members.byMemberId.delete': api.remove,
    }),
  }
})
const member = (id: string): AccountWithRoleResponse => ({
  id,
  name: id,
  email: `${id}@example.com`,
  avatar: '',
  avatar_url: '',
  role: 'normal',
  roles: [],
  last_active_at: 1731000000,
  last_login_at: 1731000000,
  created_at: 1731000000,
  status: 'active',
})
beforeEach(() => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      throw new Error(`Unexpected request: ${String(input)}`)
    }),
  )
})
afterEach(() => {
  expect(
    vi
      .mocked(fetch)
      .mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input))),
  ).toEqual([])
  vi.unstubAllGlobals()
})

async function setup(ids: string[]) {
  let accounts = ids.map(member)
  api.members.mockReset().mockImplementation(async () => ({ accounts }))
  api.remove.mockReset().mockImplementation(async ({ params }) => {
    accounts = accounts.filter((item) => item.id !== params.member_id)
    return { result: 'success', tenant_id: 'tenant-1' }
  })
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'COMMUNITY' },
    workspacePermissionKeys: ['workspace.member.manage'],
  })
  api.features.mockResolvedValue(queryClient.getQueryData(consoleQuery.features.get.queryKey())!)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <MembersPage />
    </QueryClientTestProvider>,
  )
  const open = async (id: string) => {
    await screen
      .getByRole('button', { name: `workspaceMembers.members.memberActions: ${id}`, exact: true })
      .click()
    await screen.getByRole('menuitem', { name: /members\.removeFromTeam$/ }).click()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  }
  return { screen, open }
}

it('removes the member before a slow list refresh completes', async () => {
  const { screen, open } = await setup(['Alpha', 'Beta'])
  await open('Alpha')
  const list = api.members.getMockImplementation()!
  const refresh = createDeferred<Awaited<ReturnType<typeof list>>>()
  api.members.mockReturnValueOnce(refresh.promise)
  await screen.getByRole('button', { name: /operation\.confirm$/ }).click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Alpha', exact: true }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Beta', exact: true })).toHaveFocus()
  refresh.resolve(await list())
})

it.each([
  { ids: ['Alpha', 'Beta', 'Gamma'], remove: 'Beta', next: 'Gamma' },
  { ids: ['Alpha', 'Beta'], remove: 'Beta', next: 'Alpha' },
  { ids: ['Alpha'], remove: 'Alpha', next: null },
])('returns focus after removing $remove from $ids', async ({ ids, remove, next }) => {
  const { screen, open } = await setup(ids)
  await open(remove)
  await screen.getByRole('button', { name: /operation\.confirm$/ }).click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: remove, exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(
      next ? screen.getByRole('button', { name: next, exact: true }) : screen.getByRole('region'),
    )
    .toHaveFocus()
})

it('keeps focus and blocks Escape/cancel during removal, then reports a retryable failure', async () => {
  const { screen, open } = await setup(['Alpha'])
  const request =
    createDeferred<
      Awaited<ReturnType<typeof consoleClient.workspaces.current.members.byMemberId.delete>>
    >()
  api.remove.mockReturnValueOnce(request.promise)
  await open('Alpha')
  const confirm = screen.getByRole('button', { name: /operation\.confirm$/ })
  await confirm.click()
  await expect.element(confirm).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('button', { name: /operation\.cancel$/ })).toBeDisabled()
  await expect.element(screen.getByRole('alertdialog')).toBeVisible()
  expect(api.remove).toHaveBeenCalledTimes(1)
  request.reject(new Error('Failed'))
  await expect.element(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
  await confirm.click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect.element(screen.getByRole('region')).toHaveFocus()
})

it('returns to the menu button when cancelled', async () => {
  const { screen, open } = await setup(['Alpha'])
  await open('Alpha')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect
    .element(
      page.getByRole('button', {
        name: 'workspaceMembers.members.memberActions: Alpha',
        exact: true,
      }),
    )
    .toHaveFocus()
  expect(api.remove).not.toHaveBeenCalled()
})
