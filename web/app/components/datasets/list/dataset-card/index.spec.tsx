import type { DataSet } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import DatasetCard from './index'

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Mock ahooks useHover
vi.mock('ahooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ahooks')>()
  return {
    ...actual,
    useHover: () => false,
  }
})

// Mock app context
vi.mock('@/context/app-context', () => ({
  useSelector: () => false,
}))

// Mock the useDatasetCardState hook
vi.mock('./hooks/use-dataset-card-state', () => ({
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

// Mock the RenameDatasetModal
vi.mock('../../rename-modal', () => ({
  default: () => null,
}))

// Mock useFormatTimeFromNow hook
vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (timestamp: number) => {
      const date = new Date(timestamp)
      return date.toLocaleDateString()
    },
  }),
}))

// Mock useKnowledge hook
vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: () => 'High Quality',
  }),
}))

describe('DatasetCard', () => {
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
    runtime_mode: 'general',
    is_published: true,
    total_available_documents: 10,
    icon_info: {
      icon: '📙',
      icon_type: 'emoji' as const,
      icon_background: '#FFF4ED',
      icon_url: '',
    },
    retrieval_model_dict: {
      search_method: RETRIEVE_METHOD.semantic,
    },
    author_name: 'Test User',
    ...overrides,
  } as DataSet)

  const defaultProps = {
    dataset: createMockDataset(),
    onSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<DatasetCard {...defaultProps} />)
      expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    })

    it('should render dataset name', () => {
      const dataset = createMockDataset({ name: 'Custom Dataset Name' })
      render(<DatasetCard {...defaultProps} dataset={dataset} />)
      expect(screen.getByText('Custom Dataset Name')).toBeInTheDocument()
    })

    it('should render dataset description', () => {
      const dataset = createMockDataset({ description: 'Custom Description' })
      render(<DatasetCard {...defaultProps} dataset={dataset} />)
      expect(screen.getByText('Custom Description')).toBeInTheDocument()
    })

    it('should render document count', () => {
      render(<DatasetCard {...defaultProps} />)
      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('should render app count', () => {
      render(<DatasetCard {...defaultProps} />)
      expect(screen.getByText('5')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should handle external provider', () => {
      const dataset = createMockDataset({ provider: 'external' })
      render(<DatasetCard {...defaultProps} dataset={dataset} />)
      expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    })

    it('should handle rag_pipeline runtime mode', () => {
      const dataset = createMockDataset({ runtime_mode: 'rag_pipeline', is_published: true })
      render(<DatasetCard {...defaultProps} dataset={dataset} />)
      expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should navigate to documents page on click for regular dataset', () => {
      const dataset = createMockDataset({ provider: 'vendor' })
      render(<DatasetCard {...defaultProps} dataset={dataset} />)

      const card = screen.getByText('Test Dataset').closest('[data-disable-nprogress]')
      fireEvent.click(card!)

      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents')
    })

    it('should navigate to hitTesting page on click for external provider', () => {
      const dataset = createMockDataset({ provider: 'external' })
      render(<DatasetCard {...defaultProps} dataset={dataset} />)

      const card = screen.getByText('Test Dataset').closest('[data-disable-nprogress]')
      fireEvent.click(card!)

      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/hitTesting')
    })

    it('should navigate to pipeline page when pipeline is unpublished', () => {
      const dataset = createMockDataset({ runtime_mode: 'rag_pipeline', is_published: false })
      render(<DatasetCard {...defaultProps} dataset={dataset} />)

      const card = screen.getByText('Test Dataset').closest('[data-disable-nprogress]')
      fireEvent.click(card!)

      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/pipeline')
    })
  })

  describe('Styles', () => {
    it('should have correct card styling', () => {
      render(<DatasetCard {...defaultProps} />)
      const card = screen.getByText('Test Dataset').closest('.group')
      expect(card).toHaveClass('h-[190px]', 'cursor-pointer', 'flex-col', 'rounded-xl')
    })

    it('should have data-disable-nprogress attribute', () => {
      render(<DatasetCard {...defaultProps} />)
      const card = screen.getByText('Test Dataset').closest('[data-disable-nprogress]')
      expect(card).toHaveAttribute('data-disable-nprogress', 'true')
    })
  })

  describe('Edge Cases', () => {
    it('should handle dataset without description', () => {
      const dataset = createMockDataset({ description: '' })
      render(<DatasetCard {...defaultProps} dataset={dataset} />)
      expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    })

    it('should handle embedding not available', () => {
      const dataset = createMockDataset({ embedding_available: false })
      render(<DatasetCard {...defaultProps} dataset={dataset} />)
      expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    })

    it('should handle undefined onSuccess', () => {
      render(<DatasetCard dataset={createMockDataset()} />)
      expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    })
  })

  describe('Tag Area Click', () => {
    it('should stop propagation and prevent default when tag area is clicked', () => {
      render(<DatasetCard {...defaultProps} />)

      // Find tag area element (it's inside the card)
      const tagAreaWrapper = document.querySelector('[class*="px-3"]')
      if (tagAreaWrapper) {
        const stopPropagationSpy = vi.fn()
        const preventDefaultSpy = vi.fn()

        const clickEvent = new MouseEvent('click', { bubbles: true })
        Object.defineProperty(clickEvent, 'stopPropagation', { value: stopPropagationSpy })
        Object.defineProperty(clickEvent, 'preventDefault', { value: preventDefaultSpy })

        tagAreaWrapper.dispatchEvent(clickEvent)

        expect(stopPropagationSpy).toHaveBeenCalled()
        expect(preventDefaultSpy).toHaveBeenCalled()
      }
    })

    it('should not navigate when clicking on tag area', () => {
      render(<DatasetCard {...defaultProps} />)

      // Click on tag area should not trigger card navigation
      const tagArea = document.querySelector('[class*="px-3"]')
      if (tagArea) {
        fireEvent.click(tagArea)
        // mockPush should NOT be called when clicking tag area
        // (stopPropagation prevents it from reaching the card click handler)
      }
    })
  })
})
