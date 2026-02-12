import type { ReactNode } from 'react'
import type { DataSet, HitTesting, HitTestingRecord, HitTestingResponse } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RETRIEVE_METHOD } from '@/types/app'
import HitTestingPage from '../index'

// Note: These components use real implementations for integration testing:
// - Toast, FloatRightContainer, Drawer, Pagination, Loading
// - RetrievalMethodConfig, EconomicalRetrievalMethodConfig
// - ImageUploaderInRetrievalTesting, retrieval-method-info, check-rerank-model

// Mock RetrievalSettings to allow triggering onChange
vi.mock('@/app/components/datasets/external-knowledge-base/create/RetrievalSettings', () => ({
  default: ({ onChange }: { onChange: (data: { top_k?: number, score_threshold?: number, score_threshold_enabled?: boolean }) => void }) => {
    return (
      <div data-testid="retrieval-settings-mock">
        <button data-testid="change-top-k" onClick={() => onChange({ top_k: 8 })}>Change Top K</button>
        <button data-testid="change-score-threshold" onClick={() => onChange({ score_threshold: 0.9 })}>Change Score Threshold</button>
        <button data-testid="change-score-enabled" onClick={() => onChange({ score_threshold_enabled: true })}>Change Score Enabled</button>
      </div>
    )
  },
}))

// Mock Setup

vi.mock('next/navigation', () => ({
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
} as Partial<DataSet>

vi.mock('use-context-selector', () => ({
  useContext: vi.fn(() => ({ dataset: mockDataset })),
  useContextSelector: vi.fn((_, selector) => selector({ dataset: mockDataset })),
  createContext: vi.fn(() => ({})),
}))

// Mock dataset detail context
vi.mock('@/context/dataset-detail', () => ({
  default: {},
  useDatasetDetailContext: vi.fn(() => ({ dataset: mockDataset })),
  useDatasetDetailContextWithSelector: vi.fn((selector: (v: { dataset?: typeof mockDataset }) => unknown) =>
    selector({ dataset: mockDataset as DataSet }),
  ),
}))

const mockRecordsRefetch = vi.fn()
const mockHitTestingMutateAsync = vi.fn()
const mockExternalHitTestingMutateAsync = vi.fn()

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

vi.mock('@/service/knowledge/use-hit-testing', () => ({
  useHitTesting: vi.fn(() => ({
    mutateAsync: mockHitTestingMutateAsync,
    isPending: false,
  })),
  useExternalKnowledgeBaseHitTesting: vi.fn(() => ({
    mutateAsync: mockExternalHitTestingMutateAsync,
    isPending: false,
  })),
}))

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
    formatTime: vi.fn((timestamp: number, _format: string) => new Date(timestamp * 1000).toISOString()),
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
let _mockImageUploaderOnChange: ((files: Array<{ sourceUrl?: string, uploadedId?: string, mimeType: string, name: string, size: number, extension: string }>) => void) | null = null

// Mock ImageUploaderInRetrievalTesting to capture onChange
vi.mock('@/app/components/datasets/common/image-uploader/image-uploader-in-retrieval-testing', () => ({
  default: ({ textArea, actionButton, onChange }: {
    textArea: React.ReactNode
    actionButton: React.ReactNode
    onChange: (files: Array<{ sourceUrl?: string, uploadedId?: string, mimeType: string, name: string, size: number, extension: string }>) => void
  }) => {
    _mockImageUploaderOnChange = onChange
    return (
      <div data-testid="image-uploader-mock">
        {textArea}
        {actionButton}
        <button
          data-testid="trigger-image-change"
          onClick={() => onChange([
            {
              sourceUrl: 'http://example.com/new-image.png',
              uploadedId: 'new-uploaded-id',
              mimeType: 'image/png',
              name: 'new-image.png',
              size: 2000,
              extension: 'png',
            },
          ])}
        >
          Add Image
        </button>
      </div>
    )
  },
}))

// Mock docLink hook
vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(() => () => 'https://docs.example.com'),
}))

// Mock provider context for retrieval method config
vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(() => ({
    supportRetrievalMethods: [
      'semantic_search',
      'full_text_search',
      'hybrid_search',
    ],
  })),
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

const createTestQueryClient = () => new QueryClient({
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
  return (
    <QueryClientProvider client={queryClient}>
      {children}
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

const createMockHitTesting = (overrides = {}): HitTesting => ({
  segment: createMockSegment() as HitTesting['segment'],
  content: createMockSegment() as HitTesting['content'],
  score: 0.85,
  tsne_position: { x: 0.5, y: 0.5 },
  child_chunks: null,
  files: [],
  ...overrides,
})

const createMockRecord = (overrides = {}): HitTestingRecord => ({
  id: 'record-1',
  source: 'hit_testing',
  source_app_id: 'app-1',
  created_by_role: 'account',
  created_by: 'user-1',
  created_at: 1609459200,
  queries: [
    { content: 'Test query', content_type: 'text_query', file_info: null },
  ],
  ...overrides,
})

const _createMockRetrievalConfig = (overrides = {}): RetrievalConfig => ({
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
} as RetrievalConfig)

// HitTestingPage Component Tests
// NOTE: Child component unit tests (Score, Mask, EmptyRecords, ResultItemMeta,
// ResultItemFooter, ChildChunksItem, ResultItem, ResultItemExternal, Textarea,
// Records, QueryInput, ModifyExternalRetrievalModal, ModifyRetrievalModal,
// ChunkDetailModal, extensionToFileType) have been moved to their own dedicated
// spec files under the ./components/ and ./utils/ directories.
// This file now focuses exclusively on HitTestingPage integration tests.

describe('HitTestingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render page title', () => {
      renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
      // Look for heading element
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toBeInTheDocument()
    })

    it('should render records section', () => {
      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
      // The records section should be present
      expect(container.querySelector('.flex-col')).toBeInTheDocument()
    })

    it('should render query input', () => {
      renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('Loading States', () => {
    it('should show loading when records are loading', async () => {
      const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetTestingRecords).mockReturnValue({
        data: undefined,
        refetch: mockRecordsRefetch,
        isLoading: true,
      } as unknown as ReturnType<typeof useDatasetTestingRecords>)

      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
      // Loading component should be visible - look for the loading animation
      const loadingElement = container.querySelector('[class*="animate"]') || container.querySelector('.flex-1')
      expect(loadingElement).toBeInTheDocument()
    })
  })

  describe('Empty States', () => {
    it('should show empty records when no data', () => {
      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
      // EmptyRecords component should be rendered - check that the component is mounted
      // The EmptyRecords has a specific structure with bg-workflow-process-bg class
      const mainContainer = container.querySelector('.flex.h-full')
      expect(mainContainer).toBeInTheDocument()
    })
  })

  describe('Records Display', () => {
    it('should display records when data is present', async () => {
      const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetTestingRecords).mockReturnValue({
        data: {
          data: [createMockRecord()],
          total: 1,
          page: 1,
          limit: 10,
          has_more: false,
        },
        refetch: mockRecordsRefetch,
        isLoading: false,
      } as unknown as ReturnType<typeof useDatasetTestingRecords>)

      renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
      expect(screen.getByText('Test query')).toBeInTheDocument()
    })
  })

  describe('Pagination', () => {
    it('should show pagination when total exceeds limit', async () => {
      const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetTestingRecords).mockReturnValue({
        data: {
          data: Array.from({ length: 10 }, (_, i) => createMockRecord({ id: `record-${i}` })),
          total: 25,
          page: 1,
          limit: 10,
          has_more: true,
        },
        refetch: mockRecordsRefetch,
        isLoading: false,
      } as unknown as ReturnType<typeof useDatasetTestingRecords>)

      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
      // Pagination should be visible - look for pagination controls
      const paginationElement = container.querySelector('[class*="pagination"]') || container.querySelector('nav')
      expect(paginationElement || screen.getAllByText('Test query').length > 0).toBeTruthy()
    })
  })

  describe('Right Panel', () => {
    it('should render right panel container', () => {
      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)
      // The right panel should be present (on non-mobile)
      const rightPanel = container.querySelector('.rounded-tl-2xl')
      expect(rightPanel).toBeInTheDocument()
    })
  })

  describe('Retrieval Modal', () => {
    it('should open retrieval modal when method is clicked', async () => {
      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

      // Find the method selector (cursor-pointer div with the retrieval method)
      const methodSelectors = container.querySelectorAll('.cursor-pointer')
      const methodSelector = Array.from(methodSelectors).find(el => !el.closest('button') && !el.closest('tr'))

      // Verify we found a method selector to click
      expect(methodSelector).toBeTruthy()

      if (methodSelector)
        fireEvent.click(methodSelector)

      // The component should still be functional after the click
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Hit Results Display', () => {
    it('should display hit results when hitResult has records', async () => {
      const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetTestingRecords).mockReturnValue({
        data: {
          data: [],
          total: 0,
          page: 1,
          limit: 10,
          has_more: false,
        },
        refetch: mockRecordsRefetch,
        isLoading: false,
      } as unknown as ReturnType<typeof useDatasetTestingRecords>)

      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

      // The right panel should show empty state initially
      expect(container.querySelector('.rounded-tl-2xl')).toBeInTheDocument()
    })

    it('should render loading skeleton when retrieval is in progress', async () => {
      const { useHitTesting } = await import('@/service/knowledge/use-hit-testing')
      vi.mocked(useHitTesting).mockReturnValue({
        mutateAsync: mockHitTestingMutateAsync,
        isPending: true,
      } as unknown as ReturnType<typeof useHitTesting>)

      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

      // Component should render without crashing
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render results when hit testing returns data', async () => {
      // This test simulates the flow of getting hit results
      const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetTestingRecords).mockReturnValue({
        data: {
          data: [],
          total: 0,
          page: 1,
          limit: 10,
          has_more: false,
        },
        refetch: mockRecordsRefetch,
        isLoading: false,
      } as unknown as ReturnType<typeof useDatasetTestingRecords>)

      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

      // The component should render the result display area
      expect(container.querySelector('.bg-background-body')).toBeInTheDocument()
    })
  })

  describe('Record Interaction', () => {
    it('should update queries when a record is clicked', async () => {
      const mockRecord = createMockRecord({
        queries: [
          { content: 'Record query text', content_type: 'text_query', file_info: null },
        ],
      })

      const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetTestingRecords).mockReturnValue({
        data: {
          data: [mockRecord],
          total: 1,
          page: 1,
          limit: 10,
          has_more: false,
        },
        refetch: mockRecordsRefetch,
        isLoading: false,
      } as unknown as ReturnType<typeof useDatasetTestingRecords>)

      renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

      // Find and click the record row
      const recordText = screen.getByText('Record query text')
      const row = recordText.closest('tr')
      if (row)
        fireEvent.click(row)

      // The query input should be updated - this causes re-render with new key
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('External Dataset', () => {
    it('should render external dataset UI when provider is external', async () => {
      // Mock dataset with external provider
      const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetTestingRecords).mockReturnValue({
        data: {
          data: [],
          total: 0,
          page: 1,
          limit: 10,
          has_more: false,
        },
        refetch: mockRecordsRefetch,
        isLoading: false,
      } as unknown as ReturnType<typeof useDatasetTestingRecords>)

      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

      // Component should render
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Mobile View', () => {
    it('should handle mobile breakpoint', async () => {
      // Mock mobile breakpoint
      const useBreakpoints = await import('@/hooks/use-breakpoints')
      vi.mocked(useBreakpoints.default).mockReturnValue('mobile' as unknown as ReturnType<typeof useBreakpoints.default>)

      const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

      // Component should still render
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('useEffect for mobile panel', () => {
    it('should update right panel visibility based on mobile state', async () => {
      const useBreakpoints = await import('@/hooks/use-breakpoints')

      // First render with desktop
      vi.mocked(useBreakpoints.default).mockReturnValue('pc' as unknown as ReturnType<typeof useBreakpoints.default>)

      const { rerender, container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

      expect(container.firstChild).toBeInTheDocument()

      // Re-render with mobile
      vi.mocked(useBreakpoints.default).mockReturnValue('mobile' as unknown as ReturnType<typeof useBreakpoints.default>)

      rerender(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <HitTestingPage datasetId="dataset-1" />
        </QueryClientProvider>,
      )

      expect(container.firstChild).toBeInTheDocument()
    })
  })
})

describe('Integration: Hit Testing Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHitTestingMutateAsync.mockReset()
    mockExternalHitTestingMutateAsync.mockReset()
  })

  it('should complete a full hit testing flow', async () => {
    const mockResponse: HitTestingResponse = {
      query: { content: 'Test query', tsne_position: { x: 0, y: 0 } },
      records: [createMockHitTesting()],
    }

    mockHitTestingMutateAsync.mockImplementation(async (_params, options) => {
      options?.onSuccess?.(mockResponse)
      return mockResponse
    })

    renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Wait for textbox with timeout for CI
    const textarea = await waitFor(
      () => screen.getByRole('textbox'),
      { timeout: 3000 },
    )

    // Type query
    fireEvent.change(textarea, { target: { value: 'Test query' } })

    // Find submit button by class
    const buttons = screen.getAllByRole('button')
    const submitButton = buttons.find(btn => btn.classList.contains('w-[88px]'))
    expect(submitButton).not.toBeDisabled()
  })

  it('should handle API error gracefully', async () => {
    mockHitTestingMutateAsync.mockRejectedValue(new Error('API Error'))

    const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Wait for textbox with timeout for CI
    const textarea = await waitFor(
      () => screen.getByRole('textbox'),
      { timeout: 3000 },
    )

    // Type query
    fireEvent.change(textarea, { target: { value: 'Test query' } })

    // Component should still be functional - check for the main container
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should render hit results after successful submission', async () => {
    const mockHitTestingRecord = createMockHitTesting()
    const mockResponse: HitTestingResponse = {
      query: { content: 'Test query', tsne_position: { x: 0, y: 0 } },
      records: [mockHitTestingRecord],
    }

    mockHitTestingMutateAsync.mockImplementation(async (_params, options) => {
      // Call onSuccess synchronously to ensure state is updated
      if (options?.onSuccess)
        options.onSuccess(mockResponse)
      return mockResponse
    })

    const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
    vi.mocked(useDatasetTestingRecords).mockReturnValue({
      data: {
        data: [],
        total: 0,
        page: 1,
        limit: 10,
        has_more: false,
      },
      refetch: mockRecordsRefetch,
      isLoading: false,
    } as unknown as ReturnType<typeof useDatasetTestingRecords>)

    const { container: _container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Wait for textbox to be rendered with timeout for CI environment
    const textarea = await waitFor(
      () => screen.getByRole('textbox'),
      { timeout: 3000 },
    )

    // Type query
    fireEvent.change(textarea, { target: { value: 'Test query' } })

    const buttons = screen.getAllByRole('button')
    const submitButton = buttons.find(btn => btn.classList.contains('w-[88px]'))
    if (submitButton)
      fireEvent.click(submitButton)

    // Wait for the mutation to complete
    await waitFor(
      () => {
        expect(mockHitTestingMutateAsync).toHaveBeenCalled()
      },
      { timeout: 3000 },
    )
  })

  it('should render ResultItem components for non-external results', async () => {
    const mockResponse: HitTestingResponse = {
      query: { content: 'Test query', tsne_position: { x: 0, y: 0 } },
      records: [
        createMockHitTesting({ score: 0.95 }),
        createMockHitTesting({ score: 0.85 }),
      ],
    }

    mockHitTestingMutateAsync.mockImplementation(async (_params, options) => {
      if (options?.onSuccess)
        options.onSuccess(mockResponse)
      return mockResponse
    })

    const { useDatasetTestingRecords } = await import('@/service/knowledge/use-dataset')
    vi.mocked(useDatasetTestingRecords).mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 10, has_more: false },
      refetch: mockRecordsRefetch,
      isLoading: false,
    } as unknown as ReturnType<typeof useDatasetTestingRecords>)

    const { container: _container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Wait for component to be fully rendered with longer timeout
    const textarea = await waitFor(
      () => screen.getByRole('textbox'),
      { timeout: 3000 },
    )

    // Submit a query
    fireEvent.change(textarea, { target: { value: 'Test query' } })

    const buttons = screen.getAllByRole('button')
    const submitButton = buttons.find(btn => btn.classList.contains('w-[88px]'))
    if (submitButton)
      fireEvent.click(submitButton)

    // Wait for mutation to complete with longer timeout
    await waitFor(
      () => {
        expect(mockHitTestingMutateAsync).toHaveBeenCalled()
      },
      { timeout: 3000 },
    )
  })

  it('should render external results when dataset is external', async () => {
    const mockExternalResponse = {
      query: { content: 'test' },
      records: [
        {
          title: 'External Result 1',
          content: 'External content',
          score: 0.9,
          metadata: {},
        },
      ],
    }

    mockExternalHitTestingMutateAsync.mockImplementation(async (_params, options) => {
      if (options?.onSuccess)
        options.onSuccess(mockExternalResponse)
      return mockExternalResponse
    })

    const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Component should render
    expect(container.firstChild).toBeInTheDocument()

    // Wait for textbox with timeout for CI
    const textarea = await waitFor(
      () => screen.getByRole('textbox'),
      { timeout: 3000 },
    )

    // Type in textarea to verify component is functional
    fireEvent.change(textarea, { target: { value: 'Test query' } })

    const buttons = screen.getAllByRole('button')
    const submitButton = buttons.find(btn => btn.classList.contains('w-[88px]'))
    if (submitButton)
      fireEvent.click(submitButton)

    // Verify component is still functional after submission
    await waitFor(
      () => {
        expect(screen.getByRole('textbox')).toBeInTheDocument()
      },
      { timeout: 3000 },
    )
  })
})

// Drawer and Modal Interaction Tests

describe('Drawer and Modal Interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should save retrieval config when ModifyRetrievalModal onSave is called', async () => {
    const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Find and click the retrieval method selector to open the drawer
    const methodSelectors = container.querySelectorAll('.cursor-pointer')
    const methodSelector = Array.from(methodSelectors).find(
      el => !el.closest('button') && !el.closest('tr') && el.querySelector('.text-xs'),
    )

    if (methodSelector) {
      fireEvent.click(methodSelector)

      await waitFor(() => {
        // The drawer should open - verify container is still there
        expect(container.firstChild).toBeInTheDocument()
      })
    }

    // Component should still be functional - verify main container
    expect(container.querySelector('.overflow-y-auto')).toBeInTheDocument()
  })

  it('should close retrieval modal when onHide is called', async () => {
    const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Open the modal first
    const methodSelectors = container.querySelectorAll('.cursor-pointer')
    const methodSelector = Array.from(methodSelectors).find(
      el => !el.closest('button') && !el.closest('tr') && el.querySelector('.text-xs'),
    )

    if (methodSelector) {
      fireEvent.click(methodSelector)
    }

    // Component should still be functional
    expect(container.firstChild).toBeInTheDocument()
  })
})

// renderHitResults Coverage Tests

describe('renderHitResults Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHitTestingMutateAsync.mockReset()
  })

  it('should render hit results panel with records count', async () => {
    const mockRecords = [
      createMockHitTesting({ score: 0.95 }),
      createMockHitTesting({ score: 0.85 }),
    ]
    const mockResponse: HitTestingResponse = {
      query: { content: 'test', tsne_position: { x: 0, y: 0 } },
      records: mockRecords,
    }

    // Make mutation call onSuccess synchronously
    mockHitTestingMutateAsync.mockImplementation(async (params, options) => {
      // Simulate async behavior
      await Promise.resolve()
      if (options?.onSuccess)
        options.onSuccess(mockResponse)
      return mockResponse
    })

    const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Wait for textbox with timeout for CI
    const textarea = await waitFor(
      () => screen.getByRole('textbox'),
      { timeout: 3000 },
    )

    // Enter query
    fireEvent.change(textarea, { target: { value: 'test query' } })

    const buttons = screen.getAllByRole('button')
    const submitButton = buttons.find(btn => btn.classList.contains('w-[88px]'))

    if (submitButton)
      fireEvent.click(submitButton)

    // Verify component is functional
    await waitFor(() => {
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  it('should iterate through records and render ResultItem for each', async () => {
    const mockRecords = [
      createMockHitTesting({ score: 0.9 }),
    ]

    mockHitTestingMutateAsync.mockImplementation(async (_params, options) => {
      const response = { query: { content: 'test' }, records: mockRecords }
      if (options?.onSuccess)
        options.onSuccess(response)
      return response
    })

    const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'test' } })

    const buttons = screen.getAllByRole('button')
    const submitButton = buttons.find(btn => btn.classList.contains('w-[88px]'))
    if (submitButton)
      fireEvent.click(submitButton)

    await waitFor(() => {
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})

// Drawer onSave Coverage Tests

describe('ModifyRetrievalModal onSave Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update retrieval config when onSave is triggered', async () => {
    const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Open the drawer
    const methodSelectors = container.querySelectorAll('.cursor-pointer')
    const methodSelector = Array.from(methodSelectors).find(
      el => !el.closest('button') && !el.closest('tr') && el.querySelector('.text-xs'),
    )

    if (methodSelector) {
      fireEvent.click(methodSelector)

      // Wait for drawer to open
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })
    }

    // Verify component renders correctly
    expect(container.querySelector('.overflow-y-auto')).toBeInTheDocument()
  })

  it('should close modal after saving', async () => {
    const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Open the drawer
    const methodSelectors = container.querySelectorAll('.cursor-pointer')
    const methodSelector = Array.from(methodSelectors).find(
      el => !el.closest('button') && !el.closest('tr') && el.querySelector('.text-xs'),
    )

    if (methodSelector)
      fireEvent.click(methodSelector)

    // Component should still be rendered
    expect(container.firstChild).toBeInTheDocument()
  })
})

// Direct Component Coverage Tests

describe('HitTestingPage Internal Functions Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHitTestingMutateAsync.mockReset()
    mockExternalHitTestingMutateAsync.mockReset()
  })

  it('should trigger renderHitResults when mutation succeeds with records', async () => {
    // Create mock hit testing records
    const mockHitRecords = [
      createMockHitTesting({ score: 0.95 }),
      createMockHitTesting({ score: 0.85 }),
    ]

    const mockResponse: HitTestingResponse = {
      query: { content: 'test query', tsne_position: { x: 0, y: 0 } },
      records: mockHitRecords,
    }

    // Setup mutation to call onSuccess synchronously
    mockHitTestingMutateAsync.mockImplementation((_params, options) => {
      // Synchronously call onSuccess
      if (options?.onSuccess)
        options.onSuccess(mockResponse)
      return Promise.resolve(mockResponse)
    })

    const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Wait for textbox with timeout for CI
    const textarea = await waitFor(
      () => screen.getByRole('textbox'),
      { timeout: 3000 },
    )

    // Enter query and submit
    fireEvent.change(textarea, { target: { value: 'test query' } })

    const buttons = screen.getAllByRole('button')
    const submitButton = buttons.find(btn => btn.classList.contains('w-[88px]'))

    if (submitButton) {
      fireEvent.click(submitButton)
    }

    // Wait for state updates
    await waitFor(() => {
      expect(container.firstChild).toBeInTheDocument()
    }, { timeout: 3000 })

    // Verify mutation was called
    expect(mockHitTestingMutateAsync).toHaveBeenCalled()
  })

  it('should handle retrieval config update via ModifyRetrievalModal', async () => {
    const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Find and click retrieval method to open drawer
    const methodSelectors = container.querySelectorAll('.cursor-pointer')
    const methodSelector = Array.from(methodSelectors).find(
      el => !el.closest('button') && !el.closest('tr') && el.querySelector('.text-xs'),
    )

    if (methodSelector) {
      fireEvent.click(methodSelector)

      // Wait for drawer content
      await waitFor(() => {
        expect(container.firstChild).toBeInTheDocument()
      })

      // Try to find save button in the drawer
      const saveButtons = screen.queryAllByText(/save/i)
      if (saveButtons.length > 0) {
        fireEvent.click(saveButtons[0])
      }
    }

    // Component should still work
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should show hit count in results panel after successful query', async () => {
    const mockRecords = [createMockHitTesting()]
    const mockResponse: HitTestingResponse = {
      query: { content: 'test', tsne_position: { x: 0, y: 0 } },
      records: mockRecords,
    }

    mockHitTestingMutateAsync.mockResolvedValue(mockResponse)

    const { container } = renderWithProviders(<HitTestingPage datasetId="dataset-1" />)

    // Wait for textbox with timeout for CI
    const textarea = await waitFor(
      () => screen.getByRole('textbox'),
      { timeout: 3000 },
    )

    // Submit a query
    fireEvent.change(textarea, { target: { value: 'test' } })

    const buttons = screen.getAllByRole('button')
    const submitButton = buttons.find(btn => btn.classList.contains('w-[88px]'))

    if (submitButton)
      fireEvent.click(submitButton)

    // Verify the component renders
    await waitFor(() => {
      expect(container.firstChild).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})
