import type { consoleClient } from '@/service/console'
import { useInfiniteQuery } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import Datasets from '../datasets'

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.datasets.get>(),
  remove: vi.fn<typeof consoleClient.datasets.byDatasetId.delete>(),
  usage: vi.fn<typeof consoleClient.datasets.byDatasetId.useCheck.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.get': api.list,
      'datasets.byDatasetId.delete': api.remove,
      'datasets.byDatasetId.useCheck.get': api.usage,
      'tags.get': async () => [],
    }),
  }
})
function Catalog() {
  const query = useInfiniteQuery(
    consoleQuery.datasets.get.infiniteOptions({
      input: (page) => ({ query: { page, limit: 30 } }),
      initialPageParam: 1,
      getNextPageParam: () => undefined,
    }),
  )
  return (
    <Datasets
      datasetList={query.data}
      fetchNextPage={query.fetchNextPage}
      hasNextPage={query.hasNextPage}
      isFetching={query.isFetching}
      isFetchingNextPage={query.isFetchingNextPage}
      isLoading={query.isLoading}
      isPlaceholderData={query.isPlaceholderData}
    />
  )
}
beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
afterEach(() => vi.unstubAllGlobals())
async function setup(ids: string[]) {
  let datasets = ids.map((id) =>
    createDatasetFixture({
      id,
      name: id,
      permission_keys: [DatasetACLPermission.Delete],
      runtime_mode: 'general',
    }),
  )
  api.list.mockReset().mockImplementation(async () => ({
    data: datasets,
    page: 1,
    total: datasets.length,
    limit: 30,
    has_more: false,
  }))
  api.remove.mockReset().mockImplementation(async ({ params }) => {
    datasets = datasets.filter((item) => item.id !== params.dataset_id)
  })
  api.usage.mockReset().mockResolvedValue({ is_using: false })
  const { queryClient } = createConsoleQueryWrapper({ systemFeatures: { rbac_enabled: true } })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <Catalog />
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
  }
  return { screen, open }
}
describe('Classic dataset deletion', () => {
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

  it('reports a failed usage check without changing the confirmation action', async () => {
    const { screen, open } = await setup(['Alpha'])
    api.usage.mockRejectedValueOnce(new Error('Usage check failed'))
    await open('Alpha')
    await expect.element(screen.getByRole('alert')).toBeVisible()
    expect(api.remove).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: 'common.operation.retry' }).click()
    await screen.getByRole('button', { name: 'common.operation.confirm' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    expect(api.remove).toHaveBeenCalledTimes(1)
  })

  it('ignores an earlier usage check that completes after another deletion opens', async () => {
    const { screen, open } = await setup(['Alpha', 'Beta'])
    const earlier = createDeferred<{ is_using: boolean }>()
    api.usage.mockReturnValueOnce(earlier.promise)
    await open('Alpha')
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.confirm' }))
      .toBeEnabled()
    await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await open('Beta')
    earlier.resolve({ is_using: true })
    await earlier.promise
    await screen.getByRole('button', { name: 'common.operation.confirm' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    expect(api.remove).toHaveBeenCalledWith(
      expect.objectContaining({ params: { dataset_id: 'Beta' } }),
    )
    await expect.element(screen.getByRole('link', { name: 'Alpha', exact: true })).toBeVisible()
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
    const request = createDeferred<void>()
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
  it('rechecks usage after cancellation and returns focus to the surviving menu button', async () => {
    const { screen, open } = await setup(['Alpha'])
    await open('Alpha')
    await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.more' }))
      .toHaveFocus()
    api.usage.mockResolvedValueOnce({ is_using: true })
    await open('Alpha')
    await expect
      .element(screen.getByText('dataset.datasetUsedByApp', { exact: true }))
      .toBeVisible()
    expect(api.usage).toHaveBeenCalledTimes(2)
    expect(api.remove).not.toHaveBeenCalled()
  })
})
