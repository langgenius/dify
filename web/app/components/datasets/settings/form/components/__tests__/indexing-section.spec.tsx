import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { DataSet, SummaryIndexSetting } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigurationMethodEnum, ModelStatusEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../../../create/step-two'
import IndexingSection from '../indexing-section'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

vi.mock('@/app/components/base/divider', () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="divider" className={className} />
  ),
}))

vi.mock('@/app/components/datasets/settings/chunk-structure', () => ({
  default: ({ chunkStructure }: { chunkStructure: string }) => (
    <div data-testid="chunk-structure" data-mode={chunkStructure}>
      {chunkStructure}
    </div>
  ),
}))

vi.mock('@/app/components/datasets/settings/index-method', () => ({
  default: ({
    value,
    disabled,
    keywordNumber,
    onChange,
    onKeywordNumberChange,
  }: {
    value: string
    disabled?: boolean
    keywordNumber: number
    onChange: (value: IndexingType) => void
    onKeywordNumberChange: (value: number) => void
  }) => (
    <div
      data-testid="index-method"
      data-disabled={disabled ? 'true' : 'false'}
      data-keyword-number={String(keywordNumber)}
      data-value={value}
    >
      <button type="button" onClick={() => onChange(IndexingType.QUALIFIED)}>
        stepTwo.qualified
      </button>
      <button type="button" onClick={() => onChange(IndexingType.ECONOMICAL)}>
        form.indexMethodEconomy
      </button>
      <button type="button" onClick={() => onKeywordNumberChange(keywordNumber + 1)}>
        keyword-number-increment
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({
    defaultModel,
    onSelect,
  }: {
    defaultModel?: DefaultModel
    onSelect?: (value: DefaultModel) => void
  }) => (
    <div
      data-testid="model-selector"
      data-model={defaultModel?.model ?? ''}
      data-provider={defaultModel?.provider ?? ''}
    >
      <button
        type="button"
        onClick={() => onSelect?.({ provider: 'cohere', model: 'embed-english-v3.0' })}
      >
        select-model
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/datasets/settings/summary-index-setting', () => ({
  default: ({
    summaryIndexSetting,
    onSummaryIndexSettingChange,
  }: {
    summaryIndexSetting?: SummaryIndexSetting
    onSummaryIndexSettingChange?: (payload: SummaryIndexSetting) => void
  }) => (
    <div data-testid="summary-index-setting" data-enabled={summaryIndexSetting?.enable ? 'true' : 'false'}>
      <button type="button" onClick={() => onSummaryIndexSettingChange?.({ enable: true })}>
        summary-enable
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/datasets/common/retrieval-method-config', () => ({
  default: ({
    showMultiModalTip,
    onChange,
    value,
  }: {
    showMultiModalTip?: boolean
    onChange: (value: RetrievalConfig) => void
    value: RetrievalConfig
  }) => (
    <div data-testid="retrieval-method-config">
      {showMultiModalTip && <span>show-multimodal-tip</span>}
      <button
        type="button"
        onClick={() =>
          onChange({
            ...value,
            top_k: 6,
          })}
      >
        update-retrieval
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/datasets/common/economical-retrieval-method-config', () => ({
  default: ({
    onChange,
    value,
  }: {
    onChange: (value: RetrievalConfig) => void
    value: RetrievalConfig
  }) => (
    <div data-testid="economical-retrieval-method-config">
      <button
        type="button"
        onClick={() =>
          onChange({
            ...value,
            search_method: RETRIEVE_METHOD.keywordSearch,
          })}
      >
        update-economy-retrieval
      </button>
    </div>
  ),
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

  const renderComponent = (props: Partial<typeof defaultProps> = {}) => {
    return render(<IndexingSection {...defaultProps} {...props} />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the chunk structure, index method, and retrieval sections for a standard dataset', () => {
      renderComponent()

      expect(screen.getByText('form.chunkStructure.title')).toBeInTheDocument()
      expect(screen.getByTestId('chunk-structure')).toHaveAttribute('data-mode', ChunkingMode.text)
      expect(screen.getByText('form.indexMethod')).toBeInTheDocument()
      expect(screen.getByTestId('index-method')).toBeInTheDocument()
      expect(screen.getByText('form.retrievalSetting.title')).toBeInTheDocument()
    })

    it('should render the embedding model selector when the index method is high quality', () => {
      renderComponent()

      expect(screen.getByText('form.embeddingModel')).toBeInTheDocument()
      expect(screen.getByTestId('model-selector')).toHaveAttribute('data-model', 'text-embedding-ada-002')
    })
  })

  describe('Chunk Structure Section', () => {
    it('should hide the chunk structure section when the dataset has no doc form', () => {
      renderComponent({
        currentDataset: {
          ...mockDataset,
          doc_form: undefined as unknown as ChunkingMode,
        },
      })

      expect(screen.queryByText('form.chunkStructure.title')).not.toBeInTheDocument()
      expect(screen.queryByTestId('chunk-structure')).not.toBeInTheDocument()
    })

    it('should render the chunk structure learn more link and description', () => {
      renderComponent()

      const learnMoreLink = screen.getByRole('link', { name: 'form.chunkStructure.learnMore' })
      expect(learnMoreLink).toHaveAttribute('href', expect.stringContaining('chunking-and-cleaning-text'))
      expect(screen.getByText('form.chunkStructure.description')).toBeInTheDocument()
    })
  })

  describe('Index Method Section', () => {
    it('should hide the index method section for parent-child chunking', () => {
      renderComponent({
        currentDataset: {
          ...mockDataset,
          doc_form: ChunkingMode.parentChild,
        },
      })

      expect(screen.queryByText('form.indexMethod')).not.toBeInTheDocument()
      expect(screen.queryByTestId('index-method')).not.toBeInTheDocument()
    })

    it('should render both index method options', () => {
      renderComponent()

      expect(screen.getByRole('button', { name: 'stepTwo.qualified' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'form.indexMethodEconomy' })).toBeInTheDocument()
    })

    it('should call setIndexMethod when the user selects a new index method', () => {
      const setIndexMethod = vi.fn()
      renderComponent({ setIndexMethod })

      fireEvent.click(screen.getByRole('button', { name: 'form.indexMethodEconomy' }))

      expect(setIndexMethod).toHaveBeenCalledWith(IndexingType.ECONOMICAL)
    })

    it('should show an upgrade warning when moving from economy to high quality', () => {
      renderComponent({
        currentDataset: {
          ...mockDataset,
          indexing_technique: IndexingType.ECONOMICAL,
        },
      })

      expect(screen.getByText('form.upgradeHighQualityTip')).toBeInTheDocument()
    })

    it('should pass disabled state to the index method when embeddings are unavailable', () => {
      renderComponent({
        currentDataset: {
          ...mockDataset,
          embedding_available: false,
        },
      })

      expect(screen.getByTestId('index-method')).toHaveAttribute('data-disabled', 'true')
    })

    it('should pass the keyword number and update handler through the index method mock', () => {
      const setKeywordNumber = vi.fn()
      renderComponent({
        keywordNumber: 15,
        setKeywordNumber,
      })

      expect(screen.getByTestId('index-method')).toHaveAttribute('data-keyword-number', '15')

      fireEvent.click(screen.getByRole('button', { name: 'keyword-number-increment' }))

      expect(setKeywordNumber).toHaveBeenCalledWith(16)
    })
  })

  describe('Embedding Model Section', () => {
    it('should hide the embedding model selector for economy indexing', () => {
      renderComponent({ indexMethod: IndexingType.ECONOMICAL })

      expect(screen.queryByText('form.embeddingModel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    })

    it('should call setEmbeddingModel when the user selects a model', () => {
      const setEmbeddingModel = vi.fn()
      renderComponent({ setEmbeddingModel })

      fireEvent.click(screen.getByRole('button', { name: 'select-model' }))

      expect(setEmbeddingModel).toHaveBeenCalledWith({
        provider: 'cohere',
        model: 'embed-english-v3.0',
      })
    })
  })

  describe('Summary Index Setting Section', () => {
    it('should render the summary index setting only for high quality text chunking', () => {
      renderComponent()
      expect(screen.getByTestId('summary-index-setting')).toBeInTheDocument()

      renderComponent({
        indexMethod: IndexingType.ECONOMICAL,
      })
      expect(screen.getAllByTestId('summary-index-setting')).toHaveLength(1)
    })

    it('should call handleSummaryIndexSettingChange when the summary setting changes', () => {
      const handleSummaryIndexSettingChange = vi.fn()
      renderComponent({ handleSummaryIndexSettingChange })

      fireEvent.click(screen.getByRole('button', { name: 'summary-enable' }))

      expect(handleSummaryIndexSettingChange).toHaveBeenCalledWith({ enable: true })
    })
  })

  describe('Retrieval Settings Section', () => {
    it('should render the retrieval learn more link', () => {
      renderComponent()

      const learnMoreLink = screen.getByRole('link', { name: 'form.retrievalSetting.learnMore' })
      expect(learnMoreLink).toHaveAttribute('href', expect.stringContaining('setting-indexing-methods'))
      expect(screen.getByText('form.retrievalSetting.description')).toBeInTheDocument()
    })

    it('should render the high-quality retrieval config and propagate changes', () => {
      const setRetrievalConfig = vi.fn()
      renderComponent({ setRetrievalConfig })

      expect(screen.getByTestId('retrieval-method-config')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'update-retrieval' }))

      expect(setRetrievalConfig).toHaveBeenCalledWith({
        ...mockRetrievalConfig,
        top_k: 6,
      })
    })

    it('should render the economical retrieval config for economy indexing', () => {
      const setRetrievalConfig = vi.fn()
      renderComponent({
        indexMethod: IndexingType.ECONOMICAL,
        setRetrievalConfig,
      })

      expect(screen.getByTestId('economical-retrieval-method-config')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'update-economy-retrieval' }))

      expect(setRetrievalConfig).toHaveBeenCalledWith({
        ...mockRetrievalConfig,
        search_method: RETRIEVE_METHOD.keywordSearch,
      })
    })

    it('should pass the multimodal tip flag to the retrieval config', () => {
      renderComponent({ showMultiModalTip: true })

      expect(screen.getByText('show-multimodal-tip')).toBeInTheDocument()
    })

    it('should hide retrieval configuration for external datasets', () => {
      renderComponent({
        currentDataset: {
          ...mockDataset,
          provider: 'external',
        },
      })

      expect(screen.queryByText('form.retrievalSetting.title')).not.toBeInTheDocument()
      expect(screen.queryByTestId('retrieval-method-config')).not.toBeInTheDocument()
      expect(screen.queryByTestId('economical-retrieval-method-config')).not.toBeInTheDocument()
    })
  })

  describe('Conditional Rendering', () => {
    it('should render dividers between visible sections', () => {
      renderComponent()

      expect(screen.getAllByTestId('divider').length).toBeGreaterThan(0)
    })

    it('should hide the index method section when the dataset lacks an indexing technique', () => {
      renderComponent({
        currentDataset: {
          ...mockDataset,
          indexing_technique: undefined as unknown as IndexingType,
        },
        indexMethod: undefined,
      })

      expect(screen.queryByText('form.indexMethod')).not.toBeInTheDocument()
      expect(screen.queryByTestId('index-method')).not.toBeInTheDocument()
    })
  })

  describe('Props Updates', () => {
    it('should update the embedding model section when indexMethod changes', () => {
      const { rerender } = renderComponent()

      expect(screen.getByTestId('model-selector')).toBeInTheDocument()

      rerender(<IndexingSection {...defaultProps} indexMethod={IndexingType.ECONOMICAL} />)

      expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    })

    it('should update the chunk structure section when currentDataset changes', () => {
      const { rerender } = renderComponent()

      expect(screen.getByTestId('chunk-structure')).toBeInTheDocument()

      rerender(
        <IndexingSection
          {...defaultProps}
          currentDataset={{
            ...mockDataset,
            doc_form: undefined as unknown as ChunkingMode,
          }}
        />,
      )

      expect(screen.queryByTestId('chunk-structure')).not.toBeInTheDocument()
    })
  })

  describe('Undefined Dataset', () => {
    it('should render safely when currentDataset is undefined', () => {
      renderComponent({ currentDataset: undefined })

      expect(screen.queryByTestId('chunk-structure')).not.toBeInTheDocument()
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
      expect(screen.getByTestId('retrieval-method-config')).toBeInTheDocument()
    })
  })
})
