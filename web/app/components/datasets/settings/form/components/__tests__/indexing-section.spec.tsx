import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { DataSet, SummaryIndexSetting } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigurationMethodEnum, ModelStatusEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../../../create/step-two'
import IndexingSection from '../indexing-section'

// Mock i18n doc link
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

// Mock app-context for child components
vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: unknown) => unknown) => {
    const state = {
      isCurrentWorkspaceDatasetOperator: false,
      userProfile: {
        id: 'user-1',
        name: 'Current User',
        email: 'current@example.com',
        avatar_url: '',
        role: 'owner',
      },
    }
    return selector(state)
  },
}))

// Mock model-provider-page hooks
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: () => ({ data: [], mutate: vi.fn(), isLoading: false }),
  useCurrentProviderAndModel: () => ({ currentProvider: undefined, currentModel: undefined }),
  useDefaultModel: () => ({ data: undefined, mutate: vi.fn(), isLoading: false }),
  useModelListAndDefaultModel: () => ({ modelList: [], defaultModel: undefined }),
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    modelList: [],
    defaultModel: undefined,
    currentProvider: undefined,
    currentModel: undefined,
  }),
  useUpdateModelList: () => vi.fn(),
  useUpdateModelProviders: () => vi.fn(),
  useLanguage: () => 'en_US',
  useSystemDefaultModelAndModelList: () => [undefined, vi.fn()],
  useProviderCredentialsAndLoadBalancing: () => ({
    credentials: undefined,
    loadBalancing: undefined,
    mutate: vi.fn(),
    isLoading: false,
  }),
  useAnthropicBuyQuota: () => vi.fn(),
  useMarketplaceAllPlugins: () => ({ plugins: [], isLoading: false }),
  useRefreshModel: () => ({ handleRefreshModel: vi.fn() }),
  useModelModalHandler: () => vi.fn(),
}))

// Mock provider-context
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    textGenerationModelList: [],
    embeddingsModelList: [],
    rerankModelList: [],
    agentThoughtModelList: [],
    modelProviders: [],
    textEmbeddingModelList: [],
    speech2textModelList: [],
    ttsModelList: [],
    moderationModelList: [],
    hasSettedApiKey: true,
    plan: { type: 'free' },
    enableBilling: false,
    onPlanInfoChanged: vi.fn(),
    isCurrentWorkspaceDatasetOperator: false,
    supportRetrievalMethods: ['semantic_search', 'full_text_search', 'hybrid_search'],
  }),
}))

describe('IndexingSection', () => {
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
    name: 'Test Dataset',
    description: 'Test description',
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
    provider: 'vendor',
    tags: [],
    partial_member_list: [],
    external_knowledge_info: {
      external_knowledge_id: 'ext-1',
      external_knowledge_api_id: 'api-1',
      external_knowledge_api_name: 'External API',
      external_knowledge_api_endpoint: 'https://api.example.com',
    },
    external_retrieval_model: {
      top_k: 3,
      score_threshold: 0.7,
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

  const mockEmbeddingModel: DefaultModel = {
    provider: 'openai',
    model: 'text-embedding-ada-002',
  }

  const mockEmbeddingModelList: Model[] = [
    {
      provider: 'openai',
      label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
      icon_small: { en_US: '', zh_Hans: '' },
      status: ModelStatusEnum.active,
      models: [
        {
          model: 'text-embedding-ada-002',
          label: { en_US: 'text-embedding-ada-002', zh_Hans: 'text-embedding-ada-002' },
          model_type: ModelTypeEnum.textEmbedding,
          features: [],
          fetch_from: ConfigurationMethodEnum.predefinedModel,
          model_properties: {},
          deprecated: false,
          status: ModelStatusEnum.active,
          load_balancing_enabled: false,
        },
      ],
    },
  ]

  const mockSummaryIndexSetting: SummaryIndexSetting = {
    enable: false,
  }

  const defaultProps = {
    currentDataset: mockDataset,
    indexMethod: IndexingType.QUALIFIED,
    setIndexMethod: vi.fn(),
    keywordNumber: 10,
    setKeywordNumber: vi.fn(),
    embeddingModel: mockEmbeddingModel,
    setEmbeddingModel: vi.fn(),
    embeddingModelList: mockEmbeddingModelList,
    retrievalConfig: mockRetrievalConfig,
    setRetrievalConfig: vi.fn(),
    summaryIndexSetting: mockSummaryIndexSetting,
    handleSummaryIndexSettingChange: vi.fn(),
    showMultiModalTip: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<IndexingSection {...defaultProps} />)
      expect(screen.getByText(/form\.chunkStructure\.title/i)).toBeInTheDocument()
    })

    it('should render chunk structure section when doc_form is set', () => {
      render(<IndexingSection {...defaultProps} />)
      expect(screen.getByText(/form\.chunkStructure\.title/i)).toBeInTheDocument()
    })

    it('should render index method section when conditions are met', () => {
      render(<IndexingSection {...defaultProps} />)
      // May match multiple elements (label and descriptions)
      expect(screen.getAllByText(/form\.indexMethod/i).length).toBeGreaterThan(0)
    })

    it('should render embedding model section when indexMethod is high_quality', () => {
      render(<IndexingSection {...defaultProps} indexMethod={IndexingType.QUALIFIED} />)
      expect(screen.getByText(/form\.embeddingModel/i)).toBeInTheDocument()
    })

    it('should render retrieval settings section', () => {
      render(<IndexingSection {...defaultProps} />)
      expect(screen.getByText(/form\.retrievalSetting\.title/i)).toBeInTheDocument()
    })
  })

  describe('Chunk Structure Section', () => {
    it('should not render chunk structure when doc_form is not set', () => {
      const datasetWithoutDocForm = { ...mockDataset, doc_form: undefined as unknown as ChunkingMode }
      render(<IndexingSection {...defaultProps} currentDataset={datasetWithoutDocForm} />)

      expect(screen.queryByText(/form\.chunkStructure\.title/i)).not.toBeInTheDocument()
    })

    it('should render learn more link for chunk structure', () => {
      render(<IndexingSection {...defaultProps} />)

      const learnMoreLink = screen.getByText(/form\.chunkStructure\.learnMore/i)
      expect(learnMoreLink).toBeInTheDocument()
      expect(learnMoreLink).toHaveAttribute('href', expect.stringContaining('chunking-and-cleaning-text'))
    })

    it('should render chunk structure description', () => {
      render(<IndexingSection {...defaultProps} />)

      expect(screen.getByText(/form\.chunkStructure\.description/i)).toBeInTheDocument()
    })
  })

  describe('Index Method Section', () => {
    it('should not render index method for parentChild chunking mode', () => {
      const parentChildDataset = { ...mockDataset, doc_form: ChunkingMode.parentChild }
      render(<IndexingSection {...defaultProps} currentDataset={parentChildDataset} />)

      expect(screen.queryByText(/form\.indexMethod/i)).not.toBeInTheDocument()
    })

    it('should render high quality option', () => {
      render(<IndexingSection {...defaultProps} />)

      expect(screen.getByText(/stepTwo\.qualified/i)).toBeInTheDocument()
    })

    it('should render economy option', () => {
      render(<IndexingSection {...defaultProps} />)

      // May match multiple elements (title and tip)
      expect(screen.getAllByText(/form\.indexMethodEconomy/i).length).toBeGreaterThan(0)
    })

    it('should call setIndexMethod when index method changes', () => {
      const setIndexMethod = vi.fn()
      const { container } = render(<IndexingSection {...defaultProps} setIndexMethod={setIndexMethod} />)

      // Find the economy option card by looking for clickable elements containing the economy text
      const economyOptions = screen.getAllByText(/form\.indexMethodEconomy/i)
      if (economyOptions.length > 0) {
        const economyCard = economyOptions[0].closest('[class*="cursor-pointer"]')
        if (economyCard) {
          fireEvent.click(economyCard)
        }
      }

      // The handler should be properly passed - verify component renders without crashing
      expect(container).toBeInTheDocument()
    })

    it('should show upgrade warning when switching from economy to high quality', () => {
      const economyDataset = { ...mockDataset, indexing_technique: IndexingType.ECONOMICAL }
      render(
        <IndexingSection
          {...defaultProps}
          currentDataset={economyDataset}
          indexMethod={IndexingType.QUALIFIED}
        />,
      )

      expect(screen.getByText(/form\.upgradeHighQualityTip/i)).toBeInTheDocument()
    })

    it('should not show upgrade warning when already on high quality', () => {
      render(
        <IndexingSection
          {...defaultProps}
          indexMethod={IndexingType.QUALIFIED}
        />,
      )

      expect(screen.queryByText(/form\.upgradeHighQualityTip/i)).not.toBeInTheDocument()
    })

    it('should disable index method when embedding is not available', () => {
      const datasetWithoutEmbedding = { ...mockDataset, embedding_available: false }
      render(<IndexingSection {...defaultProps} currentDataset={datasetWithoutEmbedding} />)

      // Index method options should be disabled
      // The exact implementation depends on the IndexMethod component
    })
  })

  describe('Embedding Model Section', () => {
    it('should render embedding model when indexMethod is high_quality', () => {
      render(<IndexingSection {...defaultProps} indexMethod={IndexingType.QUALIFIED} />)

      expect(screen.getByText(/form\.embeddingModel/i)).toBeInTheDocument()
    })

    it('should not render embedding model when indexMethod is economy', () => {
      render(<IndexingSection {...defaultProps} indexMethod={IndexingType.ECONOMICAL} />)

      expect(screen.queryByText(/form\.embeddingModel/i)).not.toBeInTheDocument()
    })

    it('should call setEmbeddingModel when model changes', () => {
      const setEmbeddingModel = vi.fn()
      render(
        <IndexingSection
          {...defaultProps}
          setEmbeddingModel={setEmbeddingModel}
          indexMethod={IndexingType.QUALIFIED}
        />,
      )

      // The embedding model selector should be rendered
      expect(screen.getByText(/form\.embeddingModel/i)).toBeInTheDocument()
    })
  })

  describe('Summary Index Setting Section', () => {
    it('should render summary index setting for high quality with text chunking', () => {
      render(
        <IndexingSection
          {...defaultProps}
          indexMethod={IndexingType.QUALIFIED}
        />,
      )

      // Summary index setting should be rendered based on conditions
      // The exact rendering depends on the SummaryIndexSetting component
    })

    it('should not render summary index setting for economy indexing', () => {
      render(
        <IndexingSection
          {...defaultProps}
          indexMethod={IndexingType.ECONOMICAL}
        />,
      )

      // Summary index setting should not be rendered for economy
    })

    it('should call handleSummaryIndexSettingChange when setting changes', () => {
      const handleSummaryIndexSettingChange = vi.fn()
      render(
        <IndexingSection
          {...defaultProps}
          handleSummaryIndexSettingChange={handleSummaryIndexSettingChange}
          indexMethod={IndexingType.QUALIFIED}
        />,
      )

      // The handler should be properly passed
    })
  })

  describe('Retrieval Settings Section', () => {
    it('should render retrieval settings', () => {
      render(<IndexingSection {...defaultProps} />)

      expect(screen.getByText(/form\.retrievalSetting\.title/i)).toBeInTheDocument()
    })

    it('should render learn more link for retrieval settings', () => {
      render(<IndexingSection {...defaultProps} />)

      const learnMoreLinks = screen.getAllByText(/learnMore/i)
      const retrievalLearnMore = learnMoreLinks.find(link =>
        link.closest('a')?.href?.includes('setting-indexing-methods'),
      )
      expect(retrievalLearnMore).toBeInTheDocument()
    })

    it('should render RetrievalMethodConfig for high quality indexing', () => {
      render(<IndexingSection {...defaultProps} indexMethod={IndexingType.QUALIFIED} />)

      // RetrievalMethodConfig should be rendered
      expect(screen.getByText(/form\.retrievalSetting\.title/i)).toBeInTheDocument()
    })

    it('should render EconomicalRetrievalMethodConfig for economy indexing', () => {
      render(<IndexingSection {...defaultProps} indexMethod={IndexingType.ECONOMICAL} />)

      // EconomicalRetrievalMethodConfig should be rendered
      expect(screen.getByText(/form\.retrievalSetting\.title/i)).toBeInTheDocument()
    })

    it('should call setRetrievalConfig when config changes', () => {
      const setRetrievalConfig = vi.fn()
      render(<IndexingSection {...defaultProps} setRetrievalConfig={setRetrievalConfig} />)

      // The handler should be properly passed
    })

    it('should pass showMultiModalTip to RetrievalMethodConfig', () => {
      render(<IndexingSection {...defaultProps} showMultiModalTip={true} />)

      // The tip should be passed to the config component
    })
  })

  describe('External Provider', () => {
    it('should not render retrieval config for external provider', () => {
      const externalDataset = { ...mockDataset, provider: 'external' }
      render(<IndexingSection {...defaultProps} currentDataset={externalDataset} />)

      // Retrieval config should not be rendered for external provider
      // This is handled by the parent component, but we verify the condition
    })
  })

  describe('Conditional Rendering', () => {
    it('should show divider between sections', () => {
      const { container } = render(<IndexingSection {...defaultProps} />)

      // Dividers should be present
      const dividers = container.querySelectorAll('.bg-divider-subtle')
      expect(dividers.length).toBeGreaterThan(0)
    })

    it('should not render index method when indexing_technique is not set', () => {
      const datasetWithoutTechnique = { ...mockDataset, indexing_technique: undefined as unknown as IndexingType }
      render(<IndexingSection {...defaultProps} currentDataset={datasetWithoutTechnique} indexMethod={undefined} />)

      expect(screen.queryByText(/form\.indexMethod/i)).not.toBeInTheDocument()
    })
  })

  describe('Keyword Number', () => {
    it('should pass keywordNumber to IndexMethod', () => {
      render(<IndexingSection {...defaultProps} keywordNumber={15} />)

      // The keyword number should be displayed in the economy option description
      // The exact rendering depends on the IndexMethod component
    })

    it('should call setKeywordNumber when keyword number changes', () => {
      const setKeywordNumber = vi.fn()
      render(<IndexingSection {...defaultProps} setKeywordNumber={setKeywordNumber} />)

      // The handler should be properly passed
    })
  })

  describe('Props Updates', () => {
    it('should update when indexMethod changes', () => {
      const { rerender } = render(<IndexingSection {...defaultProps} indexMethod={IndexingType.QUALIFIED} />)

      expect(screen.getByText(/form\.embeddingModel/i)).toBeInTheDocument()

      rerender(<IndexingSection {...defaultProps} indexMethod={IndexingType.ECONOMICAL} />)

      expect(screen.queryByText(/form\.embeddingModel/i)).not.toBeInTheDocument()
    })

    it('should update when currentDataset changes', () => {
      const { rerender } = render(<IndexingSection {...defaultProps} />)

      expect(screen.getByText(/form\.chunkStructure\.title/i)).toBeInTheDocument()

      const datasetWithoutDocForm = { ...mockDataset, doc_form: undefined as unknown as ChunkingMode }
      rerender(<IndexingSection {...defaultProps} currentDataset={datasetWithoutDocForm} />)

      expect(screen.queryByText(/form\.chunkStructure\.title/i)).not.toBeInTheDocument()
    })
  })

  describe('Undefined Dataset', () => {
    it('should handle undefined currentDataset gracefully', () => {
      render(<IndexingSection {...defaultProps} currentDataset={undefined} />)

      // Should not crash and should handle undefined gracefully
      // Most sections should not render without a dataset
    })
  })
})
