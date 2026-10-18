import type { DocumentWithSegmentsListResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { consoleClient } from '@/service/console'
import { zDocumentWithSegmentsListResponse } from '@dify/contracts/api/console/datasets/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import DatasetDetailContext from '@/context/dataset-detail'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import Documents from '../index'

const api = vi.hoisted(() => ({
  push: vi.fn(),
  documents: vi.fn<typeof consoleClient.datasets.byDatasetId.documents.get>(),
  rename: vi.fn<typeof consoleClient.datasets.byDatasetId.documents.byDocumentId.rename.post>(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push }),
  usePathname: () => '/datasets/dataset-1/documents',
  useParams: () => ({ datasetId: 'dataset-1' }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.get': api.documents,
      'datasets.byDatasetId.metadata.get': async () => ({
        doc_metadata: [],
        built_in_field_enabled: false,
      }),
      'datasets.metadata.builtIn.get': async () => ({ fields: [] }),
      'datasets.byDatasetId.autoDisableLogs.get': async () => ({ document_ids: [] }),
      'datasets.byDatasetId.errorDocs.get': async () => ({ data: [], total: 0 }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.byDatasetId.documents.byDocumentId.rename.post': api.rename,
    }),
  }
})

const dataset = () =>
  createDatasetFixture({ permission_keys: ['dataset.acl.use', 'dataset.acl.edit'] })
const documentList = (overrides: Partial<DocumentWithSegmentsListResponse> = {}) =>
  zDocumentWithSegmentsListResponse.parse({
    data: ['Guide', 'Reference'].map((name, index) => ({
      id: `doc-${index}`,
      name,
      position: index + 1,
      data_source_type: 'upload_file',
      indexing_status: 'completed',
      enabled: true,
      archived: false,
      display_status: 'available',
      created_at: 1700000000,
      doc_form: 'text_model',
      data_source_detail_dict: {
        upload_file: {
          id: `file-${index}`,
          name: `${name}.pdf`,
          extension: 'pdf',
          mime_type: 'application/pdf',
          size: 1024,
          created_at: 1700000000,
          created_by: 'user-1',
        },
      },
    })),
    total: 2,
    page: 1,
    limit: 10,
    has_more: false,
    ...overrides,
  })
async function setup({
  searchParams = '',
  currentDataset = dataset(),
  cached,
  waitForList = true,
}: {
  searchParams?: string
  currentDataset?: ReturnType<typeof dataset>
  cached?: ReturnType<typeof documentList>
  waitForList?: boolean
} = {}) {
  const queryClient = createConsoleQueryClient()
  if (cached)
    queryClient.setQueryData(
      consoleQuery.datasets.byDatasetId.documents.get.queryKey({
        input: {
          params: { dataset_id: 'dataset-1' },
          query: { page: 1, limit: 10, keyword: '', sort: '-created_at' },
        },
      }),
      cached,
    )
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  await act(async () =>
    renderWithConsoleQuery(
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
        {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component. */}
        <DatasetDetailContext.Provider value={{ dataset: currentDataset }}>
          <Documents datasetId="dataset-1" />
        </DatasetDetailContext.Provider>
      </NuqsTestingAdapter>,
      { queryClient, accountProfile: { id: 'user-1' }, workspacePermissionKeys: [], features: {} },
    ),
  )
  if (waitForList)
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
  return { user: userEvent.setup(), queryClient, onUrlUpdate }
}
const filter = () =>
  screen.getByRole('combobox', { name: 'datasetDocuments.list.table.header.status' })
const search = () => screen.getByRole('searchbox')
const lastURL = (onUrlUpdate: Awaited<ReturnType<typeof setup>>['onUrlUpdate']) =>
  onUrlUpdate.mock.lastCall?.[0].searchParams

beforeEach(() => {
  api.documents.mockReset().mockResolvedValue(documentList())
  api.rename
    .mockReset()
    .mockImplementation(async ({ body }) => ({ ...documentList().data[1]!, name: body.name }))
  api.push.mockReset()
})
afterEach(() => vi.useRealTimers())

it('replaces initial loading with the real document rows', async () => {
  const request = createDeferred<ReturnType<typeof documentList>>()
  api.documents.mockReturnValue(request.promise)
  await setup({ waitForList: false })
  expect(screen.getByRole('progressbar')).toBeInTheDocument()
  expect(screen.queryByText('Guide')).not.toBeInTheDocument()
  await act(async () => request.resolve(documentList()))
  expect(await screen.findByText('Guide')).toBeInTheDocument()
  expect(screen.getByText('Reference')).toBeInTheDocument()
})

it('keeps cached rows visible until a background refresh returns the changed documents', async () => {
  const request = createDeferred<ReturnType<typeof documentList>>()
  const { queryClient } = await setup()
  api.documents.mockReturnValueOnce(request.promise)
  act(() => {
    void queryClient.invalidateQueries({
      queryKey: consoleQuery.datasets.byDatasetId.documents.get.key(),
    })
  })
  expect(screen.getByText('Guide')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  await act(async () => request.resolve(documentList({ data: [documentList().data[1]!] })))
  await waitFor(() => expect(screen.queryByText('Guide')).not.toBeInTheDocument())
  expect(screen.getByText('Reference')).toBeInTheDocument()
})

it.each([
  ['upload_file', 'general', 'addFile', 'create'],
  ['notion_import', 'general', 'addPages', 'create'],
  ['website_crawl', 'general', 'addUrl', 'create'],
  ['upload_file', 'rag_pipeline', 'addFile', 'create-from-pipeline'],
] as const)(
  'opens the matching import flow for %s in %s mode',
  async (data_source_type, runtime_mode, action, route) => {
    const { user } = await setup({
      currentDataset: createDatasetFixture({ ...dataset(), data_source_type, runtime_mode }),
    })
    await user.click(screen.getByRole('button', { name: `datasetDocuments.list.${action}` }))
    expect(api.push).toHaveBeenCalledExactlyOnceWith(`/datasets/dataset-1/documents/${route}`)
  },
)

it.each(['upload_file', 'notion_import'] as const)(
  'shows the appropriate empty state for %s',
  async (data_source_type) => {
    api.documents.mockResolvedValue(documentList({ data: [], total: 0 }))
    const { user } = await setup({
      currentDataset: createDatasetFixture({ ...dataset(), data_source_type }),
    })
    expect(
      screen.getByText(
        `datasetDocuments.list.empty.${data_source_type === 'upload_file' ? 'upload' : 'sync'}.tip`,
      ),
    ).toBeInTheDocument()
    if (data_source_type === 'upload_file') {
      await user.click(
        screen.getAllByRole('button', { name: 'datasetDocuments.list.addFile' }).at(-1)!,
      )
      expect(api.push).toHaveBeenCalledWith('/datasets/dataset-1/documents/create')
    }
  },
)

it.each(['permission', 'embedding'] as const)(
  'withholds document creation and metadata editing when %s is unavailable',
  async (reason) => {
    api.documents.mockResolvedValue(documentList({ data: [], total: 0 }))
    await setup({
      currentDataset: createDatasetFixture({
        ...dataset(),
        ...(reason === 'permission' ? { permission_keys: [] } : { embedding_available: false }),
      }),
    })
    expect(
      screen.queryByRole('button', { name: 'datasetDocuments.list.addFile' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.metadata.metadata' }),
    ).not.toBeInTheDocument()
    if (reason === 'embedding')
      expect(screen.getByText('dataset.embeddingModelNotAvailable')).toBeInTheDocument()
  },
)

it('restores bookmarked search, pagination, sorting and a legacy status filter in the service request', async () => {
  await setup({ searchParams: '?page=3&limit=25&keyword=initial&status=enabled&sort=hit_count' })
  expect(search()).toHaveValue('initial')
  expect(api.documents).toHaveBeenCalledWith({
    params: { dataset_id: 'dataset-1' },
    query: {
      page: 3,
      limit: 25,
      keyword: 'initial',
      status: 'available',
      sort: 'hit_count',
    },
  })
})

it('clears document selection and resets the bookmarked page when the search changes', async () => {
  const { user, onUrlUpdate } = await setup({ searchParams: '?page=3&keyword=initial' })
  await user.click(screen.getByRole('checkbox', { name: 'Guide' }))
  expect(screen.getByRole('button', { name: 'dataset.batchAction.cancel' })).toBeInTheDocument()
  await user.clear(search())
  await user.type(search(), 'Reference')
  await waitFor(() => expect(lastURL(onUrlUpdate)?.get('keyword')).toBe('Reference'))
  expect(lastURL(onUrlUpdate)?.get('page')).toBeNull()
  expect(screen.getByRole('checkbox', { name: 'Guide' })).not.toBeChecked()
  expect(
    screen.queryByRole('button', { name: 'dataset.batchAction.cancel' }),
  ).not.toBeInTheDocument()
  await waitFor(() =>
    expect(api.documents).toHaveBeenLastCalledWith({
      params: { dataset_id: 'dataset-1' },
      query: expect.objectContaining({ page: 1, keyword: 'Reference' }),
    }),
  )
})

it('selects document rows and clears selection when the status filter changes', async () => {
  const { user, onUrlUpdate } = await setup({ searchParams: '?page=3&status=error' })
  await user.click(screen.getByRole('checkbox', { name: 'common.operation.selectAll' }))
  expect(screen.getByRole('checkbox', { name: 'Guide' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Reference' })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'dataset.batchAction.cancel' }))
  expect(screen.getByRole('checkbox', { name: 'Guide' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Reference' })).not.toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: 'common.operation.selectAll' }))
  await user.click(filter())
  await user.click(
    await screen.findByRole('option', { name: 'datasetDocuments.list.status.available' }),
  )
  await waitFor(() => expect(lastURL(onUrlUpdate)?.get('status')).toBe('available'))
  expect(lastURL(onUrlUpdate)?.get('page')).toBeNull()
  expect(screen.getByRole('checkbox', { name: 'Guide' })).not.toBeChecked()
  expect(filter()).toHaveTextContent('datasetDocuments.list.status.available')
  await user.click(filter())
  await user.click(await screen.findByRole('option', { name: 'datasetDocuments.list.index.all' }))
  await waitFor(() => expect(lastURL(onUrlUpdate)?.get('status')).toBeNull())
})

it('requests the next page and resets the page when changing the page size or sort', async () => {
  api.documents.mockResolvedValue(documentList({ total: 100, has_more: true }))
  const { user, onUrlUpdate } = await setup()
  await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
  await waitFor(() => expect(lastURL(onUrlUpdate)?.get('page')).toBe('2'))
  await user.click(
    within(screen.getByRole('radiogroup', { name: 'common.pagination.perPage' })).getByRole(
      'radio',
      { name: '25' },
    ),
  )
  await waitFor(() => expect(lastURL(onUrlUpdate)?.get('limit')).toBe('25'))
  expect(lastURL(onUrlUpdate)?.get('page')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
  await user.click(
    screen.getByRole('button', { name: 'datasetDocuments.list.table.header.hitCount' }),
  )
  await waitFor(() => expect(lastURL(onUrlUpdate)?.get('sort')).toBe('-hit_count'))
  expect(lastURL(onUrlUpdate)?.get('page')).toBeNull()
  expect(
    screen.getByRole('columnheader', { name: 'datasetDocuments.list.table.header.hitCount' }),
  ).toHaveAttribute('aria-sort', 'descending')
  await user.click(
    screen.getByRole('button', { name: 'datasetDocuments.list.table.header.hitCount' }),
  )
  await waitFor(() => expect(lastURL(onUrlUpdate)?.get('sort')).toBe('hit_count'))
  expect(
    screen.getByRole('columnheader', { name: 'datasetDocuments.list.table.header.hitCount' }),
  ).toHaveAttribute('aria-sort', 'ascending')
  expect(api.documents).toHaveBeenLastCalledWith({
    params: { dataset_id: 'dataset-1' },
    query: expect.objectContaining({ page: 1, limit: 25, sort: 'hit_count' }),
  })
})

it('renames the selected document through its real form and refreshes the row after success', async () => {
  const { user } = await setup()
  const row = screen.getByRole('row', { name: /Reference/ })
  await user.click(within(row).getByRole('button', { name: 'datasetDocuments.list.table.rename' }))
  const dialog = await screen.findByRole('dialog', { name: 'datasetDocuments.list.table.rename' })
  const input = within(dialog).getByRole('textbox', { name: 'datasetDocuments.list.table.name' })
  expect(input).toHaveValue('Reference')
  await user.clear(input)
  await user.type(input, 'API Reference')
  api.documents.mockResolvedValue(
    documentList({
      data: documentList().data.map((doc) =>
        doc.id === 'doc-1' ? { ...doc, name: 'API Reference' } : doc,
      ),
    }),
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  expect(api.rename).toHaveBeenCalledWith({
    params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
    body: { name: 'API Reference' },
  })
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(await screen.findByText('API Reference')).toBeInTheDocument()
})

it('polls processing documents until all documents reach a terminal state', async () => {
  vi.useFakeTimers()
  const pending = documentList({
    data: documentList().data.map((doc) => ({
      ...doc,
      indexing_status: 'indexing',
      display_status: 'indexing',
    })),
  })
  api.documents.mockResolvedValue(documentList())
  await setup({ cached: pending, waitForList: false })
  expect(api.documents).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(2500))
  expect(api.documents).toHaveBeenCalledOnce()
  await act(async () => vi.advanceTimersByTimeAsync(10000))
  expect(api.documents).toHaveBeenCalledOnce()
  expect(screen.getByText('Guide')).toBeInTheDocument()
})

it('continues polling an empty indexing filter so newly queued documents can appear', async () => {
  vi.useFakeTimers()
  api.documents.mockResolvedValue(documentList({ data: [], total: 0 }))
  await setup({ searchParams: '?status=indexing', waitForList: false })
  await act(async () => vi.advanceTimersByTimeAsync(5000))
  expect(api.documents).toHaveBeenCalledTimes(3)
  expect(api.documents).toHaveBeenLastCalledWith({
    params: { dataset_id: 'dataset-1' },
    query: expect.objectContaining({ status: 'indexing' }),
  })
})

it('opens real metadata management and returns to the document list', async () => {
  const { user } = await setup()
  await user.click(screen.getByRole('button', { name: 'dataset.metadata.metadata' }))
  const dialog = await screen.findByRole('dialog', { name: 'dataset.metadata.metadata' })
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(screen.getByText('Guide')).toBeInTheDocument()
})
