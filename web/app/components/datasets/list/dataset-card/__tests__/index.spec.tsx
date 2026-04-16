import type { DataSet } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import DatasetCardFooter from '../components/dataset-card-footer'
import Description from '../components/description'
import DatasetCard from '../index'

// Mock external hooks only
vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (timestamp: number) => {
      const date = new Date(timestamp)
      return `${date.toLocaleDateString()}`
    },
  }),
}))

const mockPush = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { isCurrentWorkspaceDatasetOperator: boolean }) => boolean) => selector({ isCurrentWorkspaceDatasetOperator: false }),
}))

vi.mock('../hooks/use-dataset-card-state', () => ({
  useDatasetCardState: () => ({
    tags: [],
    setTags: vi.fn(),
    modalState: {
      showRenameModal: false,
      showConfirmDelete: false,
      confirmMessage: '',
    },
    openRenameModal: vi.fn(),
    closeRenameModal: vi.fn(),
    closeConfirmDelete: vi.fn(),
    handleExportPipeline: vi.fn(),
    detectIsUsedByApp: vi.fn(),
    onConfirmDelete: vi.fn(),
  }),
}))

vi.mock('../components/corner-labels', () => ({
  default: () => <div data-testid="corner-labels" />,
}))
vi.mock('../components/dataset-card-header', () => ({
  default: ({ dataset }: { dataset: DataSet }) => <div data-testid="card-header">{dataset.name}</div>,
}))
vi.mock('../components/dataset-card-modals', () => ({
  default: () => <div data-testid="card-modals" />,
}))
vi.mock('../components/tag-area', () => ({
  default: ({ onClick }: { onClick: (e: React.MouseEvent) => void, ref?: React.Ref<HTMLDivElement> }) => (
    <div data-testid="tag-area" onClick={onClick} />
  ),
}))
vi.mock('../components/operations-dropdown', () => ({
  default: () => <div data-testid="operations-dropdown" />,
}))

// Factory function for DataSet mock data
const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
  id: 'dataset-1',
  name: 'Test Dataset',
  description: 'Test description',
  provider: 'vendor',
  permission: DatasetPermission.allTeamMembers,
  data_source_type: DataSourceType.FILE,
  indexing_technique: IndexingType.QUALIFIED,
  embedding_available: true,
  app_count: 5,
  document_count: 10,
  word_count: 1000,
  created_at: 1609459200,
  updated_at: 1609545600,
  tags: [],
  embedding_model: 'text-embedding-ada-002',
  embedding_model_provider: 'openai',
  created_by: 'user-1',
  doc_form: ChunkingMode.text,
  total_available_documents: 10,
  runtime_mode: 'general',
  ...overrides,
} as DataSet)

describe('DatasetCard Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Integration tests for Description component
  describe('Description', () => {
    describe('Rendering', () => {
      it('should render description text from dataset', () => {
        const dataset = createMockDataset({ description: 'My knowledge base' })
        render(<Description dataset={dataset} />)
        expect(screen.getByText('My knowledge base')).toBeInTheDocument()
      })

      it('should set title attribute to description', () => {
        const dataset = createMockDataset({ description: 'Hover text' })
        render(<Description dataset={dataset} />)
        expect(screen.getByTitle('Hover text')).toBeInTheDocument()
      })
    })

    describe('Props', () => {
      it('should apply opacity-30 when embedding_available is false', () => {
        const dataset = createMockDataset({ embedding_available: false })
        render(<Description dataset={dataset} />)
        const descDiv = screen.getByTitle(dataset.description)
        expect(descDiv).toHaveClass('opacity-30')
      })

      it('should not apply opacity-30 when embedding_available is true', () => {
        const dataset = createMockDataset({ embedding_available: true })
        render(<Description dataset={dataset} />)
        const descDiv = screen.getByTitle(dataset.description)
        expect(descDiv).not.toHaveClass('opacity-30')
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty description', () => {
        const dataset = createMockDataset({ description: '' })
        render(<Description dataset={dataset} />)
        const descDiv = screen.getByTitle('')
        expect(descDiv).toBeInTheDocument()
        expect(descDiv).toHaveTextContent('')
      })

      it('should handle long description', () => {
        const longDesc = 'X'.repeat(500)
        const dataset = createMockDataset({ description: longDesc })
        render(<Description dataset={dataset} />)
        expect(screen.getByText(longDesc)).toBeInTheDocument()
      })
    })
  })

  // Integration tests for DatasetCardFooter component
  describe('DatasetCardFooter', () => {
    describe('Rendering', () => {
      it('should render document count', () => {
        const dataset = createMockDataset({ document_count: 15, total_available_documents: 15 })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('15')).toBeInTheDocument()
      })

      it('should render app count for non-external provider', () => {
        const dataset = createMockDataset({ app_count: 7, provider: 'vendor' })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('7')).toBeInTheDocument()
      })

      it('should render update time', () => {
        const dataset = createMockDataset()
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText(/updated/i)).toBeInTheDocument()
      })
    })

    describe('Props', () => {
      it('should show partial count when total_available_documents < document_count', () => {
        const dataset = createMockDataset({
          document_count: 20,
          total_available_documents: 12,
        })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('12 / 20')).toBeInTheDocument()
      })

      it('should show single count when all documents are available', () => {
        const dataset = createMockDataset({
          document_count: 20,
          total_available_documents: 20,
        })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('20')).toBeInTheDocument()
      })

      it('should not show app count when provider is external', () => {
        const dataset = createMockDataset({ provider: 'external', app_count: 99 })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.queryByText('99')).not.toBeInTheDocument()
      })

      it('should have opacity when embedding_available is false', () => {
        const dataset = createMockDataset({ embedding_available: false })
        const { container } = render(<DatasetCardFooter dataset={dataset} />)
        const footer = container.firstChild as HTMLElement
        expect(footer).toHaveClass('opacity-30')
      })
    })

    describe('Edge Cases', () => {
      it('should handle undefined total_available_documents', () => {
        const dataset = createMockDataset({
          document_count: 10,
          total_available_documents: undefined,
        })
        render(<DatasetCardFooter dataset={dataset} />)
        // total_available_documents defaults to 0, which is < 10
        expect(screen.getByText('0 / 10')).toBeInTheDocument()
      })

      it('should handle zero document count', () => {
        const dataset = createMockDataset({
          document_count: 0,
          total_available_documents: 0,
        })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('0')).toBeInTheDocument()
      })

      it('should handle large numbers', () => {
        const dataset = createMockDataset({
          document_count: 100000,
          total_available_documents: 100000,
          app_count: 50000,
        })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('100000')).toBeInTheDocument()
        expect(screen.getByText('50000')).toBeInTheDocument()
      })
    })
  })
})

describe('DatasetCard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render and navigate to documents when clicked', () => {
    const dataset = createMockDataset()
    render(<DatasetCard dataset={dataset} />)

    fireEvent.click(screen.getByText('Test Dataset'))
    expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents')
  })

  it('should navigate to hitTesting for external provider', () => {
    const dataset = createMockDataset({ provider: 'external' })
    render(<DatasetCard dataset={dataset} />)

    fireEvent.click(screen.getByText('Test Dataset'))
    expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/hitTesting')
  })

  it('should navigate to pipeline for unpublished pipeline', () => {
    const dataset = createMockDataset({ runtime_mode: 'rag_pipeline', is_published: false })
    render(<DatasetCard dataset={dataset} />)

    fireEvent.click(screen.getByText('Test Dataset'))
    expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/pipeline')
  })

  it('should stop propagation when tag area is clicked', () => {
    const dataset = createMockDataset()
    render(<DatasetCard dataset={dataset} />)

    const tagArea = screen.getByTestId('tag-area')
    fireEvent.click(tagArea)
    // Tag area click should not trigger card navigation
    expect(mockPush).not.toHaveBeenCalled()
  })
})
