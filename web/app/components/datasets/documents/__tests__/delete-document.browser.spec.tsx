import type { consoleClient } from '@/service/console'
import { zDocumentWithSegmentsListResponse } from '@dify/contracts/api/console/datasets/zod.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import DatasetDetailContext from '@/context/dataset-detail'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import Documents from '../index'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/datasets/dataset-1/documents',
  useParams: () => ({ datasetId: 'dataset-1' }),
  useSearchParams: () => new URLSearchParams(),
}))

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.datasets.byDatasetId.documents.get>(),
  remove: vi.fn<typeof consoleClient.datasets.byDatasetId.documents.delete>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.get': api.list,
      'datasets.byDatasetId.documents.delete': api.remove,
      'datasets.byDatasetId.metadata.get': async () => ({
        doc_metadata: [],
        built_in_field_enabled: false,
      }),
      'datasets.metadata.builtIn.get': async () => ({ fields: [] }),
      'datasets.byDatasetId.autoDisableLogs.get': async () => ({ document_ids: [] }),
      'datasets.byDatasetId.errorDocs.get': async () => ({ data: [], total: 0 }),
      'tags.get': async () => [],
    }),
  }
})
beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
afterEach(() => vi.unstubAllGlobals())
async function setup(ids: string[]) {
  let datasets = zDocumentWithSegmentsListResponse.parse({
    data: ids.map((id, index) => ({
      id,
      name: id,
      position: index + 1,
      data_source_type: 'upload_file',
      indexing_status: 'completed',
      enabled: true,
      archived: false,
      display_status: 'available',
      created_at: 1700000000,
      doc_form: 'text_model',
      data_source_detail_dict: {},
    })),
    total: ids.length,
    page: 1,
    limit: 10,
    has_more: false,
  }).data
  api.list.mockReset().mockImplementation(async () => ({
    data: datasets,
    page: 1,
    total: datasets.length,
    limit: 30,
    has_more: false,
  }))
  api.remove.mockReset().mockImplementation(async ({ query }) => {
    datasets = datasets.filter((item) => !query?.document_id?.includes(item.id))
    return { result: 'success' }
  })
  const { queryClient } = createConsoleQueryWrapper({ systemFeatures: { rbac_enabled: true } })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter hasMemory>
        {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component. */}
        <DatasetDetailContext.Provider
          value={{
            dataset: createDatasetFixture({
              embedding_available: true,
              permission_keys: [DatasetACLPermission.Use, DatasetACLPermission.DeleteFile],
            }),
          }}
        >
          <div className="h-screen">
            <Documents datasetId="dataset-1" />
          </div>
        </DatasetDetailContext.Provider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  const open = async (id: string) => {
    const link = screen.getByRole('link', { name: id, exact: true })
    await link.hover()
    const card = link.element().closest('tr')!
    await userEvent.click(card.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!)
    await screen
      .getByRole('menuitem', { name: 'datasetDocuments.list.action.delete', exact: true })
      .click()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  }
  return { screen, open }
}
describe('Classic document deletion', () => {
  it('removes the item before a slow list refresh completes', async () => {
    const { screen, open } = await setup(['Alpha', 'Beta'])
    await open('Alpha')
    const list = api.list.getMockImplementation()!
    const refresh = createDeferred<Awaited<ReturnType<typeof list>>>()
    api.list.mockReturnValueOnce(refresh.promise)
    await screen.getByRole('button', { name: 'common.operation.sure' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: 'Alpha', exact: true }))
      .not.toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: 'Beta', exact: true })).toHaveFocus()
    refresh.resolve(await list({ params: { dataset_id: 'dataset-1' } }))
  })

  it.each([
    { ids: ['Alpha', 'Beta', 'Gamma'], remove: 'Beta', next: 'Gamma' },
    { ids: ['Alpha', 'Beta'], remove: 'Beta', next: 'Alpha' },
    { ids: ['Alpha'], remove: 'Alpha', next: null },
  ])('restores focus after deleting $remove from $ids', async ({ ids, remove, next }) => {
    const { screen, open } = await setup(ids)
    await open(remove)
    await screen.getByRole('button', { name: 'common.operation.sure' }).click()
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
    const request = createDeferred<{ result: string }>()
    api.remove.mockReturnValueOnce(request.promise)
    await open('Alpha')
    const confirm = screen.getByRole('button', { name: 'common.operation.sure' })
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
})
