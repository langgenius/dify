import type { PipelineExecutionLogResponse } from '@/models/pipeline'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DatasourceType } from '@/models/pipeline'
import PipelineSettings from './index'

// Mock Next.js router
const mockPush = vi.fn()
const mockBack = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
}))

// Mock dataset detail context
const mockPipelineId = 'pipeline-123'
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: { pipeline_id: string, doc_form: string } }) => unknown) =>
    selector({ dataset: { pipeline_id: mockPipelineId, doc_form: 'text_model' } }),
}))

// Mock API hooks for PipelineSettings
const mockUsePipelineExecutionLog = vi.fn()
const mockMutateAsync = vi.fn()
const mockUseRunPublishedPipeline = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  usePipelineExecutionLog: (params: { dataset_id: string, document_id: string }) => mockUsePipelineExecutionLog(params),
  useRunPublishedPipeline: () => mockUseRunPublishedPipeline(),
  // For ProcessDocuments component
  usePublishedPipelineProcessingParams: () => ({
    data: { variables: [] },
    isFetching: false,
  }),
}))

// Mock document invalidation hooks
const mockInvalidDocumentList = vi.fn()
const mockInvalidDocumentDetail = vi.fn()
vi.mock('@/service/knowledge/use-document', () => ({
  useInvalidDocumentList: () => mockInvalidDocumentList,
  useInvalidDocumentDetail: () => mockInvalidDocumentDetail,
}))

// Mock Form component in ProcessDocuments - internal dependencies are too complex
vi.mock('../../../create-from-pipeline/process-documents/form', () => ({
  default: function MockForm({
    ref,
    initialData,
    configurations,
    onSubmit,
    onPreview,
    isRunning,
  }: {
    ref: React.RefObject<{ submit: () => void }>
    initialData: Record<string, unknown>
    configurations: Array<{ variable: string, label: string, type: string }>
    schema: unknown
    onSubmit: (data: Record<string, unknown>) => void
    onPreview: () => void
    isRunning: boolean
  }) {
    if (ref && typeof ref === 'object' && 'current' in ref) {
      (ref as React.MutableRefObject<{ submit: () => void }>).current = {
        submit: () => onSubmit(initialData),
      }
    }
    return (
      <form
        data-testid="process-form"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(initialData)
        }}
      >
        {configurations.map((config, index) => (
          <div key={index} data-testid={`field-${config.variable}`}>
            <label>{config.label}</label>
          </div>
        ))}
        <button type="button" data-testid="preview-btn" onClick={onPreview} disabled={isRunning}>
          Preview
        </button>
      </form>
    )
  },
}))

// Mock ChunkPreview - has complex internal state and many dependencies
vi.mock('../../../create-from-pipeline/preview/chunk-preview', () => ({
  default: function MockChunkPreview({
    dataSourceType,
    localFiles,
    onlineDocuments,
    websitePages,
    onlineDriveFiles,
    isIdle,
    isPending,
    estimateData,
  }: {
    dataSourceType: string
    localFiles: unknown[]
    onlineDocuments: unknown[]
    websitePages: unknown[]
    onlineDriveFiles: unknown[]
    isIdle: boolean
    isPending: boolean
    estimateData: unknown
  }) {
    return (
      <div data-testid="chunk-preview">
        <span data-testid="datasource-type">{dataSourceType}</span>
        <span data-testid="local-files-count">{localFiles.length}</span>
        <span data-testid="online-documents-count">{onlineDocuments.length}</span>
        <span data-testid="website-pages-count">{websitePages.length}</span>
        <span data-testid="online-drive-files-count">{onlineDriveFiles.length}</span>
        <span data-testid="is-idle">{String(isIdle)}</span>
        <span data-testid="is-pending">{String(isPending)}</span>
        <span data-testid="has-estimate-data">{String(!!estimateData)}</span>
      </div>
    )
  },
}))

// Test utilities
const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

// Factory functions for test data
const createMockExecutionLogResponse = (
  overrides: Partial<PipelineExecutionLogResponse> = {},
): PipelineExecutionLogResponse => ({
  datasource_type: DatasourceType.localFile,
  input_data: { chunk_size: '100' },
  datasource_node_id: 'datasource-node-1',
  datasource_info: {
    related_id: 'file-1',
    name: 'test-file.pdf',
    extension: 'pdf',
  },
  ...overrides,
})

const createDefaultProps = () => ({
  datasetId: 'dataset-123',
  documentId: 'document-456',
})

describe('PipelineSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPush.mockClear()
    mockBack.mockClear()
    mockMutateAsync.mockClear()
    mockInvalidDocumentList.mockClear()
    mockInvalidDocumentDetail.mockClear()

    // Default: successful data fetch
    mockUsePipelineExecutionLog.mockReturnValue({
      data: createMockExecutionLogResponse(),
      isFetching: false,
      isError: false,
    })

    // Default: useRunPublishedPipeline mock
    mockUseRunPublishedPipeline.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isIdle: true,
      isPending: false,
    })
  })

  // ==================== Rendering Tests ====================
  // Test basic rendering with real components
  describe('Rendering', () => {
    it('should render without crashing when data is loaded', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert - Real LeftHeader should render with correct content
      expect(screen.getByText('datasetPipeline.documentSettings.title')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.addDocuments.steps.processDocuments')).toBeInTheDocument()
      // Real ProcessDocuments should render
      expect(screen.getByTestId('process-form')).toBeInTheDocument()
      // ChunkPreview should render
      expect(screen.getByTestId('chunk-preview')).toBeInTheDocument()
    })

    it('should render Loading component when fetching data', () => {
      // Arrange
      mockUsePipelineExecutionLog.mockReturnValue({
        data: undefined,
        isFetching: true,
        isError: false,
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert - Loading component should be rendered, not main content
      expect(screen.queryByText('datasetPipeline.documentSettings.title')).not.toBeInTheDocument()
      expect(screen.queryByTestId('process-form')).not.toBeInTheDocument()
    })

    it('should render AppUnavailable when there is an error', () => {
      // Arrange
      mockUsePipelineExecutionLog.mockReturnValue({
        data: undefined,
        isFetching: false,
        isError: true,
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert - AppUnavailable should be rendered
      expect(screen.queryByText('datasetPipeline.documentSettings.title')).not.toBeInTheDocument()
    })

    it('should render container with correct CSS classes', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = renderWithProviders(<PipelineSettings {...props} />)

      // Assert
      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('relative', 'flex', 'min-w-[1024px]')
    })
  })

  // ==================== LeftHeader Integration ====================
  // Test real LeftHeader component behavior
  describe('LeftHeader Integration', () => {
    it('should render LeftHeader with title prop', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert - LeftHeader displays the title
      expect(screen.getByText('datasetPipeline.documentSettings.title')).toBeInTheDocument()
    })

    it('should render back button in LeftHeader', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert - Back button should exist with proper aria-label
      const backButton = screen.getByRole('button', { name: 'common.operation.back' })
      expect(backButton).toBeInTheDocument()
    })

    it('should call router.back when back button is clicked', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      const backButton = screen.getByRole('button', { name: 'common.operation.back' })
      fireEvent.click(backButton)

      // Assert
      expect(mockBack).toHaveBeenCalledTimes(1)
    })
  })

  // ==================== Props Testing ====================
  describe('Props', () => {
    it('should pass datasetId and documentId to usePipelineExecutionLog', () => {
      // Arrange
      const props = { datasetId: 'custom-dataset', documentId: 'custom-document' }

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert
      expect(mockUsePipelineExecutionLog).toHaveBeenCalledWith({
        dataset_id: 'custom-dataset',
        document_id: 'custom-document',
      })
    })
  })

  // ==================== Memoization - Data Transformation ====================
  describe('Memoization - Data Transformation', () => {
    it('should transform localFile datasource correctly', () => {
      // Arrange
      const mockData = createMockExecutionLogResponse({
        datasource_type: DatasourceType.localFile,
        datasource_info: {
          related_id: 'file-123',
          name: 'document.pdf',
          extension: 'pdf',
        },
      })
      mockUsePipelineExecutionLog.mockReturnValue({
        data: mockData,
        isFetching: false,
        isError: false,
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert
      expect(screen.getByTestId('local-files-count')).toHaveTextContent('1')
      expect(screen.getByTestId('datasource-type')).toHaveTextContent(DatasourceType.localFile)
    })

    it('should transform websiteCrawl datasource correctly', () => {
      // Arrange
      const mockData = createMockExecutionLogResponse({
        datasource_type: DatasourceType.websiteCrawl,
        datasource_info: {
          content: 'Page content',
          description: 'Page description',
          source_url: 'https://example.com/page',
          title: 'Page Title',
        },
      })
      mockUsePipelineExecutionLog.mockReturnValue({
        data: mockData,
        isFetching: false,
        isError: false,
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert
      expect(screen.getByTestId('website-pages-count')).toHaveTextContent('1')
      expect(screen.getByTestId('local-files-count')).toHaveTextContent('0')
    })

    it('should transform onlineDocument datasource correctly', () => {
      // Arrange
      const mockData = createMockExecutionLogResponse({
        datasource_type: DatasourceType.onlineDocument,
        datasource_info: {
          workspace_id: 'workspace-1',
          page: { page_id: 'page-1', page_name: 'Notion Page' },
        },
      })
      mockUsePipelineExecutionLog.mockReturnValue({
        data: mockData,
        isFetching: false,
        isError: false,
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert
      expect(screen.getByTestId('online-documents-count')).toHaveTextContent('1')
    })

    it('should transform onlineDrive datasource correctly', () => {
      // Arrange
      const mockData = createMockExecutionLogResponse({
        datasource_type: DatasourceType.onlineDrive,
        datasource_info: { id: 'drive-1', type: 'doc', name: 'Google Doc', size: 1024 },
      })
      mockUsePipelineExecutionLog.mockReturnValue({
        data: mockData,
        isFetching: false,
        isError: false,
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert
      expect(screen.getByTestId('online-drive-files-count')).toHaveTextContent('1')
    })
  })

  // ==================== User Interactions - Process ====================
  describe('User Interactions - Process', () => {
    it('should trigger form submit when process button is clicked', async () => {
      // Arrange
      mockMutateAsync.mockResolvedValue({})
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      // Find the "Save and Process" button (from real ProcessDocuments > Actions)
      const processButton = screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' })
      fireEvent.click(processButton)

      // Assert
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled()
      })
    })

    it('should call handleProcess with is_preview=false', async () => {
      // Arrange
      mockMutateAsync.mockResolvedValue({})
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }))

      // Assert
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            is_preview: false,
            pipeline_id: mockPipelineId,
            original_document_id: 'document-456',
          }),
          expect.any(Object),
        )
      })
    })

    it('should navigate to documents list after successful process', async () => {
      // Arrange
      mockMutateAsync.mockImplementation((_request, options) => {
        options?.onSuccess?.()
        return Promise.resolve({})
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }))

      // Assert
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-123/documents')
      })
    })

    it('should invalidate document cache after successful process', async () => {
      // Arrange
      mockMutateAsync.mockImplementation((_request, options) => {
        options?.onSuccess?.()
        return Promise.resolve({})
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }))

      // Assert
      await waitFor(() => {
        expect(mockInvalidDocumentList).toHaveBeenCalled()
        expect(mockInvalidDocumentDetail).toHaveBeenCalled()
      })
    })
  })

  // ==================== User Interactions - Preview ====================
  describe('User Interactions - Preview', () => {
    it('should trigger preview when preview button is clicked', async () => {
      // Arrange
      mockMutateAsync.mockResolvedValue({ data: { outputs: {} } })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      fireEvent.click(screen.getByTestId('preview-btn'))

      // Assert
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled()
      })
    })

    it('should call handlePreviewChunks with is_preview=true', async () => {
      // Arrange
      mockMutateAsync.mockResolvedValue({ data: { outputs: {} } })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      fireEvent.click(screen.getByTestId('preview-btn'))

      // Assert
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            is_preview: true,
            pipeline_id: mockPipelineId,
          }),
          expect.any(Object),
        )
      })
    })

    it('should update estimateData on successful preview', async () => {
      // Arrange
      const mockOutputs = { chunks: [], total_tokens: 50 }
      mockMutateAsync.mockImplementation((_req, opts) => {
        opts?.onSuccess?.({ data: { outputs: mockOutputs } })
        return Promise.resolve({ data: { outputs: mockOutputs } })
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      fireEvent.click(screen.getByTestId('preview-btn'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('has-estimate-data')).toHaveTextContent('true')
      })
    })
  })

  // ==================== API Integration ====================
  describe('API Integration', () => {
    it('should pass correct parameters for preview', async () => {
      // Arrange
      const mockData = createMockExecutionLogResponse({
        datasource_type: DatasourceType.localFile,
        datasource_node_id: 'node-xyz',
        datasource_info: { related_id: 'file-1', name: 'test.pdf', extension: 'pdf' },
        input_data: {},
      })
      mockUsePipelineExecutionLog.mockReturnValue({
        data: mockData,
        isFetching: false,
        isError: false,
      })
      mockMutateAsync.mockResolvedValue({ data: { outputs: {} } })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      fireEvent.click(screen.getByTestId('preview-btn'))

      // Assert - inputs come from initialData which is transformed by useInitialData
      // Since usePublishedPipelineProcessingParams returns empty variables, inputs is {}
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          {
            pipeline_id: mockPipelineId,
            inputs: {},
            start_node_id: 'node-xyz',
            datasource_type: DatasourceType.localFile,
            datasource_info_list: [{ related_id: 'file-1', name: 'test.pdf', extension: 'pdf' }],
            is_preview: true,
          },
          expect.any(Object),
        )
      })
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it.each([
      [DatasourceType.localFile, 'local-files-count', '1'],
      [DatasourceType.websiteCrawl, 'website-pages-count', '1'],
      [DatasourceType.onlineDocument, 'online-documents-count', '1'],
      [DatasourceType.onlineDrive, 'online-drive-files-count', '1'],
    ])('should handle %s datasource type correctly', (datasourceType, testId, expectedCount) => {
      // Arrange
      const datasourceInfoMap: Record<DatasourceType, Record<string, unknown>> = {
        [DatasourceType.localFile]: { related_id: 'f1', name: 'file.pdf', extension: 'pdf' },
        [DatasourceType.websiteCrawl]: { content: 'c', description: 'd', source_url: 'u', title: 't' },
        [DatasourceType.onlineDocument]: { workspace_id: 'w1', page: { page_id: 'p1' } },
        [DatasourceType.onlineDrive]: { id: 'd1', type: 'doc', name: 'n', size: 100 },
      }

      const mockData = createMockExecutionLogResponse({
        datasource_type: datasourceType,
        datasource_info: datasourceInfoMap[datasourceType],
      })
      mockUsePipelineExecutionLog.mockReturnValue({
        data: mockData,
        isFetching: false,
        isError: false,
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert
      expect(screen.getByTestId(testId)).toHaveTextContent(expectedCount)
    })

    it('should show loading state during initial fetch', () => {
      // Arrange
      mockUsePipelineExecutionLog.mockReturnValue({
        data: undefined,
        isFetching: true,
        isError: false,
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert
      expect(screen.queryByTestId('process-form')).not.toBeInTheDocument()
    })

    it('should show error state when API fails', () => {
      // Arrange
      mockUsePipelineExecutionLog.mockReturnValue({
        data: undefined,
        isFetching: false,
        isError: true,
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert
      expect(screen.queryByTestId('process-form')).not.toBeInTheDocument()
    })
  })

  // ==================== State Management ====================
  describe('State Management', () => {
    it('should initialize with undefined estimateData', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)

      // Assert
      expect(screen.getByTestId('has-estimate-data')).toHaveTextContent('false')
    })

    it('should update estimateData after successful preview', async () => {
      // Arrange
      const mockEstimateData = { chunks: [], total_tokens: 50 }
      mockMutateAsync.mockImplementation((_req, opts) => {
        opts?.onSuccess?.({ data: { outputs: mockEstimateData } })
        return Promise.resolve({ data: { outputs: mockEstimateData } })
      })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      fireEvent.click(screen.getByTestId('preview-btn'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('has-estimate-data')).toHaveTextContent('true')
      })
    })

    it('should set isPreview ref to false when process is clicked', async () => {
      // Arrange
      mockMutateAsync.mockResolvedValue({})
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }))

      // Assert
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ is_preview: false }),
          expect.any(Object),
        )
      })
    })

    it('should set isPreview ref to true when preview is clicked', async () => {
      // Arrange
      mockMutateAsync.mockResolvedValue({ data: { outputs: {} } })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      fireEvent.click(screen.getByTestId('preview-btn'))

      // Assert
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ is_preview: true }),
          expect.any(Object),
        )
      })
    })

    it('should pass isPending=true to ChunkPreview when preview is pending', async () => {
      // Arrange - Start with isPending=false so buttons are enabled
      let isPendingState = false
      mockUseRunPublishedPipeline.mockImplementation(() => ({
        mutateAsync: mockMutateAsync,
        isIdle: !isPendingState,
        isPending: isPendingState,
      }))

      // A promise that never resolves to keep the pending state
      const pendingPromise = new Promise<void>(() => undefined)
      // When mutateAsync is called, set isPending to true and trigger rerender
      mockMutateAsync.mockImplementation(() => {
        isPendingState = true
        return pendingPromise
      })

      const props = createDefaultProps()
      const { rerender } = renderWithProviders(<PipelineSettings {...props} />)

      // Act - Click preview button (sets isPreview.current = true and calls mutateAsync)
      fireEvent.click(screen.getByTestId('preview-btn'))

      // Update mock and rerender to reflect isPending=true state
      mockUseRunPublishedPipeline.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isIdle: false,
        isPending: true,
      })
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <PipelineSettings {...props} />
        </QueryClientProvider>,
      )

      // Assert - isPending && isPreview.current should both be true now
      expect(screen.getByTestId('is-pending')).toHaveTextContent('true')
    })

    it('should pass isPending=false to ChunkPreview when process is pending (not preview)', async () => {
      // Arrange - isPending is true but isPreview.current is false
      mockUseRunPublishedPipeline.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isIdle: false,
        isPending: true,
      })
      mockMutateAsync.mockReturnValue(new Promise<void>(() => undefined))
      const props = createDefaultProps()

      // Act
      renderWithProviders(<PipelineSettings {...props} />)
      // Click process (not preview) to set isPreview.current = false
      fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }))

      // Assert - isPending && isPreview.current should be false (true && false = false)
      await waitFor(() => {
        expect(screen.getByTestId('is-pending')).toHaveTextContent('false')
      })
    })
  })
})
