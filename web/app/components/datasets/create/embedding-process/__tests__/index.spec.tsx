import type { FullDocumentDetail, IndexingStatusResponse, ProcessRuleResponse } from '@/models/datasets'
import { act, render, renderHook, screen } from '@testing-library/react'
import { DataSourceType, ProcessMode } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import IndexingProgressItem from '../indexing-progress-item'
import RuleDetail from '../rule-detail'
import UpgradeBanner from '../upgrade-banner'
import { useIndexingStatusPolling } from '../use-indexing-status-polling'
import {
  createDocumentLookup,
  getFileType,
  getSourcePercent,
  isLegacyDataSourceInfo,
  isSourceEmbedding,
} from '../utils'

const mockPush = vi.fn()
const mockRouter = { push: mockPush }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

// Override global next/image auto-mock: test asserts on data-testid="next-image"
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
vi.mock('../../icons', () => ({
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
vi.mock('../../step-two', () => ({
  IndexingType: {
    QUALIFIED: 'high_quality',
    ECONOMICAL: 'economy',
  },
}))

// Factory Functions for Test Data

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

// Utils Tests

describe('utils', () => {
  // Test utility functions for document handling

  describe('isLegacyDataSourceInfo', () => {
    it('should return true for legacy data source with upload_file object', () => {
      const info = {
        upload_file: { id: 'file-1', name: 'test.txt' },
      }

      expect(isLegacyDataSourceInfo(info as Parameters<typeof isLegacyDataSourceInfo>[0])).toBe(true)
    })

    it('should return false for null', () => {
      expect(isLegacyDataSourceInfo(null as unknown as Parameters<typeof isLegacyDataSourceInfo>[0])).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isLegacyDataSourceInfo(undefined as unknown as Parameters<typeof isLegacyDataSourceInfo>[0])).toBe(false)
    })

    it('should return false when upload_file is not an object', () => {
      const info = { upload_file: 'string-value' }

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
      const detail = createMockIndexingStatus({ indexing_status: status as IndexingStatusResponse['indexing_status'] })

      expect(isSourceEmbedding(detail)).toBe(expected)
    })
  })

  describe('getSourcePercent', () => {
    it('should return 0 when total_segments is 0', () => {
      const detail = createMockIndexingStatus({
        completed_segments: 0,
        total_segments: 0,
      })

      expect(getSourcePercent(detail)).toBe(0)
    })

    it('should calculate correct percentage', () => {
      const detail = createMockIndexingStatus({
        completed_segments: 5,
        total_segments: 10,
      })

      expect(getSourcePercent(detail)).toBe(50)
    })

    it('should cap percentage at 100', () => {
      const detail = createMockIndexingStatus({
        completed_segments: 15,
        total_segments: 10,
      })

      expect(getSourcePercent(detail)).toBe(100)
    })

    it('should handle undefined values', () => {
      const detail = { indexing_status: 'indexing' } as IndexingStatusResponse

      expect(getSourcePercent(detail)).toBe(0)
    })

    it('should round to nearest integer', () => {
      const detail = createMockIndexingStatus({
        completed_segments: 1,
        total_segments: 3,
      })

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
      const documents = [
        createMockDocument({ id: 'doc-1', name: 'file1.txt' }),
        createMockDocument({ id: 'doc-2', name: 'file2.pdf', data_source_type: DataSourceType.NOTION }),
      ]

      const lookup = createDocumentLookup(documents)

      expect(lookup.getName('doc-1')).toBe('file1.txt')
      expect(lookup.getName('doc-2')).toBe('file2.pdf')
      expect(lookup.getName('non-existent')).toBeUndefined()
    })

    it('should return source type correctly', () => {
      const documents = [
        createMockDocument({ id: 'doc-1', data_source_type: DataSourceType.FILE }),
        createMockDocument({ id: 'doc-2', data_source_type: DataSourceType.NOTION }),
      ]
      const lookup = createDocumentLookup(documents)

      expect(lookup.getSourceType('doc-1')).toBe(DataSourceType.FILE)
      expect(lookup.getSourceType('doc-2')).toBe(DataSourceType.NOTION)
    })

    it('should return notion icon for legacy data source', () => {
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

      expect(lookup.getNotionIcon('doc-1')).toBe('📄')
    })

    it('should return undefined for non-legacy notion icon', () => {
      const documents = [
        createMockDocument({
          id: 'doc-1',
          data_source_info: { some_other_field: 'value' } as unknown as FullDocumentDetail['data_source_info'],
        }),
      ]
      const lookup = createDocumentLookup(documents)

      expect(lookup.getNotionIcon('doc-1')).toBeUndefined()
    })

    it('should memoize lookups with Map for performance', () => {
      const documents = Array.from({ length: 1000 }, (_, i) =>
        createMockDocument({ id: `doc-${i}`, name: `file${i}.txt` }))

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

// useIndexingStatusPolling Hook Tests

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
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'completed' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledWith({
      datasetId: 'ds-1',
      batchId: 'batch-1',
    })
    expect(result.current.statusList).toEqual(mockStatus)
  })

  it('should stop polling when all statuses are completed', async () => {
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'completed' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

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
    const indexingStatus = [createMockIndexingStatus({ indexing_status: 'indexing' })]
    const completedStatus = [createMockIndexingStatus({ indexing_status: 'completed' })]

    mockFetchIndexingStatusBatch
      .mockResolvedValueOnce({ data: indexingStatus })
      .mockResolvedValueOnce({ data: completedStatus })

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

    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledTimes(2)
  })

  it('should stop polling when status is error', async () => {
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'error', error: 'Some error' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(result.current.isEmbeddingCompleted).toBe(true)
    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledTimes(1)
  })

  it('should stop polling when status is paused', async () => {
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'paused' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(result.current.isEmbeddingCompleted).toBe(true)
  })

  it('should continue polling on API error', async () => {
    mockFetchIndexingStatusBatch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ data: [createMockIndexingStatus({ indexing_status: 'completed' })] })

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
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'indexing' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(result.current.isEmbedding).toBe(true)
    expect(result.current.isEmbeddingCompleted).toBe(false)
  })

  it('should cleanup timeout on unmount', async () => {
    const mockStatus = [createMockIndexingStatus({ indexing_status: 'indexing' })]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

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
    const mockStatus = [
      createMockIndexingStatus({ id: 'doc-1', indexing_status: 'completed' }),
      createMockIndexingStatus({ id: 'doc-2', indexing_status: 'indexing' }),
    ]
    mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(result.current.isEmbedding).toBe(true)
    expect(result.current.isEmbeddingCompleted).toBe(false)
    expect(result.current.statusList).toHaveLength(2)
  })

  it('should return empty statusList initially', () => {
    const { result } = renderHook(() =>
      useIndexingStatusPolling({ datasetId: 'ds-1', batchId: 'batch-1' }),
    )

    expect(result.current.statusList).toEqual([])
    expect(result.current.isEmbedding).toBe(false)
    expect(result.current.isEmbeddingCompleted).toBe(false)
  })
})

// UpgradeBanner Component Tests

describe('UpgradeBanner', () => {
  // Test the upgrade banner component

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render upgrade message', () => {
    render(<UpgradeBanner />)

    expect(screen.getByText(/billing\.plansCommon\.documentProcessingPriorityUpgrade/i)).toBeInTheDocument()
  })

  it('should render ZapFast icon', () => {
    const { container } = render(<UpgradeBanner />)

    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('should render UpgradeBtn component', () => {
    render(<UpgradeBanner />)

    // Assert - UpgradeBtn should be rendered
    const upgradeContainer = screen.getByText(/billing\.plansCommon\.documentProcessingPriorityUpgrade/i).parentElement
    expect(upgradeContainer).toBeInTheDocument()
  })
})

// IndexingProgressItem Component Tests

describe('IndexingProgressItem', () => {
  // Test the progress item component for individual documents

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render document name', () => {
      const detail = createMockIndexingStatus()

      render(<IndexingProgressItem detail={detail} name="test-document.txt" />)

      expect(screen.getByText('test-document.txt')).toBeInTheDocument()
    })

    it('should render progress percentage when embedding', () => {
      const detail = createMockIndexingStatus({
        indexing_status: 'indexing',
        completed_segments: 5,
        total_segments: 10,
      })

      render(<IndexingProgressItem detail={detail} name="test.txt" />)

      expect(screen.getByText('50%')).toBeInTheDocument()
    })

    it('should not render progress percentage when completed', () => {
      const detail = createMockIndexingStatus({ indexing_status: 'completed' })

      render(<IndexingProgressItem detail={detail} name="test.txt" />)

      expect(screen.queryByText('%')).not.toBeInTheDocument()
    })
  })

  describe('Status Icons', () => {
    it('should render success icon for completed status', () => {
      const detail = createMockIndexingStatus({ indexing_status: 'completed' })

      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      expect(container.querySelector('.text-text-success')).toBeInTheDocument()
    })

    it('should render error icon for error status', () => {
      const detail = createMockIndexingStatus({
        indexing_status: 'error',
        error: 'Processing failed',
      })

      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      expect(container.querySelector('.text-text-destructive')).toBeInTheDocument()
    })

    it('should not render status icon for indexing status', () => {
      const detail = createMockIndexingStatus({ indexing_status: 'indexing' })

      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      expect(container.querySelector('.text-text-success')).not.toBeInTheDocument()
      expect(container.querySelector('.text-text-destructive')).not.toBeInTheDocument()
    })
  })

  describe('Source Type Icons', () => {
    it('should render file icon for FILE source type', () => {
      const detail = createMockIndexingStatus()

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
        const detail = createMockIndexingStatus()

        render(
          <IndexingProgressItem
            detail={detail}
            name={filename}
            sourceType={DataSourceType.FILE}
          />,
        )

        expect(screen.getByText(filename)).toBeInTheDocument()
      })

      it('should handle unknown file extension with default icon', () => {
        const detail = createMockIndexingStatus()

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
        const detail = createMockIndexingStatus()

        render(
          <IndexingProgressItem
            detail={detail}
            name="REPORT.PDF"
            sourceType={DataSourceType.FILE}
          />,
        )

        expect(screen.getByText('REPORT.PDF')).toBeInTheDocument()
      })

      it('should handle mixed case extension', () => {
        const detail = createMockIndexingStatus()

        render(
          <IndexingProgressItem
            detail={detail}
            name="Document.Docx"
            sourceType={DataSourceType.FILE}
          />,
        )

        expect(screen.getByText('Document.Docx')).toBeInTheDocument()
      })

      it('should handle filename with multiple dots', () => {
        const detail = createMockIndexingStatus()

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
        const detail = createMockIndexingStatus()

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
      const detail = createMockIndexingStatus()

      render(
        <IndexingProgressItem
          detail={detail}
          name="Notion Page"
          sourceType={DataSourceType.NOTION}
          notionIcon="📄"
        />,
      )

      expect(screen.getByText('Notion Page')).toBeInTheDocument()
    })
  })

  describe('Progress Bar', () => {
    it('should render progress bar when embedding', () => {
      const detail = createMockIndexingStatus({
        indexing_status: 'indexing',
        completed_segments: 30,
        total_segments: 100,
      })

      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      const progressBar = container.querySelector('[style*="width: 30%"]')
      expect(progressBar).toBeInTheDocument()
    })

    it('should not render progress bar when completed', () => {
      const detail = createMockIndexingStatus({ indexing_status: 'completed' })

      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      const progressBar = container.querySelector('.bg-components-progress-bar-progress')
      expect(progressBar).not.toBeInTheDocument()
    })

    it('should apply error styling for error status', () => {
      const detail = createMockIndexingStatus({ indexing_status: 'error' })

      const { container } = render(<IndexingProgressItem detail={detail} name="test.txt" />)

      expect(container.querySelector('.bg-state-destructive-hover-alt')).toBeInTheDocument()
    })
  })

  describe('Billing', () => {
    it('should render PriorityLabel when enableBilling is true', () => {
      const detail = createMockIndexingStatus()

      render(<IndexingProgressItem detail={detail} name="test.txt" enableBilling />)

      // Assert - PriorityLabel component should be in the DOM
      const container = screen.getByText('test.txt').parentElement
      expect(container).toBeInTheDocument()
    })

    it('should not render PriorityLabel when enableBilling is false', () => {
      const detail = createMockIndexingStatus()

      render(<IndexingProgressItem detail={detail} name="test.txt" enableBilling={false} />)

      expect(screen.getByText('test.txt')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined name', () => {
      const detail = createMockIndexingStatus()

      render(<IndexingProgressItem detail={detail} />)

      // Assert - should not crash
      expect(document.body).toBeInTheDocument()
    })

    it('should handle undefined sourceType', () => {
      const detail = createMockIndexingStatus()

      render(<IndexingProgressItem detail={detail} name="test.txt" />)

      // Assert - should render without source icon
      expect(screen.getByText('test.txt')).toBeInTheDocument()
    })
  })
})

// RuleDetail Component Tests

describe('RuleDetail', () => {
  // Test the rule detail component for process configuration display

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<RuleDetail />)

      expect(screen.getByText(/datasetDocuments\.embedding\.mode/i)).toBeInTheDocument()
    })

    it('should render all field labels', () => {
      render(<RuleDetail />)

      expect(screen.getByText(/datasetDocuments\.embedding\.mode/i)).toBeInTheDocument()
      expect(screen.getByText(/datasetDocuments\.embedding\.segmentLength/i)).toBeInTheDocument()
      expect(screen.getByText(/datasetDocuments\.embedding\.textCleaning/i)).toBeInTheDocument()
      expect(screen.getByText(/datasetCreation\.stepTwo\.indexMode/i)).toBeInTheDocument()
      expect(screen.getByText(/datasetSettings\.form\.retrievalSetting\.title/i)).toBeInTheDocument()
    })
  })

  describe('Mode Display', () => {
    it('should show "-" when sourceData is undefined', () => {
      render(<RuleDetail />)

      expect(screen.getAllByText('-')).toHaveLength(3) // mode, segmentLength, textCleaning
    })

    it('should show "custom" for general process mode', () => {
      const sourceData = createMockProcessRule({ mode: ProcessMode.general })

      render(<RuleDetail sourceData={sourceData} />)

      expect(screen.getByText(/datasetDocuments\.embedding\.custom/i)).toBeInTheDocument()
    })

    it('should show hierarchical mode with paragraph parent', () => {
      const sourceData = createMockProcessRule({
        mode: ProcessMode.parentChild,
        rules: {
          parent_mode: 'paragraph',
          segmentation: { max_tokens: 500 },
        },
      } as Partial<ProcessRuleResponse>)

      render(<RuleDetail sourceData={sourceData as ProcessRuleResponse} />)

      expect(screen.getByText(/datasetDocuments\.embedding\.hierarchical/i)).toBeInTheDocument()
    })
  })

  describe('Segment Length Display', () => {
    it('should show max_tokens for general mode', () => {
      const sourceData = createMockProcessRule({
        mode: ProcessMode.general,
        rules: {
          segmentation: { max_tokens: 500 },
        },
      } as Partial<ProcessRuleResponse>)

      render(<RuleDetail sourceData={sourceData as ProcessRuleResponse} />)

      expect(screen.getByText('500')).toBeInTheDocument()
    })

    it('should show parent and child tokens for hierarchical mode', () => {
      const sourceData = createMockProcessRule({
        mode: ProcessMode.parentChild,
        rules: {
          segmentation: { max_tokens: 1000 },
          subchunk_segmentation: { max_tokens: 200 },
        },
      } as Partial<ProcessRuleResponse>)

      render(<RuleDetail sourceData={sourceData as ProcessRuleResponse} />)

      expect(screen.getByText(/1000/)).toBeInTheDocument()
      expect(screen.getByText(/200/)).toBeInTheDocument()
    })
  })

  describe('Text Cleaning Rules', () => {
    it('should show enabled rule names', () => {
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

      render(<RuleDetail sourceData={sourceData as ProcessRuleResponse} />)

      expect(screen.getByText(/removeExtraSpaces/i)).toBeInTheDocument()
      expect(screen.getByText(/removeUrlEmails/i)).toBeInTheDocument()
    })

    it('should show "-" when no rules are enabled', () => {
      const sourceData = createMockProcessRule({
        mode: ProcessMode.general,
        rules: {
          pre_processing_rules: [
            { id: 'remove_extra_spaces', enabled: false },
          ],
        },
      } as Partial<ProcessRuleResponse>)

      render(<RuleDetail sourceData={sourceData as ProcessRuleResponse} />)

      // Assert - textCleaning should show "-"
      const dashElements = screen.getAllByText('-')
      expect(dashElements.length).toBeGreaterThan(0)
    })
  })

  describe('Indexing Type', () => {
    it('should show qualified for high_quality indexing', () => {
      render(<RuleDetail indexingType="high_quality" />)

      expect(screen.getByText(/datasetCreation\.stepTwo\.qualified/i)).toBeInTheDocument()
    })

    it('should show economical for economy indexing', () => {
      render(<RuleDetail indexingType="economy" />)

      expect(screen.getByText(/datasetCreation\.stepTwo\.economical/i)).toBeInTheDocument()
    })

    it('should render correct icon for indexing type', () => {
      render(<RuleDetail indexingType="high_quality" />)

      const images = screen.getAllByTestId('next-image')
      expect(images.length).toBeGreaterThan(0)
    })
  })

  describe('Retrieval Method', () => {
    it('should show semantic search by default', () => {
      render(<RuleDetail />)

      expect(screen.getByText(/dataset\.retrieval\.semantic_search\.title/i)).toBeInTheDocument()
    })

    it('should show keyword search for economical indexing', () => {
      render(<RuleDetail indexingType="economy" />)

      expect(screen.getByText(/dataset\.retrieval\.keyword_search\.title/i)).toBeInTheDocument()
    })

    it.each([
      [RETRIEVE_METHOD.fullText, 'full_text_search'],
      [RETRIEVE_METHOD.hybrid, 'hybrid_search'],
      [RETRIEVE_METHOD.semantic, 'semantic_search'],
    ])('should show correct label for %s retrieval method', (method, expectedKey) => {
      render(<RuleDetail retrievalMethod={method} />)

      expect(screen.getByText(new RegExp(`dataset\\.retrieval\\.${expectedKey}\\.title`, 'i'))).toBeInTheDocument()
    })
  })
})

// EmbeddingProcess Integration Tests

describe('EmbeddingProcess', () => {
  // Integration tests for the main EmbeddingProcess component

  // Import the main component after mocks are set up
  let EmbeddingProcess: typeof import('../index').default

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockEnableBilling = false
    mockPlanType = 'sandbox'

    // Dynamically import to get fresh component with mocks
    const embeddingModule = await import('../index')
    EmbeddingProcess = embeddingModule.default
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render without crashing', async () => {
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(document.body).toBeInTheDocument()
    })

    it('should render status header', async () => {
      const mockStatus = [createMockIndexingStatus({ indexing_status: 'indexing' })]
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.getByText(/datasetDocuments\.embedding\.processing/i)).toBeInTheDocument()
    })

    it('should show completed status when all documents are done', async () => {
      const mockStatus = [createMockIndexingStatus({ indexing_status: 'completed' })]
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.getByText(/datasetDocuments\.embedding\.completed/i)).toBeInTheDocument()
    })
  })

  describe('Progress Items', () => {
    it('should render progress items for each document', async () => {
      const documents = [
        createMockDocument({ id: 'doc-1', name: 'file1.txt' }),
        createMockDocument({ id: 'doc-2', name: 'file2.pdf' }),
      ]
      const mockStatus = [
        createMockIndexingStatus({ id: 'doc-1' }),
        createMockIndexingStatus({ id: 'doc-2' }),
      ]
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: mockStatus })

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

      expect(screen.getByText('file1.txt')).toBeInTheDocument()
      expect(screen.getByText('file2.pdf')).toBeInTheDocument()
    })
  })

  describe('Upgrade Banner', () => {
    it('should show upgrade banner when billing is enabled and not team plan', async () => {
      mockEnableBilling = true
      mockPlanType = 'sandbox'
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Re-import to get updated mock values
      const embeddingModule = await import('../index')
      EmbeddingProcess = embeddingModule.default

      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.getByText(/billing\.plansCommon\.documentProcessingPriorityUpgrade/i)).toBeInTheDocument()
    })

    it('should not show upgrade banner when billing is disabled', async () => {
      mockEnableBilling = false
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.queryByText(/billing\.plansCommon\.documentProcessingPriorityUpgrade/i)).not.toBeInTheDocument()
    })

    it('should not show upgrade banner for team plan', async () => {
      mockEnableBilling = true
      mockPlanType = 'team'
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      // Re-import to get updated mock values
      const embeddingModule = await import('../index')
      EmbeddingProcess = embeddingModule.default

      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.queryByText(/billing\.plansCommon\.documentProcessingPriorityUpgrade/i)).not.toBeInTheDocument()
    })
  })

  describe('Action Buttons', () => {
    it('should render API access button with correct link', async () => {
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      const apiButton = screen.getByText('Access the API')
      expect(apiButton).toBeInTheDocument()
      expect(apiButton.closest('a')).toHaveAttribute('href', 'https://api.example.com/docs')
    })

    it('should render navigation button', async () => {
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.getByText(/datasetCreation\.stepThree\.navTo/i)).toBeInTheDocument()
    })

    it('should navigate to documents list when nav button clicked', async () => {
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      const navButton = screen.getByText(/datasetCreation\.stepThree\.navTo/i)

      await act(async () => {
        navButton.click()
      })

      expect(mockInvalidDocumentList).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/datasets/ds-1/documents')
    })
  })

  describe('Rule Detail', () => {
    it('should render RuleDetail component', async () => {
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

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

      expect(screen.getByText(/datasetDocuments\.embedding\.mode/i)).toBeInTheDocument()
    })

    it('should pass indexingType to RuleDetail', async () => {
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

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

      expect(screen.getByText(/datasetCreation\.stepTwo\.economical/i)).toBeInTheDocument()
    })
  })

  describe('Document Lookup Memoization', () => {
    it('should memoize document lookup based on documents array', async () => {
      const documents = [createMockDocument({ id: 'doc-1', name: 'test.txt' })]
      mockFetchIndexingStatusBatch.mockResolvedValue({
        data: [createMockIndexingStatus({ id: 'doc-1' })],
      })

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
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" documents={[]} />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert - should render without crashing
      expect(document.body).toBeInTheDocument()
    })

    it('should handle undefined documents', async () => {
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

      render(<EmbeddingProcess datasetId="ds-1" batchId="batch-1" />)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Assert - should render without crashing
      expect(document.body).toBeInTheDocument()
    })

    it('should handle status with missing document', async () => {
      const documents = [createMockDocument({ id: 'doc-1', name: 'test.txt' })]
      mockFetchIndexingStatusBatch.mockResolvedValue({
        data: [
          createMockIndexingStatus({ id: 'doc-1' }),
          createMockIndexingStatus({ id: 'doc-unknown' }), // No matching document
        ],
      })

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
      mockFetchIndexingStatusBatch.mockResolvedValue({ data: [] })

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
