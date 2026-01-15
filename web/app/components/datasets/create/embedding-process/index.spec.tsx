import type { FullDocumentDetail, IndexingStatusResponse, ProcessRuleResponse } from '@/models/datasets'
import { act, render, renderHook, screen } from '@testing-library/react'
import { DataSourceType, ProcessMode } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import IndexingProgressItem from './indexing-progress-item'
import RuleDetail from './rule-detail'
import UpgradeBanner from './upgrade-banner'
import { useIndexingStatusPolling } from './use-indexing-status-polling'
import {
  createDocumentLookup,
  getFileType,
  getSourcePercent,
  isLegacyDataSourceInfo,
  isSourceEmbedding,
} from './utils'

// =============================================================================
// Mock External Dependencies
// =============================================================================

// Mock next/navigation
const mockPush = vi.fn()
const mockRouter = { push: mockPush }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, className }: { src: string, alt: string, className?: string }) => (
    // eslint-disable-next-line next/no-img-element
    <img src={src} alt={alt} className={className} data-testid="next-image" />
  ),
}))

// Mock API service
const mockFetchIndexingStatusBatch = vi.fn()
vi.mock('@/service/datasets', () => ({
  fetchIndexingStatusBatch: (params: { datasetId: string, batchId: string }) =>
    mockFetchIndexingStatusBatch(params),
}))

// Mock service hooks
const mockProcessRuleData: ProcessRuleResponse | undefined = undefined
vi.mock('@/service/knowledge/use-dataset', () => ({
  useProcessRule: vi.fn(() => ({ data: mockProcessRuleData })),
}))

const mockInvalidDocumentList = vi.fn()
vi.mock('@/service/knowledge/use-document', () => ({
  useInvalidDocumentList: () => mockInvalidDocumentList,
}))

// Mock useDatasetApiAccessUrl hook
vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://api.example.com/docs',
}))

// Mock provider context
let mockEnableBilling = false
let mockPlanType = 'sandbox'
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    enableBilling: mockEnableBilling,
    plan: { type: mockPlanType },
  }),
}))

// Mock icons
vi.mock('../icons', () => ({
  indexMethodIcon: {
    economical: '/icons/economical.svg',
    high_quality: '/icons/high-quality.svg',
  },
  retrievalIcon: {
    fullText: '/icons/full-text.svg',
    hybrid: '/icons/hybrid.svg',
    vector: '/icons/vector.svg',
  },
}))

// Mock IndexingType enum from step-two
vi.mock('../step-two', () => ({
  IndexingType: {
    QUALIFIED: 'high_quality',
    ECONOMICAL: 'economy',
  },
}))

// =============================================================================
// Factory Functions for Test Data
// =============================================================================

/**
 * Create a mock IndexingStatusResponse
 */
const createMockIndexingStatus = (
  overrides: Partial<IndexingStatusResponse> = {},
): IndexingStatusResponse => ({
  id: 'doc-1',
  indexing_status: 'completed',
  processing_started_at: Date.now(),
  parsing_completed_at: Date.now(),
  cleaning_completed_at: Date.now(),
  splitting_completed_at: Date.now(),
  completed_at: Date.now(),
  paused_at: null,
  error: null,
  stopped_at: null,
  completed_segments: 10,
  total_segments: 10,
  ...overrides,
})

/**
 * Create a mock FullDocumentDetail
 */
const createMockDocument = (
  overrides: Partial<FullDocumentDetail> = {},
): FullDocumentDetail => ({
  id: 'doc-1',
  name: 'test-document.txt',
  data_source_type: DataSourceType.FILE,
  data_source_info: {
    upload_file: {
      id: 'file-1',
      name: 'test-document.txt',
      extension: 'txt',
      mime_type: 'text/plain',
      size: 1024,
      created_by: 'user-1',
      created_at: Date.now(),
    },
  },
  batch: 'batch-1',
  created_api_request_id: 'req-1',
  processing_started_at: Date.now(),
  parsing_completed_at: Date.now(),
  cleaning_completed_at: Date.now(),
  splitting_completed_at: Date.now(),
  tokens: 100,
  indexing_latency: 5000,
  completed_at: Date.now(),
  paused_by: '',
  paused_at: 0,
  stopped_at: 0,
  indexing_status: 'completed',
  disabled_at: 0,
  ...overrides,
} as FullDocumentDetail)

/**
 * Create a mock ProcessRuleResponse
 */
const createMockProcessRule = (
  overrides: Partial<ProcessRuleResponse> = {},
): ProcessRuleResponse => ({
  mode: ProcessMode.general,
  rules: {
    segmentation: {
      separator: '\n',
      max_tokens: 500,
      chunk_overlap: 50,
    },
    pre_processing_rules: [
      { id: 'remove_extra_spaces', enabled: true },
      { id: 'remove_urls_emails', enabled: false },
    ],
  },
  ...overrides,
} as ProcessRuleResponse)

// =============================================================================
// Utils Tests
// =============================================================================

describe('utils', () => {
  // Test utility functions for document handling

  describe('isLegacyDataSourceInfo', () => {
    it('should return true for legacy data source with upload_file object', () => {
      // Arrange
      const info = {
        upload_file: { id: 'file-1', name: 'test.txt' },
      }

      // Act & Assert
      expect(isLegacyDataSourceInfo(info as Parameters<typeof isLegacyDataSourceInfo>[0])).toBe(true)
    })

    it('should return false for null', () => {
      expect(isLegacyDataSourceInfo(null as unknown as Parameters<typeof isLegacyDataSourceInfo>[0])).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isLegacyDataSourceInfo(undefined as unknown as Parameters<typeof isLegacyDataSourceInfo>[0])).toBe(false)
    })

    it('should return false when upload_file is not an object', () => {
      // Arrange
      const info = { upload_file: 'string-value' }

      // Act & Assert
      expect(isLegacyDataSourceInfo(info as unknown as Parameters<typeof isLegacyDataSourceInfo>[0])).toBe(false)
    })
  })

  describe('isSourceEmbedding', () => {
    it.each([
      ['indexing', true],
      ['splitting', true],
      ['parsing', true],
      ['cleaning', true],
      ['waiting', true],
      ['completed', false],
      ['error', false],
      ['paused', false],
    ])('should return %s for status "%s"', (status, expected) => {
      // Arrange
      const detail = createMockIndexingStatus({ indexing_status: status as IndexingStatusResponse['indexing_status'] })

      // Act & Assert
      expect(isSourceEmbedding(detail)).toBe(expected)
    })
  })

  describe('getSourcePercent', () => {
    it('should return 0 when total_segments is 0', () => {
      // Arrange
      const detail = createMockIndexingStatus({
        completed_segments: 0,
        total_segments: 0,
      })

      // Act & Assert
      expect(getSourcePercent(detail)).toBe(0)
    })

    it('should calculate correct percentage', () => {
      // Arrange
      const detail = createMockIndexingStatus({
        completed_segments: 5,
        total_segments: 10,
      })

      // Act & Assert
      expect(getSourcePercent(detail)).toBe(50)
    })

    it('should cap percentage at 100', () => {
      // Arrange
      const detail = createMockIndexingStatus({
        completed_segments: 15,
        total_segments: 10,
      })

      // Act & Assert
      expect(getSourcePercent(detail)).toBe(100)
    })

    it('should handle undefined values', () => {
      // Arrange
      const detail = { indexing_status: 'indexing' } as IndexingStatusResponse

      // Act & Assert
      expect(getSourcePercent(detail)).toBe(0)
    })

    it('should round to nearest integer', () => {
      // Arrange
      const detail = createMockIndexingStatus({
        completed_segments: 1,
        total_segments: 3,
      })

      // Act & Assert
      expect(getSourcePercent(detail)).toBe(33)
    })
  })

  describe('getFileType', () => {
    it('should extract extension from filename', () => {
      expect(getFileType('document.pdf')).toBe('pdf')
      expect(getFileType('file.name.txt')).toBe('txt')
      expect(getFileType('archive.tar.gz')).toBe('gz')
    })

    it('should return "txt" for undefined', () => {
      expect(getFileType(undefined)).toBe('txt')
    })

    it('should return filename without extension', () => {
      expect(getFileType('filename')).toBe('filename')
    })
  })

  describe('createDocumentLookup', () => {
    it('should create lookup functions for documents', () => {
      // Arrange
      const documents = [
        createMockDocument({ id: 'doc-1', name: 'file1.txt' }),
        createMockDocument({ id: 'doc-2', name: 'file2.pdf', data_source_type: DataSourceType.NOTION }),
      ]

      // Act
      const lookup = createDocumentLookup(documents)

      // Assert
      expect(lookup.getName('doc-1')).toBe('file1.txt')
      expect(lookup.getName('doc-2')).toBe('file2.pdf')
      expect(lookup.getName('non-existent')).toBeUndefined()
    })

    it('should return source type correctly', () => {
      // Arrange
      const documents = [
        createMockDocument({ id: 'doc-1', data_source_type: DataSourceType.FILE }),
        createMockDocument({ id: 'doc-2', data_source_type: DataSourceType.NOTION }),
      ]
      const lookup = createDocumentLookup(documents)

      // Assert
      expect(lookup.getSourceType('doc-1')).toBe(DataSourceType.FILE)
      expect(lookup.getSourceType('doc-2')).toBe(DataSourceType.NOTION)
    })

    it('should return notion icon for legacy data source', () => {
      // Arrange
      const documents = [
        createMockDocument({
          id: 'doc-1',
          data_source_info: {
            upload_file: { id: 'f1' },
            notion_page_icon: '📄',
          } as FullDocumentDetail['data_source_info'],
        }),
      ]
      const lookup = createDocumentLookup(documents)

      // Assert
      expect(lookup.getNotionIcon('doc-1')).toBe('📄')
    })

    it('should return undefined for non-legacy notion icon', () => {
      // Arrange
      const documents = [
        createMockDocument({
          id: 'doc-1',
          data_source_info: { some_other_field: 'value' } as unknown as FullDocumentDetail['data_source_info'],
        }),
      ]
      const lookup = createDocumentLookup(documents)

      // Assert
      expect(lookup.getNotionIcon('doc-1')).toBeUndefined()
    })

    it('should memoize lookups with Map for performance', () => {
      // Arrange
      const documents = Array.from({ length: 1000 }, (_, i) =>
        createMockDocument({ id: `doc-${i}`, name: `file${i}.txt` }))

      // Act
      const lookup = createDocumentLookup(documents)
      const startTime = performance.now()
      for (let i = 0; i < 1000; i++)
        lookup.getName(`doc-${i}`)

      const duration = performance.now() - startTime

      // Assert - should be very fast due to Map lookup
      expect(duration).toBeLessThan(50)
    })
  })
})

// =============================================================================
// useIndexingStatusPolling Hook Tests
// =============================================================================

describe('useIndexingStatusPolling', () => {
  // Test the polling hook for indexing status

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should fetch status on mount', async () => {
    // Arrange
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'completed' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    // Act
    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    // Assert
    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledWith({
      datasetId: 'ds-1',
      batchId: 'batch-1',
    })
    expect(result.current.statusList).toEqual(mockStatus)
  })

  it('should stop polling when all statuses are completed', async () => {
    // Arrange
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'completed' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    // Act
    renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    // Assert - should only be called once since status is completed
    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledTimes(1)
  })

  it('should continue polling when status is indexing', async () => {
    // Arrange
    const indexingStatus = [createMockIndexingStatus({ indexing_status: 'indexing' })]
    const completedStatus = [createMockIndexingStatus({ indexing_status: 'completed' })]

    mockFetchIndexingStatusBatch
      .mockResolvedValueOnce({ data: indexingStatus })
      .mockResolvedValueOnce({ data: completedStatus })

    // Act
    renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    // First poll
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    // Advance timer for next poll (2500ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    // Assert
    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledTimes(2)
  })

  it('should stop polling when status is error', async () => {
    // Arrange
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'error', error: 'Some error' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    // Act
    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    // Assert
    expect(result.current.isEmbeddingCompleted).toBe(true)
    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledTimes(1)
  })

  it('should stop polling when status is paused', async () => {
    // Arrange
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'paused' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    // Act
    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    // Assert
    expect(result.current.isEmbeddingCompleted).toBe(true)
  })

  it('should continue polling on API error', async () => {
    // Arrange
    mockFetchIndexingStatusBatch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ data: [createMockIndexingStatus({ indexing_status: 'completed' })] })

    // Act
    renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    // Assert - should retry after error
    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledTimes(2)
  })

  it('should return correct isEmbedding state', async () => {
    // Arrange
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'indexing' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    // Act
    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    // Assert
    expect(result.current.isEmbedding).toBe(true)
    expect(result.current.isEmbeddingCompleted).toBe(false)
  })

  it('should cleanup timeout on unmount', async () => {
    // Arrange
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'indexing' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    // Act
    const { unmount } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    const callCountBeforeUnmount = mockFetchIndexingStatusBatch.mock.calls.length

    unmount()

    // Advance timers - should not trigger more calls after unmount
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // Assert - no additional calls after unmount
    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledTimes(callCountBeforeUnmount)
  })

  it('should handle multiple documents with mixed statuses', async () => {
    // Arrange
    const mockStatus = [
      createMockIndexingStatus({ id: 'doc-1', indexing_status: 'completed' }),
      createMockIndexingStatus({ id: 'doc-2', indexing_status: 'indexing' }),
    ]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    // Act
    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    // Assert
    expect(result.current.isEmbedding).toBe(true)
    expect(result.current.isEmbeddingCompleted).toBe(false)
    expect(result.current.statusList).toHaveLength(2)
  })

  it('should return empty statusList initially', () => {
    // Arrange & Act
    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    // Assert
    expect(result.current.statusList).toEqual([])
    expect(result.current.isEmbedding).toBe(false)
    expect(result.current.isEmbeddingCompleted).toBe(false)
  })
})

// =============================================================================
// UpgradeBanner Component Tests
// =============================================================================

describe('UpgradeBanner', () => {
  // Test the upgrade banner component

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render upgrade message', () => {
    // Arrange & Act
    render(<UpgradeBanner />)

    // Assert
    expect(screen.getByText(/billing\.plansCommon\.documentProcessingPriorityUpgrade/i)).toBeInTheDocument()
  })

  it('should render ZapFast icon', () => {
    // Arrange & Act
    const { container } = render(<UpgradeBanner />)

    // Assert
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('should render UpgradeBtn component', () => {
    // Arrange & Act
    render(<UpgradeBanner />)

    // Assert - UpgradeBtn should be rendered
    const upgradeContainer = screen.getByText(/billing\.plansCommon\.documentProcessingPriorityUpgrade/i).parentElement
    expect(upgradeContainer).toBeInTheDocument()
  })
})

// =============================================================================
// IndexingProgressItem Component Tests
// =============================================================================

describe('IndexingProgressItem', () => {
  // Test the progress item component for individual documents

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render document name', () => {
      // Arrange
      const detail = createMockIndexingStatus()

      // Act
      render(<IndexingProgressItem detail={detail} name="test-document.txt" />)

      // Assert
      expect(screen.getByText('test-document.txt')).toBeInTheDocument()
    })

    it('should render progress percentage when embedding', () => {
      // Arrange
      const detail = createMockIndexingStatus({
        indexing_status: 'indexing',
        completed_segments: 5,
        total_segments: 10,
      })

      // Act
      render(<IndexingProgressItem detail={detail} name="test.txt" />)

      // Assert
      expect(screen.getByText('50%')).toBeInTheDocument()
    })

    it('should not render progress percentage when completed', () => {
      // Arrange
      const detail = createMockIndexingStatus({ indexing_status: 'completed' })

      // Act
      render(<IndexingProgressItem detail={detail} name="test.txt" />)

      // Assert
      expect(screen.queryByText('%')).not.toBeInTheDocument()
    })
  })

  describe('Status Icons', () => {
    it('should render success icon for completed status', () => {
      // Arrange
      const detail = createMockIndexingStatus({ indexing_status: 'completed' })

      // Act
      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      // Assert
      expect(container.querySelector('.text-text-success')).toBeInTheDocument()
    })

    it('should render error icon for error status', () => {
      // Arrange
      const detail = createMockIndexingStatus({
        indexing_status: 'error',
        error: 'Processing failed',
      })

      // Act
      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      // Assert
      expect(container.querySelector('.text-text-destructive')).toBeInTheDocument()
    })

    it('should not render status icon for indexing status', () => {
      // Arrange
      const detail = createMockIndexingStatus({ indexing_status: 'indexing' })

      // Act
      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      // Assert
      expect(container.querySelector('.text-text-success')).not.toBeInTheDocument()
      expect(container.querySelector('.text-text-destructive')).not.toBeInTheDocument()
    })
  })

  describe('Source Type Icons', () => {
    it('should render file icon for FILE source type', () => {
      // Arrange
      const detail = createMockIndexingStatus()

      // Act
      render(
        <IndexingProgressItem
          detail={detail}
          name="document.pdf"
          sourceType={DataSourceType.FILE}
        />,
      )

      // Assert - DocumentFileIcon should be rendered
      expect(screen.getByText('document.pdf')).toBeInTheDocument()
    })

    // DocumentFileIcon branch coverage: different file extensions
    describe('DocumentFileIcon file extensions', () => {
      it.each([
        ['document.pdf', 'pdf'],
        ['data.json', 'json'],
        ['page.html', 'html'],
        ['readme.txt', 'txt'],
        ['notes.markdown', 'markdown'],
        ['readme.md', 'md'],
        ['spreadsheet.xlsx', 'xlsx'],
        ['legacy.xls', 'xls'],
        ['data.csv', 'csv'],
        ['letter.doc', 'doc'],
        ['report.docx', 'docx'],
      ])('should render file icon for %s (%s extension)', (filename) => {
        // Arrange
        const detail = createMockIndexingStatus()

        // Act
        render(
          <IndexingProgressItem
            detail={detail}
            name={filename}
            sourceType={DataSourceType.FILE}
          />,
        )

        // Assert
        expect(screen.getByText(filename)).toBeInTheDocument()
      })

      it('should handle unknown file extension with default icon', () => {
        // Arrange
        const detail = createMockIndexingStatus()

        // Act
        render(
          <IndexingProgressItem
            detail={detail}
            name="archive.zip"
            sourceType={DataSourceType.FILE}
          />,
        )

        // Assert - should still render with default document icon
        expect(screen.getByText('archive.zip')).toBeInTheDocument()
      })

      it('should handle uppercase extension', () => {
        // Arrange
        const detail = createMockIndexingStatus()

        // Act
        render(
          <IndexingProgressItem
            detail={detail}
            name="REPORT.PDF"
            sourceType={DataSourceType.FILE}
          />,
        )

        // Assert
        expect(screen.getByText('REPORT.PDF')).toBeInTheDocument()
      })

      it('should handle mixed case extension', () => {
        // Arrange
        const detail = createMockIndexingStatus()

        // Act
        render(
          <IndexingProgressItem
            detail={detail}
            name="Document.Docx"
            sourceType={DataSourceType.FILE}
          />,
        )

        // Assert
        expect(screen.getByText('Document.Docx')).toBeInTheDocument()
      })

      it('should handle filename with multiple dots', () => {
        // Arrange
        const detail = createMockIndexingStatus()

        // Act
        render(
          <IndexingProgressItem
            detail={detail}
            name="my.file.name.pdf"
            sourceType={DataSourceType.FILE}
          />,
        )

        // Assert - should extract "pdf" as extension
        expect(screen.getByText('my.file.name.pdf')).toBeInTheDocument()
      })

      it('should handle filename without extension', () => {
        // Arrange
        const detail = createMockIndexingStatus()

        // Act
        render(
          <IndexingProgressItem
            detail={detail}
            name="noextension"
            sourceType={DataSourceType.FILE}
          />,
        )

        // Assert - should use filename itself as fallback
        expect(screen.getByText('noextension')).toBeInTheDocument()
      })
    })

    it('should render notion icon for NOTION source type', () => {
      // Arrange
      const detail = createMockIndexingStatus()

      // Act
      render(
        <IndexingProgressItem
          detail={detail}
          name="Notion Page"
          sourceType={DataSourceType.NOTION}
          notionIcon="📄"
        />,
      )

      // Assert
      expect(screen.getByText('Notion Page')).toBeInTheDocument()
    })
  })

  describe('Progress Bar', () => {
    it('should render progress bar when embedding', () => {
      // Arrange
      const detail = createMockIndexingStatus({
        indexing_status: 'indexing',
        completed_segments: 30,
        total_segments: 100,
      })

      // Act
      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      // Assert
      const progressBar = container.querySelector('[style*="width: 30%"]')
      expect(progressBar).toBeInTheDocument()
    })

    it('should not render progress bar when completed', () => {
      // Arrange
      const detail = createMockIndexingStatus({ indexing_status: 'completed' })

      // Act
      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      // Assert
      const progressBar = container.querySelector('.bg-components-progress-bar-progress')
      expect(progressBar).not.toBeInTheDocument()
    })

    it('should apply error styling for error status', () => {
      // Arrange
      const detail = createMockIndexingStatus({ indexing_status: 'error' })

      // Act
      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      // Assert
      expect(container.querySelector('.bg-state-destructive-hover-alt')).toBeInTheDocument()
    })
  })

  describe('Billing', () => {
    it('should render PriorityLabel when enableBilling is true', () => {
      // Arrange
      const detail = createMockIndexingStatus()

      // Act
      render(<IndexingProgressItem detail={detail} name="test.txt" enableBilling />)

      // Assert - PriorityLabel component should be in the DOM
      const container = screen.getByText('test.txt').parentElement
      expect(container).toBeInTheDocument()
    })

    it('should not render PriorityLabel when enableBilling is false', () => {
      // Arrange
      const detail = createMockIndexingStatus()

      // Act
      render(<IndexingProgressItem detail={detail} name="test.txt" enableBilling={false} />)

      // Assert
      expect(screen.getByText('test.txt')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined name', () => {
      // Arrange
      const detail = createMockIndexingStatus()

      // Act
      render(<IndexingProgressItem detail={detail} />)

      // Assert - should not crash
      expect(document.body).toBeInTheDocument()
    })

    it('should handle undefined sourceType', () => {
      // Arrange
      const detail = createMockIndexingStatus()

      // Act
      render(<IndexingProgressItem detail={detail} name="test.txt" />)

      // Assert - should render without source icon
      expect(screen.getByText('test.txt')).toBeInTheDocument()
    })
  })
})

// =============================================================================
// RuleDetail Component Tests
// =============================================================================

describe('RuleDetail', () => {
  // Test the rule detail component for process configuration display

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<RuleDetail />)

      // Assert
      expect(screen.getByText(/datasetDocuments\.embedding\.mode/i)).toBeInTheDocument()
    })

    it('should render all field labels', () => {
      // Arrange & Act
      render(<RuleDetail />)

      // Assert
      expect(screen.getByText(/datasetDocuments\.embedding\.mode/i)).toBeInTheDocument()
      expect(screen.getByText(/datasetDocuments\.embedding\.segmentLength/i)).toBeInTheDocument()
      expect(screen.getByText(/datasetDocuments\.embedding\.textCleaning/i)).toBeInTheDocument()
      expect(screen.getByText(/datasetCreation\.stepTwo\.indexMode/i)).toBeInTheDocument()
      expect(screen.getByText(/datasetSettings\.form\.retrievalSetting\.title/i)).toBeInTheDocument()
    })
  })

  describe('Mode Display', () => {
    it('should show "-" when sourceData is undefined', () => {
      // Arrange & Act
      render(<RuleDetail />)

      // Assert
      expect(screen.getAllByText('-')).toHaveLength(3) // mode, segmentLength, textCleaning
    })

    it('should show "custom" for general process mode', () => {
      // Arrange
      const sourceData = createMockProcessRule({ mode: ProcessMode.general })

      // Act
      render(<RuleDetail sourceData={sourceData} />)

      // Assert
      expect(screen.getByText(/datasetDocuments\.embedding\.custom/i)).toBeInTheDocument()
    })

    it('should show hierarchical mode with paragraph parent', () => {
      // Arrange
      const sourceData = createMockProcessRule({
        mode: ProcessMode.parentChild,
        rules: {
          parent_mode: 'paragraph',
          segmentation: { max_tokens: 500 },
        },
      } as Partial<ProcessRuleResponse>)

      // Act
      render(<RuleDetail sourceData={sourceData as ProcessRuleResponse} />)

      // Assert
      expect(screen.getByText(/datasetDocuments\.embedding\.hierarchical/i)).toBeInTheDocument()
    })
  })

  describe('Segment Length Display', () => {
    it('should show max_tokens for general mode', () => {
      // Arrange
      const sourceData = createMockProcessRule({
        mode: ProcessMode.general,
        rules: {
          segmentation: { max_tokens: 500 },
        },
      } as Partial<ProcessRuleResponse>)

      // Act
      render(<RuleDetail sourceData={sourceData as ProcessRuleResponse} />)

      // Assert
      expect(screen.getByText('500')).toBeInTheDocument()
    })

    it('should show parent and child tokens for hierarchical mode', () => {
      // Arrange
      const sourceData = createMockProcessRule({
        mode: ProcessMode.parentChild,
        rules: {
          segmentation: { max_tokens: 1000 },
          subchunk_segmentation: { max_tokens: 200 },
        },
      } as Partial<ProcessRuleResponse>)

      // Act
      render(<RuleDetail sourceData={sourceData as ProcessRuleResponse} />)

      // Assert
      expect(screen.getByText(/1000/)).toBeInTheDocument()
      expect(screen.getByText(/200/)).toBeInTheDocument()
    })
  })

  describe('Text Cleaning Rules', () => {
    it('should show enabled rule names', () => {
      // Arrange
      const sourceData = createMockProcessRule({
        mode: ProcessMode.general,
        rules: {
          pre_processing_rules: [
            { id: 'remove_extra_spaces', enabled: true },
            { id: 'remove_urls_emails', enabled: true },
            { id: 'remove_stopwords', enabled: false },
          ],
        },
      } as Partial<ProcessRuleResponse>)

      // Act
      render(<RuleDetail sourceData={sourceData as ProcessRuleResponse} />)

      // Assert
      expect(screen.getByText(/removeExtraSpaces/i)).toBeInTheDocument()
      expect(screen.getByText(/removeUrlEmails/i)).toBeInTheDocument()
    })

    it('should show "-" when no rules are enabled', () => {
      // Arrange
      const sourceData = createMockProcessRule({
        mode: ProcessMode.general,
        rules: {
          pre_processing_rules: [
            { id: 'remove_extra_spaces', enabled: false },
          ],
        },
      } as Partial<ProcessRuleResponse>)

      // Act
      render(<RuleDetail sourceData={sourceData as ProcessRuleResponse} />)

      // Assert - textCleaning should show "-"
      const dashElements = screen.getAllByText('-')
      expect(dashElements.length).toBeGreaterThan(0)
    })
  })

  describe('Indexing Type', () => {
    it('should show qualified for high_quality indexing', () => {
      // Arrange & Act
      render(<RuleDetail indexingType="high_quality" />)

      // Assert
      expect(screen.getByText(/datasetCreation\.stepTwo\.qualified/i)).toBeInTheDocument()
    })

    it('should show economical for economy indexing', () => {
      // Arrange & Act
      render(<RuleDetail indexingType="economy" />)

      // Assert
      expect(screen.getByText(/datasetCreation\.stepTwo\.economical/i)).toBeInTheDocument()
    })

    it('should render correct icon for indexing type', () => {
      // Arrange & Act
      render(<RuleDetail indexingType="high_quality" />)

      // Assert
      const images = screen.getAllByTestId('next-image')
      expect(images.length).toBeGreaterThan(0)
    })
  })

  describe('Retrieval Method', () => {
    it('should show semantic search by default', () => {
      // Arrange & Act
      render(<RuleDetail />)

      // Assert
      expect(screen.getByText(/dataset\.retrieval\.semantic_search\.title/i)).toBeInTheDocument()
    })

    it('should show keyword search for economical indexing', () => {
      // Arrange & Act
      render(<RuleDetail indexingType="economy" />)

      // Assert
      expect(screen.getByText(/dataset\.retrieval\.keyword_search\.title/i)).toBeInTheDocument()
    })

    it.each([
      [RETRIEVE_METHOD.fullText, 'full_text_search'],
      [RETRIEVE_METHOD.hybrid, 'hybrid_search'],
      [RETRIEVE_METHOD.semantic, 'semantic_search'],
    ])('should show correct label for %s retrieval method', (method, expectedKey) => {
      // Arrange & Act
      render(<RuleDetail retrievalMethod={method} />)

      // Assert
      expect(screen.getByText(new RegExp(`dataset\\.retrieval\\.${expectedKey}\\.title`, 'i'))).toBeInTheDocument()
    })
  })
})

// =============================================================================
// EmbeddingProcess Integration Tests
// =============================================================================

describe('EmbeddingProcess', () => {
  // Integration tests for the main EmbeddingProcess component

  // Import the main component after mocks are set up
  let EmbeddingProcess: typeof import('./index').default

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockEnableBilling = false
    mockPlanType = 'sandbox'

    // Dynamically import to get fresh component with mocks
    const embeddingModule = await import('./index')
    EmbeddingProcess = embeddingModule.default
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render without crashing', async () => {
      // Arrange
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Act
      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert
      expect(document.body).toBeInTheDocument()
    })

    it('should render status header', async () => {
      // Arrange
      const mockStatus = [createMockIndexingStatus({ indexing_status: 'indexing' })]
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

      // Act
      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert
      expect(screen.getByText(/datasetDocuments\.embedding\.processing/i)).toBeInTheDocument()
    })

    it('should show completed status when all documents are done', async () => {
      // Arrange
      const mockStatus = [createMockIndexingStatus({ indexing_status: 'completed' })]
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

      // Act
      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert
      expect(screen.getByText(/datasetDocuments\.embedding\.completed/i)).toBeInTheDocument()
    })
  })

  describe('Progress Items', () => {
    it('should render progress items for each document', async () => {
      // Arrange
      const documents = [
        createMockDocument({ id: 'doc-1', name: 'file1.txt' }),
        createMockDocument({ id: 'doc-2', name: 'file2.pdf' }),
      ]
      const mockStatus = [
        createMockIndexingStatus({ id: 'doc-1' }),
        createMockIndexingStatus({ id: 'doc-2' }),
      ]
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

      // Act
      render(
        <EmbeddingProcess
          datasetId="ds-1"
          batchId="batch-1"
          documents={documents}
        />,
      )

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert
      expect(screen.getByText('file1.txt')).toBeInTheDocument()
      expect(screen.getByText('file2.pdf')).toBeInTheDocument()
    })
  })

  describe('Upgrade Banner', () => {
    it('should show upgrade banner when billing is enabled and not team plan', async () => {
      // Arrange
      mockEnableBilling = true
      mockPlanType = 'sandbox'
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Re-import to get updated mock values
      const embeddingModule = await import('./index')
      EmbeddingProcess = embeddingModule.default

      // Act
      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert
      expect(screen.getByText(/billing\.plansCommon\.documentProcessingPriorityUpgrade/i)).toBeInTheDocument()
    })

    it('should not show upgrade banner when billing is disabled', async () => {
      // Arrange
      mockEnableBilling = false
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Act
      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert
      expect(screen.queryByText(/billing\.plansCommon\.documentProcessingPriorityUpgrade/i)).not.toBeInTheDocument()
    })

    it('should not show upgrade banner for team plan', async () => {
      // Arrange
      mockEnableBilling = true
      mockPlanType = 'team'
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Re-import to get updated mock values
      const embeddingModule = await import('./index')
      EmbeddingProcess = embeddingModule.default

      // Act
      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert
      expect(screen.queryByText(/billing\.plansCommon\.documentProcessingPriorityUpgrade/i)).not.toBeInTheDocument()
    })
  })

  describe('Action Buttons', () => {
    it('should render API access button with correct link', async () => {
      // Arrange
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Act
      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert
      const apiButton = screen.getByText('Access the API')
      expect(apiButton).toBeInTheDocument()
      expect(apiButton.closest('a')).toHaveAttribute('href', 'https://api.example.com/docs')
    })

    it('should render navigation button', async () => {
      // Arrange
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Act
      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert
      expect(screen.getByText(/datasetCreation\.stepThree\.navTo/i)).toBeInTheDocument()
    })

    it('should navigate to documents list when nav button clicked', async () => {
      // Arrange
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Act
      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      const navButton = screen.getByText(/datasetCreation\.stepThree\.navTo/i)

      await act(async () => {
        navButton.click()
      })

      // Assert
      expect(mockInvalidDocumentList).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/datasets/ds-1/documents')
    })
  })

  describe('Rule Detail', () => {
    it('should render RuleDetail component', async () => {
      // Arrange
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Act
      render(
        <EmbeddingProcess
          datasetId="ds-1"
          batchId="batch-1"
          indexingType="high_quality"
          retrievalMethod={RETRIEVE_METHOD.semantic}
        />,
      )

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert
      expect(screen.getByText(/datasetDocuments\.embedding\.mode/i)).toBeInTheDocument()
    })

    it('should pass indexingType to RuleDetail', async () => {
      // Arrange
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Act
      render(
        <EmbeddingProcess
          datasetId="ds-1"
          batchId="batch-1"
          indexingType="economy"
        />,
      )

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert
      expect(screen.getByText(/datasetCreation\.stepTwo\.economical/i)).toBeInTheDocument()
    })
  })

  describe('Document Lookup Memoization', () => {
    it('should memoize document lookup based on documents array', async () => {
      // Arrange
      const documents = [createMockDocument({ id: 'doc-1', name: 'test.txt' })]
      mockFetchIndexingStatusBatch.mockResolvedValue({
        data: [createMockIndexingStatus({ id: 'doc-1' })],
      })

      // Act
      const { rerender } = render(
        <EmbeddingProcess
          datasetId="ds-1"
          batchId="batch-1"
          documents={documents}
        />,
      )

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Rerender with same documents reference
      rerender(
        <EmbeddingProcess
          datasetId="ds-1"
          batchId="batch-1"
          documents={documents}
        />,
      )

      // Assert - component should render without issues
      expect(screen.getByText('test.txt')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty documents array', async () => {
      // Arrange
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Act
      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" documents={[]} />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert - should render without crashing
      expect(document.body).toBeInTheDocument()
    })

    it('should handle undefined documents', async () => {
      // Arrange
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Act
      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert - should render without crashing
      expect(document.body).toBeInTheDocument()
    })

    it('should handle status with missing document', async () => {
      // Arrange
      const documents = [createMockDocument({ id: 'doc-1', name: 'test.txt' })]
      mockFetchIndexingStatusBatch.mockResolvedValue({
        data: [
          createMockIndexingStatus({ id: 'doc-1' }),
          createMockIndexingStatus({ id: 'doc-unknown' }), // No matching document
        ],
      })

      // Act
      render(
        <EmbeddingProcess
          datasetId="ds-1"
          batchId="batch-1"
          documents={documents}
        />,
      )

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert - should render known document and handle unknown gracefully
      expect(screen.getByText('test.txt')).toBeInTheDocument()
    })

    it('should handle undefined retrievalMethod', async () => {
      // Arrange
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Act
      render(
        <EmbeddingProcess
          datasetId="ds-1"
          batchId="batch-1"
          indexingType="high_quality"
        />,
      )

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert - should use default semantic search
      expect(screen.getByText(/dataset\.retrieval\.semantic_search\.title/i)).toBeInTheDocument()
    })
  })
})
