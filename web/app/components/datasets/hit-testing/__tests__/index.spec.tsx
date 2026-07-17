import type {
  ExternalHitTestingResponse,
  HitTestingRecord,
  HitTestingResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode } from 'react'
import type { DataSet, HitTestingRecord as TestingHistoryRecord } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RETRIEVE_METHOD } from '@/types/app'
import HitTestingPage from '../index'

const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/service/base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/base')>()
  return { ...actual, request: mockRequest }
})

vi.mock('@langgenius/dify-ui/pagination', () => ({
  Pagination: ({
    page,
    totalPages,
    onPageChange,
    labels,
  }: {
    page: number
    totalPages: number
    onPageChange: (page: number) => void
    labels: { next: string }
  }) => (
    <button
      type="button"
      aria-label={labels.next}
      disabled={page >= totalPages}
      onClick={() => onPageChange(page + 1)}
    >
      {page}/{totalPages}
    </button>
  ),
}))

vi.mock('@/app/components/datasets/common/retrieval-method-config', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: RetrievalConfig
    onChange: (value: RetrievalConfig) => void
  }) => (
    <button type="button" onClick={() => onChange({ ...value, top_k: 8 })}>
      Use Top K 8
    </button>
  ),
}))

// Note: These components use real implementations for integration testing:
// - Toast, FloatRightContainer, Drawer, Pagination, Loading
// - RetrievalMethodConfig, EconomicalRetrievalMethodConfig
// - ImageUploaderInRetrievalTesting, retrieval-method-info, check-rerank-model

// Mock RetrievalSettings to allow triggering onChange
vi.mock('@/app/components/datasets/external-knowledge-base/create/RetrievalSettings', () => ({
  default: ({
    onChange,
  }: {
    onChange: (data: {
      top_k?: number
      score_threshold?: number
      score_threshold_enabled?: boolean
    }) => void
  }) => {
    return (
      <div data-testid="retrieval-settings-mock">
        <button data-testid="change-top-k" onClick={() => onChange({ top_k: 8 })}>
          Change Top K
        </button>
        <button
          data-testid="change-score-threshold"
          onClick={() => onChange({ score_threshold: 0.9 })}
        >
          Change Score Threshold
        </button>
        <button
          data-testid="change-score-enabled"
          onClick={() => onChange({ score_threshold_enabled: true })}
        >
          Change Score Enabled
        </button>
      </div>
    )
  },
}))

// Mock Setup

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock use-context-selector
const mockDataset = {
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
} as Partial<DataSet>

let mockAppContextState = {
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}

vi.mock('use-context-selector', () => ({
  useContext: vi.fn(() => ({ dataset: mockDataset })),
  useContextSelector: vi.fn((_, selector) => selector({ dataset: mockDataset })),
  createContext: vi.fn(() => ({})),
}))

// Mock dataset detail context
vi.mock('@/context/dataset-detail', () => ({
  default: {},
  useDatasetDetailContext: vi.fn(() => ({ dataset: mockDataset })),
  useDatasetDetailContextWithSelector: vi.fn(
    (selector: (v: { dataset?: typeof mockDataset }) => unknown) =>
      selector({ dataset: mockDataset as DataSet }),
  ),
}))

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState)
})

const mockRecordsRefetch = vi.fn()

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetTestingRecords: vi.fn(() => ({
    data: {
      data: [],
      total: 0,
      page: 1,
      limit: 10,
      has_more: false,
    },
    refetch: mockRecordsRefetch,
    isLoading: false,
  })),
}))

vi.mock('jotai', async (importOriginal) => {
  const { createDatasetAccessJotaiMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessJotaiMock(importOriginal)
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
vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: vi.fn(() => ({
    data: {
      file_size_limit: 10,
      batch_count_limit: 5,
      image_file_size_limit: 5,
    },
    isLoading: false,
  })),
}))

// Store ref to ImageUploader onChange for testing
let _mockImageUploaderOnChange:
  | ((
      files: Array<{
        sourceUrl?: string
        uploadedId?: string
        mimeType: string
        name: string
        size: number
        extension: string
      }>,
    ) => void)
  | null = null

// Mock ImageUploaderInRetrievalTesting to capture onChange
vi.mock(
  '@/app/components/datasets/common/image-uploader/image-uploader-in-retrieval-testing',
  () => ({
    default: ({
      textArea,
      actionButton,
      onChange,
    }: {
      textArea: React.ReactNode
      actionButton: React.ReactNode
      onChange: (
        files: Array<{
          sourceUrl?: string
          uploadedId?: string
          mimeType: string
          name: string
          size: number
          extension: string
        }>,
      ) => void
    }) => {
      _mockImageUploaderOnChange = onChange
      return (
        <div data-testid="image-uploader-mock">
          {textArea}
          {actionButton}
          <button
            data-testid="trigger-image-change"
            onClick={() =>
              onChange([
                {
                  sourceUrl: 'http://example.com/new-image.png',
                  uploadedId: 'new-uploaded-id',
                  mimeType: 'image/png',
                  name: 'new-image.png',
                  size: 2000,
                  extension: 'png',
                },
              ])
            }
          >
            Add Image
          </button>
        </div>
      )
    },
  }),
)

// Mock docLink hook
vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(() => () => 'https://docs.example.com'),
}))

// Mock model list hook - include all exports used by child components
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
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

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })

const TestWrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = createTestQueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const renderWithProviders = (ui: React.ReactElement) => {
  return render(ui, { wrapper: TestWrapper })
}

// Test Factories

const createMockSegment = (overrides = {}): HitTestingRecord['segment'] => ({
  answer: null,
  completed_at: null,
  created_at: 1609459200,
  created_by: 'user-1',
  disabled_at: null,
  disabled_by: null,
  id: 'segment-1',
  document: {
    id: 'doc-1',
    data_source_type: 'upload_file',
    name: 'test-document.pdf',
    doc_type: 'book',
    doc_metadata: null,
  },
  document_id: 'doc-1',
  enabled: true,
  error: null,
  content: 'Test segment content',
  sign_content: 'Test signed content',
  status: 'completed',
  stopped_at: null,
  indexing_at: null,
  index_node_id: null,
  position: 1,
  word_count: 100,
  tokens: 50,
  keywords: ['test', 'keyword'],
  hit_count: 5,
  index_node_hash: 'hash-123',
  ...overrides,
})

const createMockHitTesting = (overrides = {}): HitTestingRecord => ({
  segment: createMockSegment(),
  score: 0.85,
  tsne_position: null,
  child_chunks: [],
  files: [],
  summary: null,
  ...overrides,
})

const createMockRecord = (overrides = {}): TestingHistoryRecord => ({
  id: 'record-1',
  source: 'hit_testing',
  source_app_id: 'app-1',
  created_by_role: 'account',
  created_by: 'user-1',
  created_at: 1609459200,
  queries: [{ content: 'Test query', content_type: 'text_query', file_info: null }],
  ...overrides,
})

const _createMockRetrievalConfig = (overrides = {}): RetrievalConfig =>
  ({
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
    ...overrides,
  }) as RetrievalConfig

// HitTestingPage integration tests

describe('HitTestingPage', () => {
  const requests: Array<{ body?: unknown; method: string; url: string }> = []
  let hitTestingResponse: HitTestingResponse = { query: { content: '' }, records: [] }
  let externalHitTestingResponse: ExternalHitTestingResponse = {
    query: { content: '' },
    records: [],
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mockRecordsRefetch.mockReset()
    requests.length = 0
    hitTestingResponse = { query: { content: '' }, records: [] }
    externalHitTestingResponse = { query: { content: '' }, records: [] }
    mockRequest.mockImplementation(
      async (url: string, _init: RequestInit, options: { request: Request }) => {
        const method = options.request.method
        const body = method === 'GET' ? undefined : await options.request.clone().json()
        requests.push({ body, method, url })

        const response = url.includes('/external-hit-testing')
          ? externalHitTestingResponse
          : url.includes('/hit-testing')
            ? hitTestingResponse
            : { retrieval_method: ['semantic_search', 'full_text_search', 'hybrid_search'] }
        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    )
    Object.assign(mockDataset, {
      provider: 'vendor',
      indexing_technique: 'high_quality',
      is_multimodal: false,
      permission_keys: ['dataset.acl.retrieval_recall'],
    })
    mockAppContextState = {
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: [],
    }

    const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
    vi.mocked(useDatasetTestingRecords).mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 10, has_more: false },
      refetch: mockRecordsRefetch,
      isLoading: false,
    } as unknown as ReturnType<typeof useDatasetTestingRecords>)

    const useBreakpoints = await import('@/hooks/use-breakpoints')
    vi.mocked(useBreakpoints.default).mockReturnValue(
      'pc' as unknown as ReturnType<typeof useBreakpoints.default>,
    )
  })

  it('disables record loading and query input without retrieval recall permission', async () => {
    const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
    mockDataset.permission_keys = []

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(vi.mocked(useDatasetTestingRecords)).toHaveBeenCalledWith(
      'dataset-1',
      { limit: 10, page: 1 },
      { enabled: false },
    )
  })

  it('shows the records loading state', async () => {
    const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
    vi.mocked(useDatasetTestingRecords).mockReturnValue({
      data: undefined,
      refetch: mockRecordsRefetch,
      isLoading: true,
    } as unknown as ReturnType<typeof useDatasetTestingRecords>)

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows both empty history and empty result states', () => {
    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    expect(screen.getByText(/noRecentTip/)).toBeInTheDocument()
    expect(screen.getByText(/hit.emptyTip/)).toBeInTheDocument()
  })

  it('loads a history record into the query input when selected', async () => {
    const user = userEvent.setup()
    const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
    vi.mocked(useDatasetTestingRecords).mockReturnValue({
      data: {
        data: [
          createMockRecord({
            queries: [
              { content: 'Record query text', content_type: 'text_query', file_info: null },
            ],
          }),
        ],
        total: 1,
        page: 1,
        limit: 10,
        has_more: false,
      },
      refetch: mockRecordsRefetch,
      isLoading: false,
    } as unknown as ReturnType<typeof useDatasetTestingRecords>)

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
    await user.click(screen.getByText('Record query text'))

    expect(screen.getByRole('textbox')).toHaveValue('Record query text')
  })

  it('requests the next records page through pagination', async () => {
    const user = userEvent.setup()
    const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
    vi.mocked(useDatasetTestingRecords).mockReturnValue({
      data: {
        data: Array.from({ length: 10 }, (_, index) => createMockRecord({ id: `record-${index}` })),
        total: 25,
        page: 1,
        limit: 10,
        has_more: true,
      },
      refetch: mockRecordsRefetch,
      isLoading: false,
    } as unknown as ReturnType<typeof useDatasetTestingRecords>)

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
    await user.click(screen.getByRole('button', { name: /pagination.next/ }))

    expect(vi.mocked(useDatasetTestingRecords)).toHaveBeenLastCalledWith(
      'dataset-1',
      { limit: 10, page: 2 },
      { enabled: true },
    )
  })

  it('saves retrieval settings, submits a query, refreshes history, and renders results', async () => {
    const user = userEvent.setup()
    hitTestingResponse = {
      query: { content: 'Test query' },
      records: [createMockHitTesting()],
    }

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
    await user.click(screen.getByText(/semantic_search/))
    await user.click(screen.getByRole('button', { name: 'Use Top K 8' }))
    await user.click(screen.getByRole('button', { name: /operation.save/ }))
    await user.type(screen.getByRole('textbox'), 'Test query')
    await user.click(screen.getByRole('button', { name: /input.testing/ }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        method: 'POST',
        url: expect.stringMatching(/\/datasets\/dataset-1\/hit-testing$/),
        body: expect.objectContaining({
          query: 'Test query',
          attachment_ids: [],
          retrieval_model: expect.objectContaining({
            search_method: RETRIEVE_METHOD.semantic,
            top_k: 8,
          }),
        }),
      })
    })
    expect(mockRecordsRefetch).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('test-document.pdf')).toBeInTheDocument()
  })

  it('submits external retrieval settings and renders external results', async () => {
    const user = userEvent.setup()
    Object.assign(mockDataset, { provider: 'external' })
    externalHitTestingResponse = {
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
    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
    await user.click(screen.getByRole('button', { name: /settingTitle/ }))
    await user.click(screen.getByRole('button', { name: 'Change Top K' }))
    await user.click(screen.getByRole('button', { name: /operation.save/ }))
    await user.type(screen.getByRole('textbox'), 'External query')
    await user.click(screen.getByRole('button', { name: /input.testing/ }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        method: 'POST',
        url: expect.stringMatching(/\/datasets\/dataset-1\/external-hit-testing$/),
        body: {
          query: 'External query',
          external_retrieval_model: {
            top_k: 8,
            score_threshold: 0.5,
            score_threshold_enabled: false,
          },
        },
      })
    })
    expect(requests.some(({ url }) => url.endsWith('/datasets/dataset-1/hit-testing'))).toBe(false)
    expect(mockRecordsRefetch).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('External content')).toBeInTheDocument()
  })
})
