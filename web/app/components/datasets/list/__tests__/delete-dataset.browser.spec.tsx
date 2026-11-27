import { useInfiniteQuery } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { apiError, hold, installFakeApi } from '@/test/fake-api'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createTestNavigation } from '@/test/next-navigation'
import { DatasetACLPermission } from '@/utils/permission'
import Datasets from '../datasets'

// Dataset routes take UUID path parameters; names stay readable for the accessible queries.
const datasetId = (name: string) =>
  `00000000-0000-4000-8000-${String(['Alpha', 'Beta', 'Gamma'].indexOf(name) + 1).padStart(12, '0')}`
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
      id: datasetId(id),
      name: id,
      permission_keys: [DatasetACLPermission.Delete],
      runtime_mode: 'general',
    }),
  )
  const fake = installFakeApi({
    console: {
      datasets: {
        get: async () => ({
          data: datasets,
          page: 1,
          total: datasets.length,
          limit: 30,
          has_more: false,
        }),
        byDatasetId: {
          delete: async ({ params }) => {
            datasets = datasets.filter((item) => item.id !== params.dataset_id)
          },
          useCheck: { get: () => ({ is_using: false }) },
        },
      },
      tags: { get: () => [] },
    },
  })
  onTestFinished(fake)
  const { queryClient } = createConsoleQueryWrapper({ systemFeatures: { rbac_enabled: true } })
  const { NavigationProvider } = createTestNavigation({ url: '/datasets' })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <Catalog />
    </QueryClientTestProvider>,
    { wrapper: NavigationProvider },
  )
  const open = async (id: string) => {
    const link = screen.getByRole('link', { name: id, exact: true })
    await link.hover()
    const card = link.element().closest('li')!
    await userEvent.click(card.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!)
    await screen.getByRole('menuitem', { name: 'common.operation.delete', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    // The modal hides the menu from the accessibility tree before its exit animation unmounts it.
    await expect.element(screen.getByRole('menu', { includeHidden: true })).not.toBeInTheDocument()
  }
  return { screen, open, fake }
}
describe('Classic dataset deletion', () => {
  it('removes the confirmed item and restores focus before the list refresh completes', async () => {
    const { screen, open, fake } = await setup(['Alpha', 'Beta'])
    await open('Alpha')
    const refresh = hold(fake.console.datasets.get)
    await screen.getByRole('button', { name: 'common.operation.confirm' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: 'Alpha', exact: true }))
      .not.toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: 'Beta', exact: true })).toHaveFocus()
    refresh.release()
  })

  it('reports a failed usage check without changing the confirmation action', async () => {
    const { screen, open, fake } = await setup(['Alpha'])
    fake.console.datasets.byDatasetId.useCheck.get.mockRejectedValueOnce(
      apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Usage check failed' }),
    )
    await open('Alpha')
    // An uncataloged code shows the dialog's translated fallback, not the server's English text.
    await expect.element(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(fake.console.datasets.byDatasetId.delete).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: 'common.operation.retry' }).click()
    await screen.getByRole('button', { name: 'common.operation.confirm' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    expect(fake.console.datasets.byDatasetId.delete).toHaveBeenCalledTimes(1)
  })

  it('ignores an earlier usage check that completes after another deletion opens', async () => {
    const { screen, open, fake } = await setup(['Alpha', 'Beta'])
    const earlier = createDeferred<{ is_using: boolean }>()
    fake.console.datasets.byDatasetId.useCheck.get.mockReturnValueOnce(earlier.promise)
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
    expect(fake.console.datasets.byDatasetId.delete).toHaveBeenCalledWith({
      params: { dataset_id: datasetId('Beta') },
    })
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
    const { screen, open, fake } = await setup(['Alpha'])
    const request = hold(fake.console.datasets.byDatasetId.delete)
    await open('Alpha')
    const confirm = screen.getByRole('button', { name: 'common.operation.confirm' })
    await confirm.click()
    await expect.element(confirm).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.cancel' }))
      .toBeDisabled()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    request.reject(apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Failed' }))
    await expect.element(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
    await confirm.click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('region')).toHaveFocus()
  })
  it('rechecks usage after cancellation and returns focus to the surviving menu button', async () => {
    const { screen, open, fake } = await setup(['Alpha'])
    await open('Alpha')
    await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.more' }))
      .toHaveFocus()
    fake.console.datasets.byDatasetId.useCheck.get.mockResolvedValueOnce({ is_using: true })
    await open('Alpha')
    await expect
      .element(screen.getByText('dataset.datasetUsedByApp', { exact: true }))
      .toBeVisible()
    expect(fake.console.datasets.byDatasetId.useCheck.get).toHaveBeenCalledTimes(2)
    expect(fake.console.datasets.byDatasetId.delete).not.toHaveBeenCalled()
  })
})
