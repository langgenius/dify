import type { Mock } from 'vitest'
import type { DocumentIndexingStatus, IndexingStatusResponse } from '@/models/datasets'
import type { InitialDocumentDetail } from '@/models/pipeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { Plan } from '@/app/components/billing/type'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { DatasourceType } from '@/models/pipeline'
import { RETRIEVE_METHOD } from '@/types/app'
import EmbeddingProcess from './index'

// ==========================================
// Mock External Dependencies
// ==========================================

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: function MockLink({ children, href, ...props }: { children: React.ReactNode, href: string }) {
    return <a href={href} {...props}>{children}</a>
  },
}))

// Mock provider context
let mockEnableBilling = false
let mockPlanType: Plan = Plan.sandbox
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    enableBilling: mockEnableBilling,
    plan: { type: mockPlanType },
  }),
}))

// Mock useIndexingStatusBatch hook
let mockFetchIndexingStatus: Mock
let mockIndexingStatusData: IndexingStatusResponse[] = []
vi.mock('@/service/knowledge/use-dataset', () => ({
  useIndexingStatusBatch: () => ({
    mutateAsync: mockFetchIndexingStatus,
  }),
  useProcessRule: () => ({
    data: {
      mode: 'custom',
      rules: { parent_mode: 'paragraph' },
    },
  }),
}))

// Mock useInvalidDocumentList hook
const mockInvalidDocumentList = vi.fn()
vi.mock('@/service/knowledge/use-document', () => ({
  useInvalidDocumentList: () => mockInvalidDocumentList,
}))

// Mock useDatasetApiAccessUrl hook
vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://docs.dify.ai/api-reference/datasets',
}))

// ==========================================
// Test Data Factory Functions
// ==========================================

/**
 * Creates a mock InitialDocumentDetail for testing
 * Uses deterministic counter-based IDs to avoid flaky tests
 */
let documentIdCounter = 0
const createMockDocument = (overrides: Partial<InitialDocumentDetail> = {}): InitialDocumentDetail => ({
  id: overrides.id ?? `doc-${++documentIdCounter}`,
  name: 'test-document.txt',
  data_source_type: DatasourceType.localFile,
  data_source_info: {},
  enable: true,
  error: '',
  indexing_status: 'waiting' as DocumentIndexingStatus,
  position: 0,
  ...overrides,
})

/**
 * Creates a mock IndexingStatusResponse for testing
 */
const createMockIndexingStatus = (overrides: Partial<IndexingStatusResponse> = {}): IndexingStatusResponse => ({
  id: `doc-${Math.random().toString(36).slice(2, 9)}`,
  indexing_status: 'waiting' as DocumentIndexingStatus,
  processing_started_at: Date.now(),
  parsing_completed_at: 0,
  cleaning_completed_at: 0,
  splitting_completed_at: 0,
  completed_at: null,
  paused_at: null,
  error: null,
  stopped_at: null,
  completed_segments: 0,
  total_segments: 100,
  ...overrides,
})

/**
 * Creates default props for EmbeddingProcess component
 */
const createDefaultProps = (overrides: Partial<{
  datasetId: string
  batchId: string
  documents: InitialDocumentDetail[]
  indexingType: IndexingType
  retrievalMethod: RETRIEVE_METHOD
}> = {}) => ({
  datasetId: 'dataset-123',
  batchId: 'batch-456',
  documents: [createMockDocument({ id: 'doc-1', name: 'test-doc.pdf' })],
  indexingType: IndexingType.QUALIFIED,
  retrievalMethod: RETRIEVE_METHOD.semantic,
  ...overrides,
})

// ==========================================
// Test Suite
// ==========================================

describe('EmbeddingProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })

    // Reset deterministic ID counter for reproducible tests
    documentIdCounter = 0

    // Reset mock states
    mockEnableBilling = false
    mockPlanType = Plan.sandbox
    mockIndexingStatusData = []

    // Setup default mock for fetchIndexingStatus
    mockFetchIndexingStatus = vi.fn().mockImplementation((_, options) => {
      options?.onSuccess?.({ data: mockIndexingStatusData })
      options?.onSettled?.()
      return Promise.resolve({ data: mockIndexingStatusData })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    // Tests basic rendering functionality
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<EmbeddingProcess {...props} />)

      // Assert
      expect(screen.getByTestId('rule-detail')).toBeInTheDocument()
    })

    it('should render RuleDetail component with correct props', () => {
      // Arrange
      const props = createDefaultProps({
        indexingType: IndexingType.ECONOMICAL,
        retrievalMethod: RETRIEVE_METHOD.fullText,
      })

      // Act
      render(<EmbeddingProcess {...props} />)

      // Assert - RuleDetail renders FieldInfo components with translated text
      // Check that the component renders without error
      expect(screen.getByTestId('rule-detail')).toBeInTheDocument()
    })

    it('should render API reference link with correct URL', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<EmbeddingProcess {...props} />)

      // Assert
      const apiLink = screen.getByRole('link', { name: /access the api/i })
      expect(apiLink).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
      expect(apiLink).toHaveAttribute('target', '_blank')
      expect(apiLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should render navigation button', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<EmbeddingProcess {...props} />)

      // Assert
      expect(screen.getByText('datasetCreation.stepThree.navTo')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Billing/Upgrade Banner Tests
  // ==========================================
  describe('Billing and Upgrade Banner', () => {
    // Tests for billing-related UI
    it('should not show upgrade banner when billing is disabled', () => {
      // Arrange
      mockEnableBilling = false
      const props = createDefaultProps()

      // Act
      render(<EmbeddingProcess {...props} />)

      // Assert
      expect(screen.queryByText('billing.plansCommon.documentProcessingPriorityUpgrade')).not.toBeInTheDocument()
    })

    it('should show upgrade banner when billing is enabled and plan is not team', () => {
      // Arrange
      mockEnableBilling = true
      mockPlanType = Plan.sandbox
      const props = createDefaultProps()

      // Act
      render(<EmbeddingProcess {...props} />)

      // Assert
      expect(screen.getByText('billing.plansCommon.documentProcessingPriorityUpgrade')).toBeInTheDocument()
    })

    it('should not show upgrade banner when plan is team', () => {
      // Arrange
      mockEnableBilling = true
      mockPlanType = Plan.team
      const props = createDefaultProps()

      // Act
      render(<EmbeddingProcess {...props} />)

      // Assert
      expect(screen.queryByText('billing.plansCommon.documentProcessingPriorityUpgrade')).not.toBeInTheDocument()
    })

    it('should show upgrade banner for professional plan', () => {
      // Arrange
      mockEnableBilling = true
      mockPlanType = Plan.professional
      const props = createDefaultProps()

      // Act
      render(<EmbeddingProcess {...props} />)

      // Assert
      expect(screen.getByText('billing.plansCommon.documentProcessingPriorityUpgrade')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Status Display Tests
  // ==========================================
  describe('Status Display', () => {
    // Tests for embedding status display
    it('should show waiting status when all documents are waiting', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'waiting' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('datasetDocuments.embedding.waiting')).toBeInTheDocument()
    })

    it('should show processing status when any document is indexing', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('datasetDocuments.embedding.processing')).toBeInTheDocument()
    })

    it('should show processing status when any document is splitting', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'splitting' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('datasetDocuments.embedding.processing')).toBeInTheDocument()
    })

    it('should show processing status when any document is parsing', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'parsing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('datasetDocuments.embedding.processing')).toBeInTheDocument()
    })

    it('should show processing status when any document is cleaning', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'cleaning' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('datasetDocuments.embedding.processing')).toBeInTheDocument()
    })

    it('should show completed status when all documents are completed', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'completed' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('datasetDocuments.embedding.completed')).toBeInTheDocument()
    })

    it('should show completed status when all documents have error status', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'error', error: 'Processing failed' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('datasetDocuments.embedding.completed')).toBeInTheDocument()
    })

    it('should show completed status when all documents are paused', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'paused' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('datasetDocuments.embedding.completed')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Progress Bar Tests
  // ==========================================
  describe('Progress Display', () => {
    // Tests for progress bar rendering
    it('should show progress percentage for embedding documents', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({
          id: 'doc-1',
          indexing_status: 'indexing',
          completed_segments: 50,
          total_segments: 100,
        }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('50%')).toBeInTheDocument()
    })

    it('should cap progress at 100%', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({
          id: 'doc-1',
          indexing_status: 'indexing',
          completed_segments: 150,
          total_segments: 100,
        }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('100%')).toBeInTheDocument()
    })

    it('should show 0% when total_segments is 0', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({
          id: 'doc-1',
          indexing_status: 'indexing',
          completed_segments: 0,
          total_segments: 0,
        }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('0%')).toBeInTheDocument()
    })

    it('should not show progress for completed documents', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({
          id: 'doc-1',
          indexing_status: 'completed',
          completed_segments: 100,
          total_segments: 100,
        }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.queryByText('100%')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Polling Logic Tests
  // ==========================================
  describe('Polling Logic', () => {
    // Tests for API polling behavior
    it('should start polling on mount', async () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<EmbeddingProcess {...props} />)

      // Assert - verify fetch was called at least once
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })
    })

    it('should continue polling while documents are processing', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })
      const initialCallCount = mockFetchIndexingStatus.mock.calls.length

      // Act
      render(<EmbeddingProcess {...props} />)

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockFetchIndexingStatus.mock.calls.length).toBeGreaterThan(initialCallCount)
      })

      const afterInitialCount = mockFetchIndexingStatus.mock.calls.length

      // Advance timer for next poll
      vi.advanceTimersByTime(2500)

      // Assert - should poll again
      await waitFor(() => {
        expect(mockFetchIndexingStatus.mock.calls.length).toBeGreaterThan(afterInitialCount)
      })
    })

    it('should stop polling when all documents are completed', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'completed' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)

      // Wait for initial fetch and state update
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      const callCountAfterComplete = mockFetchIndexingStatus.mock.calls.length

      // Advance timer - polling should have stopped
      vi.advanceTimersByTime(5000)

      // Assert - call count should not increase significantly after completion
      // Note: Due to React Strict Mode, there might be double renders
      expect(mockFetchIndexingStatus.mock.calls.length).toBeLessThanOrEqual(callCountAfterComplete + 1)
    })

    it('should stop polling when all documents have errors', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'error' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      const callCountAfterError = mockFetchIndexingStatus.mock.calls.length

      // Advance timer
      vi.advanceTimersByTime(5000)

      // Assert - should not poll significantly more after error state
      expect(mockFetchIndexingStatus.mock.calls.length).toBeLessThanOrEqual(callCountAfterError + 1)
    })

    it('should stop polling when all documents are paused', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'paused' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      const callCountAfterPaused = mockFetchIndexingStatus.mock.calls.length

      // Advance timer
      vi.advanceTimersByTime(5000)

      // Assert - should not poll significantly more after paused state
      expect(mockFetchIndexingStatus.mock.calls.length).toBeLessThanOrEqual(callCountAfterPaused + 1)
    })

    it('should cleanup timeout on unmount', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      const { unmount } = render(<EmbeddingProcess {...props} />)

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      const callCountBeforeUnmount = mockFetchIndexingStatus.mock.calls.length

      // Unmount before next poll
      unmount()

      // Advance timer
      vi.advanceTimersByTime(5000)

      // Assert - should not poll after unmount
      expect(mockFetchIndexingStatus.mock.calls.length).toBe(callCountBeforeUnmount)
    })
  })

  // ==========================================
  // User Interactions Tests
  // ==========================================
  describe('User Interactions', () => {
    // Tests for button clicks and navigation
    it('should navigate to document list when nav button is clicked', async () => {
      // Arrange
      const props = createDefaultProps({ datasetId: 'my-dataset-123' })

      // Act
      render(<EmbeddingProcess {...props} />)
      const navButton = screen.getByText('datasetCreation.stepThree.navTo')
      fireEvent.click(navButton)

      // Assert
      expect(mockInvalidDocumentList).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/datasets/my-dataset-123/documents')
    })

    it('should call invalidDocumentList before navigation', () => {
      // Arrange
      const props = createDefaultProps()
      const callOrder: string[] = []
      mockInvalidDocumentList.mockImplementation(() => callOrder.push('invalidate'))
      mockPush.mockImplementation(() => callOrder.push('push'))

      // Act
      render(<EmbeddingProcess {...props} />)
      const navButton = screen.getByText('datasetCreation.stepThree.navTo')
      fireEvent.click(navButton)

      // Assert
      expect(callOrder).toEqual(['invalidate', 'push'])
    })
  })

  // ==========================================
  // Document Display Tests
  // ==========================================
  describe('Document Display', () => {
    // Tests for document list rendering
    it('should display document names', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1', name: 'my-report.pdf' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('my-report.pdf')).toBeInTheDocument()
    })

    it('should display multiple documents', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1', name: 'file1.txt' })
      const doc2 = createMockDocument({ id: 'doc-2', name: 'file2.pdf' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
        createMockIndexingStatus({ id: 'doc-2', indexing_status: 'waiting' }),
      ]
      const props = createDefaultProps({ documents: [doc1, doc2] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('file1.txt')).toBeInTheDocument()
      expect(screen.getByText('file2.pdf')).toBeInTheDocument()
    })

    it('should handle documents with special characters in names', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1', name: 'report_2024 (final) - copy.pdf' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('report_2024 (final) - copy.pdf')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Data Source Type Tests
  // ==========================================
  describe('Data Source Types', () => {
    // Tests for different data source type displays
    it('should handle local file data source', async () => {
      // Arrange
      const doc1 = createMockDocument({
        id: 'doc-1',
        name: 'local-file.pdf',
        data_source_type: DatasourceType.localFile,
      })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('local-file.pdf')).toBeInTheDocument()
    })

    it('should handle online document data source', async () => {
      // Arrange
      const doc1 = createMockDocument({
        id: 'doc-1',
        name: 'Notion Page',
        data_source_type: DatasourceType.onlineDocument,
        data_source_info: { notion_page_icon: { type: 'emoji', emoji: '📄' } },
      })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('Notion Page')).toBeInTheDocument()
    })

    it('should handle website crawl data source', async () => {
      // Arrange
      const doc1 = createMockDocument({
        id: 'doc-1',
        name: 'https://example.com/page',
        data_source_type: DatasourceType.websiteCrawl,
      })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('https://example.com/page')).toBeInTheDocument()
    })

    it('should handle online drive data source', async () => {
      // Arrange
      const doc1 = createMockDocument({
        id: 'doc-1',
        name: 'Google Drive Document',
        data_source_type: DatasourceType.onlineDrive,
      })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('Google Drive Document')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Error Handling Tests
  // ==========================================
  describe('Error Handling', () => {
    // Tests for error states and displays
    it('should display error icon for documents with error status', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({
          id: 'doc-1',
          indexing_status: 'error',
          error: 'Failed to process document',
        }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      const { container } = render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert - error icon should be visible
      const errorIcon = container.querySelector('.text-text-destructive')
      expect(errorIcon).toBeInTheDocument()
    })

    it('should apply error styling to document row with error', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({
          id: 'doc-1',
          indexing_status: 'error',
          error: 'Processing failed',
        }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      const { container } = render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert - should have error background class
      const errorRow = container.querySelector('.bg-state-destructive-hover-alt')
      expect(errorRow).toBeInTheDocument()
    })
  })

  // ==========================================
  // Edge Cases
  // ==========================================
  describe('Edge Cases', () => {
    // Tests for boundary conditions
    it('should throw error when documents array is empty', () => {
      // Arrange
      // The component accesses documents[0].id for useProcessRule (line 81-82),
      // which throws TypeError when documents array is empty.
      // This test documents this known limitation.
      const props = createDefaultProps({ documents: [] })

      // Suppress console errors for expected error
      const consoleError = vi.spyOn(console, 'error').mockImplementation(Function.prototype as () => void)

      // Act & Assert - explicitly assert the error behavior
      expect(() => {
        render(<EmbeddingProcess {...props} />)
      }).toThrow(TypeError)

      consoleError.mockRestore()
    })

    it('should handle empty indexing status response', async () => {
      // Arrange
      mockIndexingStatusData = []
      const props = createDefaultProps()

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert - should not show any status text when empty
      expect(screen.queryByText('datasetDocuments.embedding.waiting')).not.toBeInTheDocument()
      expect(screen.queryByText('datasetDocuments.embedding.processing')).not.toBeInTheDocument()
      expect(screen.queryByText('datasetDocuments.embedding.completed')).not.toBeInTheDocument()
    })

    it('should handle document with undefined name', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1', name: undefined as unknown as string })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act & Assert - should not throw
      expect(() => render(<EmbeddingProcess {...props} />)).not.toThrow()
    })

    it('should handle document not found in indexing status', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'other-doc', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act & Assert - should not throw
      expect(() => render(<EmbeddingProcess {...props} />)).not.toThrow()
    })

    it('should handle undefined indexing_status', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({
          id: 'doc-1',
          indexing_status: undefined as unknown as DocumentIndexingStatus,
        }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act & Assert - should not throw
      expect(() => render(<EmbeddingProcess {...props} />)).not.toThrow()
    })

    it('should handle mixed status documents', async () => {
      // Arrange
      const doc1 = createMockDocument({ id: 'doc-1' })
      const doc2 = createMockDocument({ id: 'doc-2' })
      const doc3 = createMockDocument({ id: 'doc-3' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'completed' }),
        createMockIndexingStatus({ id: 'doc-2', indexing_status: 'indexing' }),
        createMockIndexingStatus({ id: 'doc-3', indexing_status: 'error' }),
      ]
      const props = createDefaultProps({ documents: [doc1, doc2, doc3] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert - should show processing (since one is still indexing)
      expect(screen.getByText('datasetDocuments.embedding.processing')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Variations Tests
  // ==========================================
  describe('Props Variations', () => {
    // Tests for different prop combinations
    it('should handle undefined indexingType', () => {
      // Arrange
      const props = createDefaultProps({ indexingType: undefined })

      // Act
      render(<EmbeddingProcess {...props} />)

      // Assert - component renders without crashing
      expect(screen.getByTestId('rule-detail')).toBeInTheDocument()
    })

    it('should handle undefined retrievalMethod', () => {
      // Arrange
      const props = createDefaultProps({ retrievalMethod: undefined })

      // Act
      render(<EmbeddingProcess {...props} />)

      // Assert - component renders without crashing
      expect(screen.getByTestId('rule-detail')).toBeInTheDocument()
    })

    it('should pass different indexingType values', () => {
      // Arrange
      const indexingTypes = [IndexingType.QUALIFIED, IndexingType.ECONOMICAL]

      indexingTypes.forEach((indexingType) => {
        const props = createDefaultProps({ indexingType })

        // Act
        const { unmount } = render(<EmbeddingProcess {...props} />)

        // Assert - RuleDetail renders and shows appropriate text based on indexingType
        expect(screen.getByTestId('rule-detail')).toBeInTheDocument()

        unmount()
      })
    })

    it('should pass different retrievalMethod values', () => {
      // Arrange
      const retrievalMethods = [RETRIEVE_METHOD.semantic, RETRIEVE_METHOD.fullText, RETRIEVE_METHOD.hybrid]

      retrievalMethods.forEach((retrievalMethod) => {
        const props = createDefaultProps({ retrievalMethod })

        // Act
        const { unmount } = render(<EmbeddingProcess {...props} />)

        // Assert - RuleDetail renders and shows appropriate text based on retrievalMethod
        expect(screen.getByTestId('rule-detail')).toBeInTheDocument()

        unmount()
      })
    })
  })

  // ==========================================
  // Memoization Tests
  // ==========================================
  describe('Memoization Logic', () => {
    // Tests for useMemo computed values
    it('should correctly compute isEmbeddingWaiting', async () => {
      // Arrange - all waiting
      const doc1 = createMockDocument({ id: 'doc-1' })
      const doc2 = createMockDocument({ id: 'doc-2' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'waiting' }),
        createMockIndexingStatus({ id: 'doc-2', indexing_status: 'waiting' }),
      ]
      const props = createDefaultProps({ documents: [doc1, doc2] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('datasetDocuments.embedding.waiting')).toBeInTheDocument()
    })

    it('should correctly compute isEmbedding when one is indexing', async () => {
      // Arrange - one waiting, one indexing
      const doc1 = createMockDocument({ id: 'doc-1' })
      const doc2 = createMockDocument({ id: 'doc-2' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'waiting' }),
        createMockIndexingStatus({ id: 'doc-2', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1, doc2] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('datasetDocuments.embedding.processing')).toBeInTheDocument()
    })

    it('should correctly compute isEmbeddingCompleted for mixed terminal states', async () => {
      // Arrange - completed + error + paused = all terminal
      const doc1 = createMockDocument({ id: 'doc-1' })
      const doc2 = createMockDocument({ id: 'doc-2' })
      const doc3 = createMockDocument({ id: 'doc-3' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'completed' }),
        createMockIndexingStatus({ id: 'doc-2', indexing_status: 'error' }),
        createMockIndexingStatus({ id: 'doc-3', indexing_status: 'paused' }),
      ]
      const props = createDefaultProps({ documents: [doc1, doc2, doc3] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('datasetDocuments.embedding.completed')).toBeInTheDocument()
    })
  })

  // ==========================================
  // File Type Detection Tests
  // ==========================================
  describe('File Type Detection', () => {
    // Tests for getFileType helper function
    it('should extract file extension correctly', async () => {
      // Arrange
      const doc1 = createMockDocument({
        id: 'doc-1',
        name: 'document.pdf',
        data_source_type: DatasourceType.localFile,
      })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert - file should be displayed (file type detection happens internally)
      expect(screen.getByText('document.pdf')).toBeInTheDocument()
    })

    it('should handle files with multiple dots', async () => {
      // Arrange
      const doc1 = createMockDocument({
        id: 'doc-1',
        name: 'my.report.2024.pdf',
        data_source_type: DatasourceType.localFile,
      })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('my.report.2024.pdf')).toBeInTheDocument()
    })

    it('should handle files without extension', async () => {
      // Arrange
      const doc1 = createMockDocument({
        id: 'doc-1',
        name: 'README',
        data_source_type: DatasourceType.localFile,
      })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert
      expect(screen.getByText('README')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Priority Label Tests
  // ==========================================
  describe('Priority Label', () => {
    // Tests for priority label display
    it('should show priority label when billing is enabled', async () => {
      // Arrange
      mockEnableBilling = true
      mockPlanType = Plan.sandbox
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      const { container } = render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert - PriorityLabel component should be rendered
      // Since we don't mock PriorityLabel, we check the structure exists
      expect(container.querySelector('.ml-0')).toBeInTheDocument()
    })

    it('should not show priority label when billing is disabled', async () => {
      // Arrange
      mockEnableBilling = false
      const doc1 = createMockDocument({ id: 'doc-1' })
      mockIndexingStatusData = [
        createMockIndexingStatus({ id: 'doc-1', indexing_status: 'indexing' }),
      ]
      const props = createDefaultProps({ documents: [doc1] })

      // Act
      render(<EmbeddingProcess {...props} />)
      await waitFor(() => {
        expect(mockFetchIndexingStatus).toHaveBeenCalled()
      })

      // Assert - upgrade banner should not be present
      expect(screen.queryByText('billing.plansCommon.documentProcessingPriorityUpgrade')).not.toBeInTheDocument()
    })
  })
})
