import type { InitialDocumentDetail } from '@/models/pipeline'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StepThreeContent from './step-three-content'

// Mock context hooks used by Processing component
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: vi.fn((selector: (state: unknown) => unknown) => {
    const mockState = {
      dataset: {
        id: 'mock-dataset-id',
        indexing_technique: 'high_quality',
        retrieval_model_dict: {
          search_method: 'semantic_search',
        },
      },
    }
    return selector(mockState)
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

// Mock EmbeddingProcess component as it has complex dependencies
vi.mock('../processing/embedding-process', () => ({
  default: ({ datasetId, batchId, documents }: {
    datasetId: string
    batchId: string
    documents: InitialDocumentDetail[]
  }) => (
    <div data-testid="embedding-process">
      <span data-testid="dataset-id">{datasetId}</span>
      <span data-testid="batch-id">{batchId}</span>
      <span data-testid="documents-count">{documents.length}</span>
    </div>
  ),
}))

describe('StepThreeContent', () => {
  const mockDocuments: InitialDocumentDetail[] = [
    { id: 'doc1', name: 'Document 1' } as InitialDocumentDetail,
    { id: 'doc2', name: 'Document 2' } as InitialDocumentDetail,
  ]

  const defaultProps = {
    batchId: 'test-batch-id',
    documents: mockDocuments,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<StepThreeContent {...defaultProps} />)
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
    })

    it('should render Processing component', () => {
      render(<StepThreeContent {...defaultProps} />)
      expect(screen.getByTestId('embedding-process')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass batchId to Processing component', () => {
      render(<StepThreeContent {...defaultProps} />)
      expect(screen.getByTestId('batch-id')).toHaveTextContent('test-batch-id')
    })

    it('should pass documents to Processing component', () => {
      render(<StepThreeContent {...defaultProps} />)
      expect(screen.getByTestId('documents-count')).toHaveTextContent('2')
    })

    it('should handle empty documents array', () => {
      render(<StepThreeContent batchId="test-batch-id" documents={[]} />)
      expect(screen.getByTestId('documents-count')).toHaveTextContent('0')
    })
  })

  describe('Edge Cases', () => {
    it('should render with different batchId', () => {
      render(<StepThreeContent batchId="another-batch-id" documents={mockDocuments} />)
      expect(screen.getByTestId('batch-id')).toHaveTextContent('another-batch-id')
    })

    it('should render with single document', () => {
      const singleDocument = [mockDocuments[0]]
      render(<StepThreeContent batchId="test-batch-id" documents={singleDocument} />)
      expect(screen.getByTestId('documents-count')).toHaveTextContent('1')
    })
  })
})
