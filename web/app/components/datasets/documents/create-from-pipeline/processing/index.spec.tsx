import type { DocumentIndexingStatus } from '@/models/datasets'
import type { InitialDocumentDetail } from '@/models/pipeline'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { DatasourceType } from '@/models/pipeline'
import Processing from './index'

// ==========================================
// Mock External Dependencies
// ==========================================

// Mock useDocLink - returns a function that generates doc URLs
// Strips leading slash from path to match actual implementation behavior
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => {
    const normalizedPath = path?.startsWith('/') ? path.slice(1) : (path || '')
    return `https://docs.dify.ai/en-US/${normalizedPath}`
  },
}))

// Mock dataset detail context
let mockDataset: {
  id?: string
  indexing_technique?: string
  retrieval_model_dict?: { search_method?: string }
} | undefined

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: <T,>(selector: (state: { dataset?: typeof mockDataset }) => T): T => {
    return selector({ dataset: mockDataset })
  },
}))

// Mock the EmbeddingProcess component to track props
let embeddingProcessProps: Record<string, unknown> = {}
vi.mock('./embedding-process', () => ({
  default: (props: Record<string, unknown>) => {
    embeddingProcessProps = props
    return (
      <div data-testid="embedding-process">
        <span data-testid="ep-dataset-id">{props.datasetId as string}</span>
        <span data-testid="ep-batch-id">{props.batchId as string}</span>
        <span data-testid="ep-documents-count">{(props.documents as unknown[])?.length ?? 0}</span>
        <span data-testid="ep-indexing-type">{props.indexingType as string || 'undefined'}</span>
        <span data-testid="ep-retrieval-method">{props.retrievalMethod as string || 'undefined'}</span>
      </div>
    )
  },
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
 * Creates a list of mock documents
 */
const createMockDocuments = (count: number): InitialDocumentDetail[] =>
  Array.from({ length: count }, (_, index) =>
    createMockDocument({
      id: `doc-${index + 1}`,
      name: `document-${index + 1}.txt`,
      position: index,
    }))

// ==========================================
// Test Suite
// ==========================================

describe('Processing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    embeddingProcessProps = {}
    // Reset deterministic ID counter for reproducible tests
    documentIdCounter = 0
    // Reset mock dataset with default values
    mockDataset = {
      id: 'dataset-123',
      indexing_technique: 'high_quality',
      retrieval_model_dict: { search_method: 'semantic_search' },
    }
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    // Tests basic rendering functionality
    it('should render without crashing', () => {
      // Arrange
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(2),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
    })

    it('should render the EmbeddingProcess component', () => {
      // Arrange
      const props = {
        batchId: 'batch-456',
        documents: createMockDocuments(3),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
    })

    it('should render the side tip section with correct content', () => {
      // Arrange
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert - verify translation keys are rendered
      expect(screen.getByText('datasetCreation.stepThree.sideTipTitle')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepThree.sideTipContent')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.addDocuments.stepThree.learnMore')).toBeInTheDocument()
    })

    it('should render the documentation link with correct attributes', () => {
      // Arrange
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      const link = screen.getByRole('link', { name: 'datasetPipeline.addDocuments.stepThree.learnMore' })
      expect(link).toHaveAttribute('href', 'https://docs.dify.ai/en-US/use-dify/knowledge/knowledge-pipeline/authorize-data-source')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer noopener')
    })

    it('should render the book icon in the side tip', () => {
      // Arrange
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      const { container } = render(<Processing {...props} />)

      // Assert - check for icon container with shadow styling
      const iconContainer = container.querySelector('.shadow-lg.shadow-shadow-shadow-5')
      expect(iconContainer).toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    // Tests that props are correctly passed to child components
    it('should pass batchId to EmbeddingProcess', () => {
      // Arrange
      const testBatchId = 'test-batch-id-789'
      const props = {
        batchId: testBatchId,
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('ep-batch-id')).toHaveTextContent(testBatchId)
      expect(embeddingProcessProps.batchId).toBe(testBatchId)
    })

    it('should pass documents to EmbeddingProcess', () => {
      // Arrange
      const documents = createMockDocuments(5)
      const props = {
        batchId: 'batch-123',
        documents,
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('ep-documents-count')).toHaveTextContent('5')
      expect(embeddingProcessProps.documents).toEqual(documents)
    })

    it('should pass datasetId from context to EmbeddingProcess', () => {
      // Arrange
      mockDataset = {
        id: 'context-dataset-id',
        indexing_technique: 'high_quality',
        retrieval_model_dict: { search_method: 'semantic_search' },
      }
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('ep-dataset-id')).toHaveTextContent('context-dataset-id')
      expect(embeddingProcessProps.datasetId).toBe('context-dataset-id')
    })

    it('should pass indexingType from context to EmbeddingProcess', () => {
      // Arrange
      mockDataset = {
        id: 'dataset-123',
        indexing_technique: 'economy',
        retrieval_model_dict: { search_method: 'semantic_search' },
      }
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('ep-indexing-type')).toHaveTextContent('economy')
      expect(embeddingProcessProps.indexingType).toBe('economy')
    })

    it('should pass retrievalMethod from context to EmbeddingProcess', () => {
      // Arrange
      mockDataset = {
        id: 'dataset-123',
        indexing_technique: 'high_quality',
        retrieval_model_dict: { search_method: 'keyword_search' },
      }
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('ep-retrieval-method')).toHaveTextContent('keyword_search')
      expect(embeddingProcessProps.retrievalMethod).toBe('keyword_search')
    })

    it('should handle different document types', () => {
      // Arrange
      const documents = [
        createMockDocument({
          id: 'doc-local',
          name: 'local-file.pdf',
          data_source_type: DatasourceType.localFile,
        }),
        createMockDocument({
          id: 'doc-online',
          name: 'online-doc',
          data_source_type: DatasourceType.onlineDocument,
        }),
        createMockDocument({
          id: 'doc-website',
          name: 'website-page',
          data_source_type: DatasourceType.websiteCrawl,
        }),
      ]
      const props = {
        batchId: 'batch-123',
        documents,
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('ep-documents-count')).toHaveTextContent('3')
      expect(embeddingProcessProps.documents).toEqual(documents)
    })
  })

  // ==========================================
  // Edge Cases
  // ==========================================
  describe('Edge Cases', () => {
    // Tests for boundary conditions and unusual inputs
    it('should handle empty documents array', () => {
      // Arrange
      const props = {
        batchId: 'batch-123',
        documents: [],
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      expect(screen.getByTestId('ep-documents-count')).toHaveTextContent('0')
      expect(embeddingProcessProps.documents).toEqual([])
    })

    it('should handle empty batchId', () => {
      // Arrange
      const props = {
        batchId: '',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      expect(screen.getByTestId('ep-batch-id')).toHaveTextContent('')
    })

    it('should handle undefined dataset from context', () => {
      // Arrange
      mockDataset = undefined
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      expect(embeddingProcessProps.datasetId).toBeUndefined()
      expect(embeddingProcessProps.indexingType).toBeUndefined()
      expect(embeddingProcessProps.retrievalMethod).toBeUndefined()
    })

    it('should handle dataset with undefined id', () => {
      // Arrange
      mockDataset = {
        id: undefined,
        indexing_technique: 'high_quality',
        retrieval_model_dict: { search_method: 'semantic_search' },
      }
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      expect(embeddingProcessProps.datasetId).toBeUndefined()
    })

    it('should handle dataset with undefined indexing_technique', () => {
      // Arrange
      mockDataset = {
        id: 'dataset-123',
        indexing_technique: undefined,
        retrieval_model_dict: { search_method: 'semantic_search' },
      }
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      expect(embeddingProcessProps.indexingType).toBeUndefined()
    })

    it('should handle dataset with undefined retrieval_model_dict', () => {
      // Arrange
      mockDataset = {
        id: 'dataset-123',
        indexing_technique: 'high_quality',
        retrieval_model_dict: undefined,
      }
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      expect(embeddingProcessProps.retrievalMethod).toBeUndefined()
    })

    it('should handle dataset with empty retrieval_model_dict', () => {
      // Arrange
      mockDataset = {
        id: 'dataset-123',
        indexing_technique: 'high_quality',
        retrieval_model_dict: {},
      }
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      expect(embeddingProcessProps.retrievalMethod).toBeUndefined()
    })

    it('should handle large number of documents', () => {
      // Arrange
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(100),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      expect(screen.getByTestId('ep-documents-count')).toHaveTextContent('100')
    })

    it('should handle documents with error status', () => {
      // Arrange
      const documents = [
        createMockDocument({
          id: 'doc-error',
          name: 'error-doc.txt',
          error: 'Processing failed',
          indexing_status: 'error' as DocumentIndexingStatus,
        }),
      ]
      const props = {
        batchId: 'batch-123',
        documents,
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      expect(embeddingProcessProps.documents).toEqual(documents)
    })

    it('should handle documents with special characters in names', () => {
      // Arrange
      const documents = [
        createMockDocument({
          id: 'doc-special',
          name: 'document with spaces & special-chars_测试.pdf',
        }),
      ]
      const props = {
        batchId: 'batch-123',
        documents,
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      expect(embeddingProcessProps.documents).toEqual(documents)
    })

    it('should handle batchId with special characters', () => {
      // Arrange
      const props = {
        batchId: 'batch-123-abc_xyz:456',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('ep-batch-id')).toHaveTextContent('batch-123-abc_xyz:456')
    })
  })

  // ==========================================
  // Context Integration Tests
  // ==========================================
  describe('Context Integration', () => {
    // Tests for proper context usage
    it('should correctly use context selectors for all dataset properties', () => {
      // Arrange
      mockDataset = {
        id: 'full-dataset-id',
        indexing_technique: 'high_quality',
        retrieval_model_dict: { search_method: 'hybrid_search' },
      }
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(embeddingProcessProps.datasetId).toBe('full-dataset-id')
      expect(embeddingProcessProps.indexingType).toBe('high_quality')
      expect(embeddingProcessProps.retrievalMethod).toBe('hybrid_search')
    })

    it('should handle context changes with different indexing techniques', () => {
      // Arrange - Test with economy indexing
      mockDataset = {
        id: 'dataset-economy',
        indexing_technique: 'economy',
        retrieval_model_dict: { search_method: 'keyword_search' },
      }
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      const { rerender } = render(<Processing {...props} />)

      // Assert economy indexing
      expect(embeddingProcessProps.indexingType).toBe('economy')

      // Arrange - Update to high_quality
      mockDataset = {
        id: 'dataset-hq',
        indexing_technique: 'high_quality',
        retrieval_model_dict: { search_method: 'semantic_search' },
      }

      // Act - Rerender with new context
      rerender(<Processing {...props} />)

      // Assert high_quality indexing
      expect(embeddingProcessProps.indexingType).toBe('high_quality')
    })
  })

  // ==========================================
  // Layout Tests
  // ==========================================
  describe('Layout', () => {
    // Tests for proper layout and structure
    it('should render with correct layout structure', () => {
      // Arrange
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      const { container } = render(<Processing {...props} />)

      // Assert - Check for flex layout with proper widths
      const mainContainer = container.querySelector('.flex.h-full.w-full.justify-center')
      expect(mainContainer).toBeInTheDocument()

      // Check for left panel (3/5 width)
      const leftPanel = container.querySelector('.w-3\\/5')
      expect(leftPanel).toBeInTheDocument()

      // Check for right panel (2/5 width)
      const rightPanel = container.querySelector('.w-2\\/5')
      expect(rightPanel).toBeInTheDocument()
    })

    it('should render side tip card with correct styling', () => {
      // Arrange
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      const { container } = render(<Processing {...props} />)

      // Assert - Check for card container with rounded corners and background
      const sideTipCard = container.querySelector('.rounded-xl.bg-background-section')
      expect(sideTipCard).toBeInTheDocument()
    })

    it('should constrain max-width for EmbeddingProcess container', () => {
      // Arrange
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      const { container } = render(<Processing {...props} />)

      // Assert
      const maxWidthContainer = container.querySelector('.max-w-\\[640px\\]')
      expect(maxWidthContainer).toBeInTheDocument()
    })
  })

  // ==========================================
  // Document Variations Tests
  // ==========================================
  describe('Document Variations', () => {
    // Tests for different document configurations
    it('should handle documents with all indexing statuses', () => {
      // Arrange
      const statuses: DocumentIndexingStatus[] = [
        'waiting',
        'parsing',
        'cleaning',
        'splitting',
        'indexing',
        'paused',
        'error',
        'completed',
      ]
      const documents = statuses.map((status, index) =>
        createMockDocument({
          id: `doc-${status}`,
          name: `${status}-doc.txt`,
          indexing_status: status,
          position: index,
        }),
      )
      const props = {
        batchId: 'batch-123',
        documents,
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('ep-documents-count')).toHaveTextContent(String(statuses.length))
      expect(embeddingProcessProps.documents).toEqual(documents)
    })

    it('should handle documents with enabled and disabled states', () => {
      // Arrange
      const documents = [
        createMockDocument({ id: 'doc-enabled', enable: true }),
        createMockDocument({ id: 'doc-disabled', enable: false }),
      ]
      const props = {
        batchId: 'batch-123',
        documents,
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('ep-documents-count')).toHaveTextContent('2')
      expect(embeddingProcessProps.documents).toEqual(documents)
    })

    it('should handle documents from online drive source', () => {
      // Arrange
      const documents = [
        createMockDocument({
          id: 'doc-drive',
          name: 'google-drive-doc',
          data_source_type: DatasourceType.onlineDrive,
          data_source_info: { provider: 'google_drive' },
        }),
      ]
      const props = {
        batchId: 'batch-123',
        documents,
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
      expect(embeddingProcessProps.documents).toEqual(documents)
    })

    it('should handle documents with complex data_source_info', () => {
      // Arrange
      const documents = [
        createMockDocument({
          id: 'doc-notion',
          name: 'Notion Page',
          data_source_type: DatasourceType.onlineDocument,
          data_source_info: {
            notion_page_icon: { type: 'emoji', emoji: '📄' },
            notion_workspace_id: 'ws-123',
            notion_page_id: 'page-456',
          },
        }),
      ]
      const props = {
        batchId: 'batch-123',
        documents,
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(embeddingProcessProps.documents).toEqual(documents)
    })
  })

  // ==========================================
  // Retrieval Method Variations
  // ==========================================
  describe('Retrieval Method Variations', () => {
    // Tests for different retrieval methods
    const retrievalMethods = ['semantic_search', 'keyword_search', 'hybrid_search', 'full_text_search']

    it.each(retrievalMethods)('should handle %s retrieval method', (method) => {
      // Arrange
      mockDataset = {
        id: 'dataset-123',
        indexing_technique: 'high_quality',
        retrieval_model_dict: { search_method: method },
      }
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(embeddingProcessProps.retrievalMethod).toBe(method)
    })
  })

  // ==========================================
  // Indexing Technique Variations
  // ==========================================
  describe('Indexing Technique Variations', () => {
    // Tests for different indexing techniques
    const indexingTechniques = ['high_quality', 'economy']

    it.each(indexingTechniques)('should handle %s indexing technique', (technique) => {
      // Arrange
      mockDataset = {
        id: 'dataset-123',
        indexing_technique: technique,
        retrieval_model_dict: { search_method: 'semantic_search' },
      }
      const props = {
        batchId: 'batch-123',
        documents: createMockDocuments(1),
      }

      // Act
      render(<Processing {...props} />)

      // Assert
      expect(embeddingProcessProps.indexingType).toBe(technique)
    })
  })
})
