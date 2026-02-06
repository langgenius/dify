import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import DatasetCardHeader from './dataset-card-header'

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
    formatIndexingTechniqueAndMethod: (technique: string, _method: string) => {
      if (technique === 'high_quality')
        return 'High Quality'
      if (technique === 'economy')
        return 'Economy'
      return ''
    },
  }),
}))

describe('DatasetCardHeader', () => {
  const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    indexing_status: 'completed',
    provider: 'vendor',
    permission: DatasetPermission.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    embedding_available: true,
    app_count: 5,
    document_count: 10,
    total_document_count: 10,
    word_count: 1000,
    updated_at: 1609545600,
    updated_by: 'user-1',
    tags: [],
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    created_by: 'user-1',
    doc_form: ChunkingMode.text,
    runtime_mode: 'general',
    is_published: true,
    enable_api: true,
    is_multimodal: false,
    built_in_field_enabled: false,
    icon_info: {
      icon: '📙',
      icon_type: 'emoji' as const,
      icon_background: '#FFF4ED',
      icon_url: '',
    },
    retrieval_model_dict: {
      search_method: RETRIEVE_METHOD.semantic,
    } as DataSet['retrieval_model_dict'],
    retrieval_model: {
      search_method: RETRIEVE_METHOD.semantic,
    } as DataSet['retrieval_model'],
    external_knowledge_info: {
      external_knowledge_id: '',
      external_knowledge_api_id: '',
      external_knowledge_api_name: '',
      external_knowledge_api_endpoint: '',
    },
    external_retrieval_model: {
      top_k: 3,
      score_threshold: 0.5,
      score_threshold_enabled: false,
    },
    author_name: 'Test User',
    ...overrides,
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const dataset = createMockDataset()
      render(<DatasetCardHeader dataset={dataset} />)
      expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    })

    it('should render dataset name', () => {
      const dataset = createMockDataset({ name: 'Custom Dataset' })
      render(<DatasetCardHeader dataset={dataset} />)
      expect(screen.getByText('Custom Dataset')).toBeInTheDocument()
    })

    it('should render author name', () => {
      const dataset = createMockDataset({ author_name: 'John Doe' })
      render(<DatasetCardHeader dataset={dataset} />)
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('should render edit time', () => {
      const dataset = createMockDataset()
      render(<DatasetCardHeader dataset={dataset} />)
      // Should contain the formatted time
      expect(screen.getByText(/segment\.editedAt/)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should show external knowledge base text for external provider', () => {
      const dataset = createMockDataset({ provider: 'external' })
      render(<DatasetCardHeader dataset={dataset} />)
      expect(screen.getByText(/externalKnowledgeBase/)).toBeInTheDocument()
    })

    it('should show chunking mode for text_model doc_form', () => {
      const dataset = createMockDataset({ doc_form: ChunkingMode.text })
      render(<DatasetCardHeader dataset={dataset} />)
      // text_model maps to 'general' in DOC_FORM_TEXT
      expect(screen.getByText(/chunkingMode\.general/)).toBeInTheDocument()
    })

    it('should show multimodal text when is_multimodal is true', () => {
      const dataset = createMockDataset({ is_multimodal: true })
      render(<DatasetCardHeader dataset={dataset} />)
      expect(screen.getByText(/multimodal/)).toBeInTheDocument()
    })

    it('should not show multimodal when is_multimodal is false', () => {
      const dataset = createMockDataset({ is_multimodal: false })
      render(<DatasetCardHeader dataset={dataset} />)
      expect(screen.queryByText(/^multimodal$/)).not.toBeInTheDocument()
    })
  })

  describe('Icon', () => {
    it('should render AppIcon component', () => {
      const dataset = createMockDataset()
      const { container } = render(<DatasetCardHeader dataset={dataset} />)
      // AppIcon should be rendered
      const iconContainer = container.querySelector('.relative.shrink-0')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should use default icon when icon_info is missing', () => {
      const dataset = createMockDataset({ icon_info: undefined })
      render(<DatasetCardHeader dataset={dataset} />)
      // Should still render without crashing
      expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    })

    it('should render chunking mode icon for published pipeline', () => {
      const dataset = createMockDataset({
        doc_form: ChunkingMode.text,
        runtime_mode: 'rag_pipeline',
        is_published: true,
      })
      const { container } = render(<DatasetCardHeader dataset={dataset} />)
      // Should have the icon badge
      const iconBadge = container.querySelector('.absolute.-bottom-1.-right-1')
      expect(iconBadge).toBeInTheDocument()
    })
  })

  describe('Styles', () => {
    it('should have opacity class when embedding is not available', () => {
      const dataset = createMockDataset({ embedding_available: false })
      const { container } = render(<DatasetCardHeader dataset={dataset} />)
      const header = container.firstChild as HTMLElement
      expect(header).toHaveClass('opacity-30')
    })

    it('should not have opacity class when embedding is available', () => {
      const dataset = createMockDataset({ embedding_available: true })
      const { container } = render(<DatasetCardHeader dataset={dataset} />)
      const header = container.firstChild as HTMLElement
      expect(header).not.toHaveClass('opacity-30')
    })

    it('should have correct base styling', () => {
      const dataset = createMockDataset()
      const { container } = render(<DatasetCardHeader dataset={dataset} />)
      const header = container.firstChild as HTMLElement
      expect(header).toHaveClass('flex', 'items-center', 'gap-x-3', 'px-4')
    })
  })

  describe('DocModeInfo', () => {
    it('should show doc mode info when all conditions are met', () => {
      const dataset = createMockDataset({
        doc_form: ChunkingMode.text,
        indexing_technique: IndexingType.QUALIFIED,
        retrieval_model_dict: { search_method: RETRIEVE_METHOD.semantic } as DataSet['retrieval_model_dict'],
        runtime_mode: 'general',
      })
      render(<DatasetCardHeader dataset={dataset} />)
      expect(screen.getByText(/chunkingMode/)).toBeInTheDocument()
    })

    it('should not show doc mode info for unpublished pipeline', () => {
      const dataset = createMockDataset({
        runtime_mode: 'rag_pipeline',
        is_published: false,
      })
      render(<DatasetCardHeader dataset={dataset} />)
      // DocModeInfo should not be rendered since isShowDocModeInfo is false
      expect(screen.queryByText(/High Quality/)).not.toBeInTheDocument()
    })

    it('should show doc mode info for published pipeline', () => {
      const dataset = createMockDataset({
        doc_form: ChunkingMode.text,
        indexing_technique: IndexingType.QUALIFIED,
        retrieval_model_dict: { search_method: RETRIEVE_METHOD.semantic } as DataSet['retrieval_model_dict'],
        runtime_mode: 'rag_pipeline',
        is_published: true,
      })
      render(<DatasetCardHeader dataset={dataset} />)
      expect(screen.getByText(/chunkingMode/)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle missing author_name', () => {
      const dataset = createMockDataset({ author_name: undefined })
      render(<DatasetCardHeader dataset={dataset} />)
      expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    })

    it('should handle empty name', () => {
      const dataset = createMockDataset({ name: '' })
      render(<DatasetCardHeader dataset={dataset} />)
      // Should render without crashing
      const { container } = render(<DatasetCardHeader dataset={dataset} />)
      expect(container).toBeInTheDocument()
    })

    it('should handle missing retrieval_model_dict', () => {
      const dataset = createMockDataset({ retrieval_model_dict: undefined })
      render(<DatasetCardHeader dataset={dataset} />)
      expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    })

    it('should handle undefined doc_form', () => {
      const dataset = createMockDataset({ doc_form: undefined })
      render(<DatasetCardHeader dataset={dataset} />)
      expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    })
  })
})
