import type {
  DatasetQueryDetailResponse,
  HitTestingRecord,
  HitTestingResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import DatasetDetailContext from '@/context/dataset-detail'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { render } from '@/test/console/render'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createHitTestingRecordFixture } from '@/test/fixtures/hit-testing'
import { RETRIEVE_METHOD } from '@/types/app'
import HitTestingPage from '../index'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'datasetHitTesting.hit.title': '{{num}} Retrieved Chunks',
  })
})

// Mock Setup

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}))

const mockDataset = createDatasetFixture({
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

let mockConsoleState = {
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => mockConsoleState)
})
vi.mock('@/features/system-features/state', async () => {
  const { createSystemFeaturesStateModuleMock } = await import('@/test/console/state-fixture')

  return createSystemFeaturesStateModuleMock(() => mockConsoleState)
})

const { getRecords, mockHitTestingMutateAsync, mockExternalHitTestingMutateAsync } = vi.hoisted(
  () => ({
    getRecords: vi.fn(),
    mockHitTestingMutateAsync: vi.fn(),
    mockExternalHitTestingMutateAsync: vi.fn(),
  }),
)
let recordsData:
  | {
      data: DatasetQueryDetailResponse[]
      total: number
      page: number
      limit: number
      has_more: boolean
    }
  | undefined
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.queries.get': getRecords,
      'datasets.retrievalSetting.get': async () => ({
        retrieval_method: [
          RETRIEVE_METHOD.semantic,
          RETRIEVE_METHOD.fullText,
          RETRIEVE_METHOD.hybrid,
        ],
      }),
      'workspaces.current.models.modelTypes.byModelType.get': async () => ({ data: [] }),
    }),
    consoleClient: {
      datasets: {
        byDatasetId: {
          hitTesting: { post: mockHitTestingMutateAsync },
          externalHitTesting: { post: mockExternalHitTestingMutateAsync },
        },
      },
    },
  }
})
// Mock breakpoints hook
vi.mock('@/hooks/use-breakpoints', () => ({
  default: vi.fn(() => 'pc'),
  MediaType: {
    mobile: 'mobile',
    pc: 'pc',
  },
}))

// Mock timestamp hook
vi.mock('@/hooks/use-timestamp', () => ({
  default: vi.fn(() => ({
    formatTime: vi.fn((timestamp: number, _format: string) =>
      new Date(timestamp * 1000).toISOString(),
    ),
  })),
}))

// Mock use-common to avoid QueryClient issues in nested hooks

// The uploader owns image transport; keep the query form and submit controls real.
vi.mock(
  '@/app/components/datasets/common/image-uploader/image-uploader-in-retrieval-testing',
  () => ({
    default: ({ textArea, actionButton }: { textArea: ReactNode; actionButton: ReactNode }) => (
      <>
        {textArea}
        {actionButton}
      </>
    ),
  }),
)

// Mock docLink hook
vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(() => () => 'https://docs.example.com'),
}))

// Mock model list hook - include all exports used by child components
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: vi.fn(() => ({
    modelList: [],
    defaultModel: undefined,
    currentProvider: undefined,
    currentModel: undefined,
  })),
  useModelListAndDefaultModel: vi.fn(() => ({
    modelList: [],
    defaultModel: undefined,
  })),
  useCurrentProviderAndModel: vi.fn(() => ({
    currentProvider: undefined,
    currentModel: undefined,
  })),
  useDefaultModel: vi.fn(() => ({
    defaultModel: undefined,
  })),
}))

// Test Wrapper with QueryClientProvider

const createConsoleQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  })

const TestWrapper = ({ children }: { children: ReactNode }) => {
  const [queryClient] = useState(() => {
    const client = createConsoleQueryClient()
    if (recordsData)
      client.setQueryData(
        consoleQuery.datasets.byDatasetId.queries.get.queryKey({
          input: { params: { dataset_id: 'dataset-1' }, query: { limit: 10, page: 1 } },
        }),
        recordsData,
      )
    return client
  })
  seedAccountProfileQuery(queryClient, mockConsoleState.userProfile)
  return (
    <QueryClientProvider client={queryClient}>
      <DatasetDetailContext.Provider value={{ dataset: mockDataset }}>
        {children}
      </DatasetDetailContext.Provider>
    </QueryClientProvider>
  )
}

const renderWithProviders = (ui: React.ReactElement) => {
  return render(ui, { wrapper: TestWrapper })
}

// Test Factories

const createMockSegment = (overrides = {}) => ({
  id: 'segment-1',
  document: {
    id: 'doc-1',
    data_source_type: 'upload_file',
    name: 'test-document.pdf',
    doc_type: 'book' as const,
  },
  content: 'Test segment content',
  sign_content: 'Test signed content',
  position: 1,
  word_count: 100,
  tokens: 50,
  keywords: ['test', 'keyword'],
  hit_count: 5,
  index_node_hash: 'hash-123',
  answer: '',
  ...overrides,
})

const createMockHitTesting = (overrides = {}): HitTestingRecord => ({
  ...createHitTestingRecordFixture(),
  segment: createMockSegment() as HitTestingRecord['segment'],
  ...overrides,
})

const createMockRecord = (overrides = {}): DatasetQueryDetailResponse => ({
  id: 'record-1',
  source: 'hit_testing',
  source_app_id: 'app-1',
  created_by_role: 'account',
  created_by: 'user-1',
  created_at: 1609459200,
  queries: [{ content: 'Test query', content_type: 'text_query', file_info: null }],
  ...overrides,
})

// HitTestingPage integration tests

describe('HitTestingPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    getRecords.mockReset()
    mockHitTestingMutateAsync.mockReset()
    mockExternalHitTestingMutateAsync.mockReset()
    Object.assign(mockDataset, {
      provider: 'vendor',
      indexing_technique: 'high_quality',
      is_multimodal: false,
      permission_keys: ['dataset.acl.retrieval_recall'],
    })
    mockConsoleState = {
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: [],
    }
    recordsData = { data: [], total: 0, page: 1, limit: 10, has_more: false }
    getRecords.mockImplementation(() => Promise.resolve(recordsData))

    const useBreakpoints = await import('@/hooks/use-breakpoints')
    vi.mocked(useBreakpoints.default).mockReturnValue(
      'pc' as unknown as ReturnType<typeof useBreakpoints.default>,
    )
  })

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
      const response = createDeferred<HitTestingResponse>()
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
    const { default: useBreakpoints } = await import('@/hooks/use-breakpoints')
    vi.mocked(useBreakpoints).mockReturnValue('mobile' as ReturnType<typeof useBreakpoints>)
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
