import type {
  DatasetQueryDetailResponse,
  HitTestingResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactElement } from 'react'
import type { consoleClient } from '@/service/console'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DatasetDetailContext from '@/context/dataset-detail'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createHitTestingRecordFixture } from '@/test/fixtures/hit-testing'
import { RETRIEVE_METHOD } from '@/types/app'
import HitTestingPage from '../index'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({ 'datasetHitTesting.hit.title': '{{num}} Retrieved Chunks' })
})
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => '/datasets/dataset-1/hit-testing',
  useSearchParams: () => new URLSearchParams(),
}))
const { getRecords, mockHitTestingMutateAsync, mockExternalHitTestingMutateAsync } = vi.hoisted(
  () => ({
    getRecords: vi.fn<typeof consoleClient.datasets.byDatasetId.queries.get>(),
    mockHitTestingMutateAsync: vi.fn<typeof consoleClient.datasets.byDatasetId.hitTesting.post>(),
    mockExternalHitTestingMutateAsync:
      vi.fn<typeof consoleClient.datasets.byDatasetId.externalHitTesting.post>(),
  }),
)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.queries.get': getRecords,
      'files.upload.get': async () => createFileUploadConfigFixture(),
      'datasets.retrievalSetting.get': async () => ({
        retrieval_method: [
          RETRIEVE_METHOD.semantic,
          RETRIEVE_METHOD.fullText,
          RETRIEVE_METHOD.hybrid,
        ],
      }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.byDatasetId.hitTesting.post': mockHitTestingMutateAsync,
      'datasets.byDatasetId.externalHitTesting.post': mockExternalHitTestingMutateAsync,
    }),
  }
})

const createDataset = () =>
  createDatasetFixture({
    id: 'dataset-1',
    name: 'Test Dataset',
    provider: 'vendor',
    indexing_technique: 'high_quality' as const,
    retrieval_model_dict: {
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: false,
      reranking_mode: undefined,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      weights: undefined,
      top_k: 10,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    },
    is_multimodal: false,
    permission_keys: ['dataset.acl.retrieval_recall'],
  })

let mockDataset = createDataset()
let recordsData: Awaited<ReturnType<typeof getRecords>> | undefined
function renderWithProviders(ui: ReactElement) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  if (recordsData)
    queryClient.setQueryData(
      consoleQuery.datasets.byDatasetId.queries.get.queryKey({
        input: { params: { dataset_id: 'dataset-1' }, query: { limit: 10, page: 1 } },
      }),
      recordsData,
    )
  return renderWithConsoleQuery(
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component.
    <DatasetDetailContext.Provider value={{ dataset: mockDataset }}>
      {ui}
    </DatasetDetailContext.Provider>,
    { queryClient, accountProfile: { id: 'user-1' }, workspacePermissionKeys: [], features: {} },
  )
}
const createMockHitTesting = () =>
  createHitTestingRecordFixture({
    segment: {
      content: 'Test segment content',
      document: { id: 'doc-1', name: 'test-document.pdf' },
    },
  })

const createMockRecord = (
  overrides: Partial<DatasetQueryDetailResponse> = {},
): DatasetQueryDetailResponse => ({
  id: 'record-1',
  source: 'hit_testing',
  source_app_id: 'app-1',
  created_by_role: 'account',
  created_by: 'user-1',
  created_at: 1609459200,
  queries: [{ content: 'Test query', content_type: 'text_query', file_info: null }],
  ...overrides,
})

describe('HitTestingPage', () => {
  beforeEach(() => {
    mockDataset = createDataset()
    recordsData = { data: [], total: 0, page: 1, limit: 10, has_more: false }
    getRecords.mockReset().mockImplementation(async () => recordsData!)
    mockHitTestingMutateAsync.mockReset()
    mockExternalHitTestingMutateAsync.mockReset()
    vi.stubGlobal('innerWidth', 1024)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('disables record loading and query input without retrieval recall permission', async () => {
    mockDataset.permission_keys = []

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(getRecords).not.toHaveBeenCalled()
  })

  it('shows the records loading state', async () => {
    recordsData = undefined
    getRecords.mockReturnValue(new Promise(() => {}))

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('shows both empty history and empty result states', () => {
    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    expect(screen.getByText(/noRecentTip/)).toBeInTheDocument()
    expect(screen.getByText(/hit.emptyTip/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByRole('heading', { name: /records/, level: 2 })).toBeInTheDocument()
  })

  it.each(['vendor', 'external'])(
    'announces loading and failure in the same status region for %s retrieval',
    async (provider) => {
      mockDataset.provider = provider
      const response = createDeferred<never>()
      const request =
        provider === 'external' ? mockExternalHitTestingMutateAsync : mockHitTestingMutateAsync
      request.mockReturnValue(response.promise)
      renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
      const user = userEvent.setup()
      const status = screen.getByRole('status')
      await user.type(screen.getByRole('textbox'), 'Test query')
      await user.click(screen.getByRole('button', { name: /input.testing/ }))
      await waitFor(() => expect(status).toHaveTextContent('common.loading'))
      await act(async () => response.reject(new Error('Retrieval failed')))
      await waitFor(() => expect(status).toHaveTextContent('common.api.actionFailed'))
      expect(screen.getByRole('status')).toBe(status)
      expect(status).not.toHaveTextContent('common.loading')
    },
  )

  it('removes stale mobile result counts while pending or failed and restores the latest successful count', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('innerWidth', 390)
    const response: HitTestingResponse = {
      query: { content: 'Test query' },
      records: [createMockHitTesting()],
    }
    mockHitTestingMutateAsync.mockResolvedValueOnce(response)
    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
    await user.type(screen.getByRole('textbox'), 'Test query')
    await user.click(screen.getByRole('button', { name: /input.testing/ }))
    expect(await screen.findByRole('dialog', { name: '1 Retrieved Chunks' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /operation.close/ }))
    const nextResponse = createDeferred<HitTestingResponse>()
    mockHitTestingMutateAsync.mockReturnValueOnce(nextResponse.promise)
    await user.click(screen.getByRole('button', { name: /input.testing/ }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('common.loading'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('1 Retrieved Chunks')).not.toBeInTheDocument()
    await act(async () => nextResponse.reject(new Error('Retrieval failed')))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('common.api.actionFailed'),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    mockHitTestingMutateAsync.mockResolvedValueOnce({ ...response, records: [] })
    await user.click(screen.getByRole('button', { name: /input.testing/ }))
    expect(await screen.findByRole('dialog', { name: '0 Retrieved Chunks' })).toBeInTheDocument()
  })

  it('announces zero retrieved chunks after an empty response', async () => {
    const user = userEvent.setup()
    const response: HitTestingResponse = {
      query: { content: 'No match' },
      records: [],
    }
    mockHitTestingMutateAsync.mockResolvedValue(response)
    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
    const status = screen.getByRole('status')
    await user.type(screen.getByRole('textbox'), 'No match')
    await user.click(screen.getByRole('button', { name: /input.testing/ }))

    await waitFor(() => expect(status).toHaveTextContent('0 Retrieved Chunks'))
  })

  it('loads a history record into the query input when selected', async () => {
    const user = userEvent.setup()
    recordsData = {
      data: [
        createMockRecord({
          queries: [{ content: 'Record query text', content_type: 'text_query', file_info: null }],
        }),
      ],
      total: 1,
      page: 1,
      limit: 10,
      has_more: false,
    }

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
    await user.click(await screen.findByText('Record query text'))

    expect(screen.getByRole('textbox')).toHaveValue('Record query text')
  })

  it('requests the next records page through pagination', async () => {
    const user = userEvent.setup()
    recordsData = {
      data: Array.from({ length: 10 }, (_, index) => createMockRecord({ id: `record-${index}` })),
      total: 25,
      page: 1,
      limit: 10,
      has_more: true,
    }

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
    await user.click(screen.getByRole('button', { name: /pagination.next/ }))

    await waitFor(() =>
      expect(getRecords).toHaveBeenCalledWith({
        params: { dataset_id: 'dataset-1' },
        query: { limit: 10, page: 2 },
      }),
    )
  })

  it('saves retrieval settings, submits a query, refreshes history, and renders results', async () => {
    const user = userEvent.setup()
    const response: HitTestingResponse = {
      query: { content: 'Test query' },
      records: [createMockHitTesting()],
    }
    mockHitTestingMutateAsync.mockResolvedValue(response)

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
    await user.click(screen.getByText(/semantic_search/))
    expect(
      await screen.findByRole('dialog', { name: /form.retrievalSetting.title/ }),
    ).toBeInTheDocument()
    await user.click(await screen.findByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }))
    await user.keyboard('{ArrowDown}')
    await user.click(screen.getByRole('button', { name: /operation.save/ }))
    await user.type(screen.getByRole('textbox'), 'Test query')
    await user.click(screen.getByRole('button', { name: /input.testing/ }))

    await waitFor(() => {
      expect(mockHitTestingMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { dataset_id: 'dataset-1' },
          body: expect.objectContaining({
            query: 'Test query',
            attachment_ids: [],
            retrieval_model: expect.objectContaining({
              search_method: RETRIEVE_METHOD.semantic,
              top_k: 9,
            }),
          }),
        }),
      )
    })
    expect(getRecords).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('test-document.pdf')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 Retrieved Chunks')
    expect(
      screen.getByRole('heading', { name: '1 Retrieved Chunks', level: 2 }),
    ).toBeInTheDocument()
  })

  it('submits external retrieval settings and renders external results', async () => {
    const user = userEvent.setup()
    Object.assign(mockDataset, { provider: 'external' })
    const response = {
      query: { content: 'External query' },
      records: [
        {
          title: 'External Result',
          content: 'External content',
          score: 0.9,
          metadata: {},
        },
      ],
    }
    mockExternalHitTestingMutateAsync.mockResolvedValue(response)

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
    await user.click(screen.getByRole('button', { name: /settingTitle/ }))
    await user.click(await screen.findByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }))
    await user.keyboard('{ArrowUp}')
    await user.click(screen.getByRole('button', { name: /operation.save/ }))
    await user.type(screen.getByRole('textbox'), 'External query')
    await user.click(screen.getByRole('button', { name: /input.testing/ }))

    await waitFor(() => {
      expect(mockExternalHitTestingMutateAsync).toHaveBeenCalledWith({
        params: { dataset_id: 'dataset-1' },
        body: {
          query: 'External query',
          external_retrieval_model: {
            top_k: 5,
            score_threshold: 0.5,
            score_threshold_enabled: false,
          },
        },
      })
    })
    expect(mockHitTestingMutateAsync).not.toHaveBeenCalled()
    expect(getRecords).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('External content')).toBeInTheDocument()
  })
})
