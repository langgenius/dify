import type { consoleClient } from '@/service/console'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { NewKnowledgeList } from '../new-knowledge-list'

type KnowledgeFsSpaceListItemResponse = Awaited<
  ReturnType<typeof consoleClient.knowledgeFs.spaces.get>
>['data'][number]

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.knowledgeFs.spaces.get>(),
  remove: vi.fn<typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.delete>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.get': api.list,
      'knowledgeFs.spaces.byControlSpaceId.delete': api.remove,
      'datasets.knowledgeFsUpgradeJobs.get': async () => ({ data: [] }),
      'datasets.apiBaseInfo.get': async () => ({ api_base_url: '' }),
      'workspaces.current.members.get': async () => ({ accounts: [] }),
      'tags.get': async () => [],
    }),
  }
})
const space = (
  id: string,
  name: string,
  overrides: Partial<KnowledgeFsSpaceListItemResponse> = {},
): KnowledgeFsSpaceListItemResponse => ({
  control_space_id: id,
  created_at: '2026-07-15T00:00:00Z',
  knowledge_space_id: id,
  linked_apps: 0,
  owner_account_id: 'account-1',
  permission_keys: ['knowledge_space_read'],
  resource_version: 1,
  state: 'active',
  technical_status: 'available',
  technical_summary: {
    description: null,
    document_count: 0,
    icon: null,
    knowledge_space_id: id,
    name,
    revision: 1,
    slug: id,
  },
  updated_at: '2026-07-18T00:00:00Z',
  visibility: 'only_me',
  ...overrides,
})

beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
afterEach(() => vi.unstubAllGlobals())
async function setup(ids: string[]) {
  let datasets = ids.map((id) =>
    space(id, id, { permission_keys: ['knowledge_space_read', 'knowledge_space_delete'] }),
  )
  api.list.mockReset().mockImplementation(async () => ({
    data: datasets,
    page: 1,
    total: datasets.length,
    limit: 30,
    has_more: false,
  }))
  api.remove.mockReset().mockImplementation(async ({ params }) => {
    datasets = datasets.filter((item) => item.control_space_id !== params.control_space_id)
    return { result: 'success' }
  })
  const { queryClient } = createConsoleQueryWrapper({ systemFeatures: { rbac_enabled: true } })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <NewKnowledgeList view="agent" onViewChange={vi.fn()} />
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  const open = async (id: string) => {
    const link = screen.getByRole('link', { name: id, exact: true })
    await link.hover()
    const card = link.element().closest('li')!
    await userEvent.click(card.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!)
    await screen.getByRole('menuitem', { name: 'common.operation.delete', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
    await screen.getByRole('textbox').fill(id)
  }
  return { screen, open }
}
describe('Knowledge space deletion', () => {
  it('removes the confirmed item and restores focus before the list refresh completes', async () => {
    const { screen, open } = await setup(['Alpha', 'Beta'])
    await open('Alpha')
    const list = api.list.getMockImplementation()!
    const refresh = createDeferred<Awaited<ReturnType<typeof list>>>()
    api.list.mockReturnValueOnce(refresh.promise)
    await screen.getByRole('button', { name: 'common.operation.confirm' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: 'Alpha', exact: true }))
      .not.toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: 'Beta', exact: true })).toHaveFocus()
    refresh.resolve(await list({ query: { page: 1, limit: 30 } }))
  })

  it.each([
    { ids: ['Alpha', 'Beta', 'Gamma'], remove: 'Beta', next: 'Gamma' },
    { ids: ['Alpha', 'Beta'], remove: 'Beta', next: 'Alpha' },
    { ids: ['Alpha'], remove: 'Alpha', next: null },
  ])('restores focus after deleting $remove from $ids', async ({ ids, remove, next }) => {
    const { screen, open } = await setup(ids)
    await open(remove)
    await screen.getByRole('button', { name: 'common.operation.confirm' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: remove, exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(
        next ? screen.getByRole('link', { name: next, exact: true }) : screen.getByRole('region'),
      )
      .toHaveFocus()
  })
  it('retains focus while pending and leaves a failed deletion retryable', async () => {
    const { screen, open } = await setup(['Alpha'])
    const request = createDeferred<{ result: 'success' }>()
    api.remove.mockReturnValueOnce(request.promise)
    await open('Alpha')
    const confirm = screen.getByRole('button', { name: 'common.operation.confirm' })
    await confirm.click()
    await expect.element(confirm).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.cancel' }))
      .toBeDisabled()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    request.reject(new Error('Failed'))
    await expect.element(screen.getByRole('alert')).toBeVisible()
    await confirm.click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('region')).toHaveFocus()
  })
  it('returns focus to the menu button on cancellation', async () => {
    const { screen, open } = await setup(['Alpha'])
    await open('Alpha')
    await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.more' }))
      .toHaveFocus()
    expect(api.remove).not.toHaveBeenCalled()
  })
})
