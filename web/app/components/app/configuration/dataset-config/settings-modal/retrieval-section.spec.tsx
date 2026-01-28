import type { DataSet } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ChunkingMode, DatasetPermission, DataSourceType, RerankingModeEnum } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { RetrievalChangeTip, RetrievalSection } from './retrieval-section'

const mockUseModelList = vi.fn()
const mockUseModelListAndDefaultModel = vi.fn()
const mockUseModelListAndDefaultModelAndCurrentProviderAndModel = vi.fn()
const mockUseCurrentProviderAndModel = vi.fn()

vi.mock('ky', () => {
  const ky = () => ky
  ky.extend = () => ky
  ky.create = () => ky
  return { __esModule: true, default: ky }
})

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders: [],
    textGenerationModelList: [],
    supportRetrievalMethods: [
      RETRIEVE_METHOD.semantic,
      RETRIEVE_METHOD.fullText,
      RETRIEVE_METHOD.hybrid,
      RETRIEVE_METHOD.keywordSearch,
    ],
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: (...args: unknown[]) =>
    mockUseModelListAndDefaultModelAndCurrentProviderAndModel(...args),
  useModelListAndDefaultModel: (...args: unknown[]) => mockUseModelListAndDefaultModel(...args),
  useModelList: (...args: unknown[]) => mockUseModelList(...args),
  useCurrentProviderAndModel: (...args: unknown[]) => mockUseCurrentProviderAndModel(...args),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ defaultModel }: { defaultModel?: { provider: string, model: string } }) => (
    <div data-testid="model-selector">
      {defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : 'no-model'}
    </div>
  ),
}))

vi.mock('@/app/components/datasets/create/step-two', () => ({
  IndexingType: {
    QUALIFIED: 'high_quality',
    ECONOMICAL: 'economy',
  },
}))

const createRetrievalConfig = (overrides: Partial<RetrievalConfig> = {}): RetrievalConfig => ({
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: {
    reranking_provider_name: '',
    reranking_model_name: '',
  },
  top_k: 2,
  score_threshold_enabled: false,
  score_threshold: 0.5,
  reranking_mode: RerankingModeEnum.RerankingModel,
  ...overrides,
})

const createDataset = (overrides: Partial<DataSet> = {}, retrievalOverrides: Partial<RetrievalConfig> = {}): DataSet => {
  const retrievalConfig = createRetrievalConfig(retrievalOverrides)
  return {
    id: 'dataset-id',
    name: 'Test Dataset',
    indexing_status: 'completed',
    icon_info: {
      icon: 'icon',
      icon_type: 'emoji',
    },
    description: 'Description',
    permission: DatasetPermission.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    author_name: 'Author',
    created_by: 'creator',
    updated_by: 'updater',
    updated_at: 1700000000,
    app_count: 0,
    doc_form: ChunkingMode.text,
    document_count: 0,
    total_document_count: 0,
    total_available_documents: 0,
    word_count: 0,
    provider: 'internal',
    embedding_model: 'embed-model',
    embedding_model_provider: 'embed-provider',
    embedding_available: true,
    tags: [],
    partial_member_list: [],
    external_knowledge_info: {
      external_knowledge_id: 'ext-id',
      external_knowledge_api_id: 'ext-api-id',
      external_knowledge_api_name: 'External API',
      external_knowledge_api_endpoint: 'https://api.example.com',
    },
    external_retrieval_model: {
      top_k: 2,
      score_threshold: 0.5,
      score_threshold_enabled: false,
    },
    built_in_field_enabled: false,
    doc_metadata: [],
    keyword_number: 10,
    pipeline_id: 'pipeline-id',
    is_published: false,
    runtime_mode: 'general',
    enable_api: true,
    is_multimodal: false,
    ...overrides,
    retrieval_model_dict: {
      ...retrievalConfig,
      ...overrides.retrieval_model_dict,
    },
    retrieval_model: {
      ...retrievalConfig,
      ...overrides.retrieval_model,
    },
  }
}

describe('RetrievalChangeTip', () => {
  const defaultProps = {
    visible: true,
    message: 'Test message',
    onDismiss: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders and supports dismiss', async () => {
    // Arrange
    const onDismiss = vi.fn()
    render(<RetrievalChangeTip {...defaultProps} onDismiss={onDismiss} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'close-retrieval-change-tip' }))

    // Assert
    expect(screen.getByText('Test message')).toBeInTheDocument()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not render when hidden', () => {
    // Arrange & Act
    render(<RetrievalChangeTip {...defaultProps} visible={false} />)

    // Assert
    expect(screen.queryByText('Test message')).not.toBeInTheDocument()
  })
})

describe('RetrievalSection', () => {
  const t = (key: string, options?: { ns?: string }) => {
    const prefix = options?.ns ? `${options.ns}.` : ''
    return `${prefix}${key}`
  }
  const rowClass = 'row'
  const labelClass = 'label'

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseModelList.mockImplementation((type: ModelTypeEnum) => {
      if (type === ModelTypeEnum.rerank)
        return { data: [{ provider: 'rerank-provider', models: [{ model: 'rerank-model' }] }] }
      return { data: [] }
    })
    mockUseModelListAndDefaultModel.mockReturnValue({ modelList: [], defaultModel: null })
    mockUseModelListAndDefaultModelAndCurrentProviderAndModel.mockReturnValue({ defaultModel: null, currentModel: null })
    mockUseCurrentProviderAndModel.mockReturnValue({ currentProvider: null, currentModel: null })
  })

  it('renders external retrieval details and propagates changes', async () => {
    // Arrange
    const dataset = createDataset({
      provider: 'external',
      external_knowledge_info: {
        external_knowledge_id: 'ext-id-999',
        external_knowledge_api_id: 'ext-api-id-999',
        external_knowledge_api_name: 'External API',
        external_knowledge_api_endpoint: 'https://api.external.com',
      },
    })
    const handleExternalChange = vi.fn()

    // Act
    render(
      <RetrievalSection
        isExternal
        rowClass={rowClass}
        labelClass={labelClass}
        t={t}
        topK={3}
        scoreThreshold={0.4}
        scoreThresholdEnabled
        onExternalSettingChange={handleExternalChange}
        currentDataset={dataset}
      />,
    )
    const [topKIncrement] = screen.getAllByLabelText('increment')
    await userEvent.click(topKIncrement)

    // Assert
    expect(screen.getByText('External API')).toBeInTheDocument()
    expect(screen.getByText('https://api.external.com')).toBeInTheDocument()
    expect(screen.getByText('ext-id-999')).toBeInTheDocument()
    expect(handleExternalChange).toHaveBeenCalledWith(expect.objectContaining({ top_k: 4 }))
  })

  it('renders internal retrieval config with doc link', () => {
    // Arrange
    const docLink = vi.fn((path: string) => `https://docs.example${path}`)
    const retrievalConfig = createRetrievalConfig()

    // Act
    render(
      <RetrievalSection
        isExternal={false}
        rowClass={rowClass}
        labelClass={labelClass}
        t={t}
        indexMethod={IndexingType.QUALIFIED}
        retrievalConfig={retrievalConfig}
        showMultiModalTip
        onRetrievalConfigChange={vi.fn()}
        docLink={docLink as unknown as (path?: DocPathWithoutLang) => string}
      />,
    )

    // Assert
    expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
    const learnMoreLink = screen.getByRole('link', { name: 'datasetSettings.form.retrievalSetting.learnMore' })
    expect(learnMoreLink).toHaveAttribute('href', 'https://docs.example/use-dify/knowledge/create-knowledge/setting-indexing-methods')
    expect(docLink).toHaveBeenCalledWith('/use-dify/knowledge/create-knowledge/setting-indexing-methods')
  })

  it('propagates retrieval config changes for economical indexing', async () => {
    // Arrange
    const handleRetrievalChange = vi.fn()

    // Act
    render(
      <RetrievalSection
        isExternal={false}
        rowClass={rowClass}
        labelClass={labelClass}
        t={t}
        indexMethod={IndexingType.ECONOMICAL}
        retrievalConfig={createRetrievalConfig()}
        showMultiModalTip={false}
        onRetrievalConfigChange={handleRetrievalChange}
        docLink={path => path || ''}
      />,
    )
    const [topKIncrement] = screen.getAllByLabelText('increment')
    await userEvent.click(topKIncrement)

    // Assert
    expect(screen.getByText('dataset.retrieval.keyword_search.title')).toBeInTheDocument()
    expect(handleRetrievalChange).toHaveBeenCalledWith(expect.objectContaining({
      top_k: 3,
    }))
  })
})
