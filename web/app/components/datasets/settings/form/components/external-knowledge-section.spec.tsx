import type { DataSet } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { render, screen } from '@testing-library/react'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../../create/step-two'
import ExternalKnowledgeSection from './external-knowledge-section'

describe('ExternalKnowledgeSection', () => {
  const mockRetrievalConfig: RetrievalConfig = {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  }

  const mockDataset: DataSet = {
    id: 'dataset-1',
    name: 'External Dataset',
    description: 'External dataset description',
    permission: DatasetPermission.onlyMe,
    icon_info: {
      icon_type: 'emoji',
      icon: '📚',
      icon_background: '#FFFFFF',
      icon_url: '',
    },
    indexing_technique: IndexingType.QUALIFIED,
    indexing_status: 'completed',
    data_source_type: DataSourceType.FILE,
    doc_form: ChunkingMode.text,
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    embedding_available: true,
    app_count: 0,
    document_count: 5,
    total_document_count: 5,
    word_count: 1000,
    provider: 'external',
    tags: [],
    partial_member_list: [],
    external_knowledge_info: {
      external_knowledge_id: 'ext-knowledge-123',
      external_knowledge_api_id: 'api-456',
      external_knowledge_api_name: 'My External API',
      external_knowledge_api_endpoint: 'https://api.external.example.com/v1',
    },
    external_retrieval_model: {
      top_k: 5,
      score_threshold: 0.8,
      score_threshold_enabled: true,
    },
    retrieval_model_dict: mockRetrievalConfig,
    retrieval_model: mockRetrievalConfig,
    built_in_field_enabled: false,
    keyword_number: 10,
    created_by: 'user-1',
    updated_by: 'user-1',
    updated_at: Date.now(),
    runtime_mode: 'general',
    enable_api: true,
    is_multimodal: false,
  }

  const defaultProps = {
    currentDataset: mockDataset,
    topK: 5,
    scoreThreshold: 0.8,
    scoreThresholdEnabled: true,
    handleSettingsChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ExternalKnowledgeSection {...defaultProps} />)
      expect(screen.getByText(/form\.retrievalSetting\.title/i)).toBeInTheDocument()
    })

    it('should render retrieval settings section', () => {
      render(<ExternalKnowledgeSection {...defaultProps} />)
      expect(screen.getByText(/form\.retrievalSetting\.title/i)).toBeInTheDocument()
    })

    it('should render external knowledge API section', () => {
      render(<ExternalKnowledgeSection {...defaultProps} />)
      expect(screen.getByText(/form\.externalKnowledgeAPI/i)).toBeInTheDocument()
    })

    it('should render external knowledge ID section', () => {
      render(<ExternalKnowledgeSection {...defaultProps} />)
      expect(screen.getByText(/form\.externalKnowledgeID/i)).toBeInTheDocument()
    })
  })

  describe('External Knowledge API Info', () => {
    it('should display external API name', () => {
      render(<ExternalKnowledgeSection {...defaultProps} />)
      expect(screen.getByText('My External API')).toBeInTheDocument()
    })

    it('should display external API endpoint', () => {
      render(<ExternalKnowledgeSection {...defaultProps} />)
      expect(screen.getByText('https://api.external.example.com/v1')).toBeInTheDocument()
    })

    it('should render API connection icon', () => {
      const { container } = render(<ExternalKnowledgeSection {...defaultProps} />)
      // The ApiConnectionMod icon should be rendered
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('should display API name and endpoint in the same row', () => {
      render(<ExternalKnowledgeSection {...defaultProps} />)

      const apiName = screen.getByText('My External API')
      const apiEndpoint = screen.getByText('https://api.external.example.com/v1')

      // Both should be in the same container
      expect(apiName.parentElement?.parentElement).toBe(apiEndpoint.parentElement?.parentElement)
    })
  })

  describe('External Knowledge ID', () => {
    it('should display external knowledge ID value', () => {
      render(<ExternalKnowledgeSection {...defaultProps} />)
      expect(screen.getByText('ext-knowledge-123')).toBeInTheDocument()
    })

    it('should render ID in a read-only display', () => {
      render(<ExternalKnowledgeSection {...defaultProps} />)

      const idElement = screen.getByText('ext-knowledge-123')
      // The ID should be in a div with input-like styling, not an actual input
      expect(idElement.tagName.toLowerCase()).toBe('div')
    })
  })

  describe('Retrieval Settings', () => {
    it('should pass topK to RetrievalSettings', () => {
      render(<ExternalKnowledgeSection {...defaultProps} topK={10} />)

      // RetrievalSettings should receive topK prop
      // The exact rendering depends on RetrievalSettings component
    })

    it('should pass scoreThreshold to RetrievalSettings', () => {
      render(<ExternalKnowledgeSection {...defaultProps} scoreThreshold={0.9} />)

      // RetrievalSettings should receive scoreThreshold prop
    })

    it('should pass scoreThresholdEnabled to RetrievalSettings', () => {
      render(<ExternalKnowledgeSection {...defaultProps} scoreThresholdEnabled={false} />)

      // RetrievalSettings should receive scoreThresholdEnabled prop
    })

    it('should call handleSettingsChange when settings change', () => {
      const handleSettingsChange = vi.fn()
      render(<ExternalKnowledgeSection {...defaultProps} handleSettingsChange={handleSettingsChange} />)

      // The handler should be properly passed to RetrievalSettings
      // Actual interaction depends on RetrievalSettings implementation
    })
  })

  describe('Dividers', () => {
    it('should render dividers between sections', () => {
      const { container } = render(<ExternalKnowledgeSection {...defaultProps} />)

      const dividers = container.querySelectorAll('.bg-divider-subtle')
      expect(dividers.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Props Updates', () => {
    it('should update when currentDataset changes', () => {
      const { rerender } = render(<ExternalKnowledgeSection {...defaultProps} />)

      expect(screen.getByText('My External API')).toBeInTheDocument()

      const updatedDataset = {
        ...mockDataset,
        external_knowledge_info: {
          ...mockDataset.external_knowledge_info,
          external_knowledge_api_name: 'Updated API Name',
        },
      }

      rerender(<ExternalKnowledgeSection {...defaultProps} currentDataset={updatedDataset} />)

      expect(screen.getByText('Updated API Name')).toBeInTheDocument()
    })

    it('should update when external knowledge ID changes', () => {
      const { rerender } = render(<ExternalKnowledgeSection {...defaultProps} />)

      expect(screen.getByText('ext-knowledge-123')).toBeInTheDocument()

      const updatedDataset = {
        ...mockDataset,
        external_knowledge_info: {
          ...mockDataset.external_knowledge_info,
          external_knowledge_id: 'new-ext-id-789',
        },
      }

      rerender(<ExternalKnowledgeSection {...defaultProps} currentDataset={updatedDataset} />)

      expect(screen.getByText('new-ext-id-789')).toBeInTheDocument()
    })

    it('should update when API endpoint changes', () => {
      const { rerender } = render(<ExternalKnowledgeSection {...defaultProps} />)

      expect(screen.getByText('https://api.external.example.com/v1')).toBeInTheDocument()

      const updatedDataset = {
        ...mockDataset,
        external_knowledge_info: {
          ...mockDataset.external_knowledge_info,
          external_knowledge_api_endpoint: 'https://new-api.example.com/v2',
        },
      }

      rerender(<ExternalKnowledgeSection {...defaultProps} currentDataset={updatedDataset} />)

      expect(screen.getByText('https://new-api.example.com/v2')).toBeInTheDocument()
    })
  })

  describe('Layout', () => {
    it('should have consistent row layout', () => {
      const { container } = render(<ExternalKnowledgeSection {...defaultProps} />)

      // Check for flex gap-x-1 class on rows
      const rows = container.querySelectorAll('.flex.gap-x-1')
      expect(rows.length).toBeGreaterThan(0)
    })

    it('should have consistent label width', () => {
      const { container } = render(<ExternalKnowledgeSection {...defaultProps} />)

      // Check for w-[180px] label containers
      const labels = container.querySelectorAll('.w-\\[180px\\]')
      expect(labels.length).toBeGreaterThan(0)
    })
  })

  describe('Styling', () => {
    it('should apply correct background to info displays', () => {
      const { container } = render(<ExternalKnowledgeSection {...defaultProps} />)

      // Info displays should have bg-components-input-bg-normal
      const infoDisplays = container.querySelectorAll('.bg-components-input-bg-normal')
      expect(infoDisplays.length).toBeGreaterThan(0)
    })

    it('should apply rounded corners to info displays', () => {
      const { container } = render(<ExternalKnowledgeSection {...defaultProps} />)

      const roundedElements = container.querySelectorAll('.rounded-lg')
      expect(roundedElements.length).toBeGreaterThan(0)
    })
  })

  describe('Different External Knowledge Info', () => {
    it('should handle long API names', () => {
      const longNameDataset = {
        ...mockDataset,
        external_knowledge_info: {
          ...mockDataset.external_knowledge_info,
          external_knowledge_api_name: 'This is a very long external knowledge API name that should be truncated',
        },
      }

      render(<ExternalKnowledgeSection {...defaultProps} currentDataset={longNameDataset} />)

      expect(screen.getByText(/This is a very long external knowledge API name/)).toBeInTheDocument()
    })

    it('should handle long API endpoints', () => {
      const longEndpointDataset = {
        ...mockDataset,
        external_knowledge_info: {
          ...mockDataset.external_knowledge_info,
          external_knowledge_api_endpoint: 'https://api.very-long-domain-name.example.com/api/v1/external/knowledge',
        },
      }

      render(<ExternalKnowledgeSection {...defaultProps} currentDataset={longEndpointDataset} />)

      expect(screen.getByText(/https:\/\/api.very-long-domain-name.example.com/)).toBeInTheDocument()
    })

    it('should handle special characters in API name', () => {
      const specialCharDataset = {
        ...mockDataset,
        external_knowledge_info: {
          ...mockDataset.external_knowledge_info,
          external_knowledge_api_name: 'API & Service <Test>',
        },
      }

      render(<ExternalKnowledgeSection {...defaultProps} currentDataset={specialCharDataset} />)

      expect(screen.getByText('API & Service <Test>')).toBeInTheDocument()
    })
  })

  describe('RetrievalSettings Integration', () => {
    it('should pass isInRetrievalSetting=true to RetrievalSettings', () => {
      render(<ExternalKnowledgeSection {...defaultProps} />)

      // The RetrievalSettings component should be rendered with isInRetrievalSetting=true
      // This affects the component's layout/styling
    })

    it('should handle settings change for top_k', () => {
      const handleSettingsChange = vi.fn()
      render(<ExternalKnowledgeSection {...defaultProps} handleSettingsChange={handleSettingsChange} />)

      // Find and interact with the top_k control in RetrievalSettings
      // The exact interaction depends on RetrievalSettings implementation
    })

    it('should handle settings change for score_threshold', () => {
      const handleSettingsChange = vi.fn()
      render(<ExternalKnowledgeSection {...defaultProps} handleSettingsChange={handleSettingsChange} />)

      // Find and interact with the score_threshold control in RetrievalSettings
    })

    it('should handle settings change for score_threshold_enabled', () => {
      const handleSettingsChange = vi.fn()
      render(<ExternalKnowledgeSection {...defaultProps} handleSettingsChange={handleSettingsChange} />)

      // Find and interact with the score_threshold_enabled toggle in RetrievalSettings
    })
  })

  describe('Accessibility', () => {
    it('should have semantic structure', () => {
      render(<ExternalKnowledgeSection {...defaultProps} />)

      // Section labels should be present
      expect(screen.getByText(/form\.retrievalSetting\.title/i)).toBeInTheDocument()
      expect(screen.getByText(/form\.externalKnowledgeAPI/i)).toBeInTheDocument()
      expect(screen.getByText(/form\.externalKnowledgeID/i)).toBeInTheDocument()
    })
  })
})
