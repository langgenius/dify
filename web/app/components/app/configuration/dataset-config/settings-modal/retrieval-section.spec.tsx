import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DataSet } from '@/models/datasets'
import { ChunkingMode, DataSourceType, DatasetPermission, RerankingModeEnum } from '@/models/datasets'
import { RETRIEVE_METHOD, type RetrievalConfig } from '@/types/app'
import { IndexingType } from '@/app/components/datasets/create/step-two'

jest.mock('ky', () => {
  const ky = () => ky
  ky.extend = () => ky
  ky.create = () => ky
  return { __esModule: true, default: ky }
})

jest.mock('@/app/components/datasets/create/step-two', () => ({
  __esModule: true,
  IndexingType: {
    QUALIFIED: 'high_quality',
    ECONOMICAL: 'economy',
  },
}))

jest.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    supportRetrievalMethods: [
      RETRIEVE_METHOD.semantic,
      RETRIEVE_METHOD.fullText,
      RETRIEVE_METHOD.hybrid,
      RETRIEVE_METHOD.keywordSearch,
    ],
  }),
}))

jest.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  __esModule: true,
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: null,
    currentModel: true,
  }),
  useModelListAndDefaultModel: () => ({
    modelList: [],
  }),
  useCurrentProviderAndModel: () => ({
    currentModel: { provider: 'provider', model: 'model' },
  }),
  useModelList: jest.fn(() => ({ data: [] })),
}))

jest.mock('@/app/components/base/toast', () => ({
  __esModule: true,
  default: { notify: jest.fn() },
  useToastContext: () => ({ notify: jest.fn() }),
}))

import { RetrievalChangeTip, RetrievalSection } from './retrieval-section'

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
    onDismiss: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing when visible', () => {
      render(<RetrievalChangeTip {...defaultProps} />)

      expect(screen.getByText('Test message')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'close-retrieval-change-tip' })).toBeInTheDocument()
    })

    it('should not render when not visible', () => {
      render(<RetrievalChangeTip {...defaultProps} visible={false} />)

      expect(screen.queryByText('Test message')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('close-retrieval-change-tip')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display the correct message', () => {
      render(<RetrievalChangeTip {...defaultProps} message='Custom warning message' />)

      expect(screen.getByText('Custom warning message')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onDismiss when close button is clicked', async () => {
      const onDismiss = jest.fn()
      render(<RetrievalChangeTip {...defaultProps} onDismiss={onDismiss} />)
      await userEvent.click(screen.getByRole('button', { name: 'close-retrieval-change-tip' }))

      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('should prevent click bubbling when close button is clicked', async () => {
      const onDismiss = jest.fn()
      const parentClick = jest.fn()
      render(
        <div onClick={parentClick}>
          <RetrievalChangeTip {...defaultProps} onDismiss={onDismiss} />
        </div>,
      )

      await userEvent.click(screen.getByRole('button', { name: 'close-retrieval-change-tip' }))

      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(parentClick).not.toHaveBeenCalled()
    })
  })
})

describe('RetrievalSection', () => {
  const t = (key: string) => key
  const rowClass = 'row'
  const labelClass = 'label'

  it('should render external retrieval details', () => {
    const dataset = createDataset({
      provider: 'external',
      external_knowledge_info: {
        external_knowledge_id: 'ext-id-999',
        external_knowledge_api_id: 'ext-api-id-999',
        external_knowledge_api_name: 'External API',
        external_knowledge_api_endpoint: 'https://api.external.com',
      },
    })

    render(
      <div>
        <RetrievalSection
          isExternal
          rowClass={rowClass}
          labelClass={labelClass}
          t={t}
          topK={3}
          scoreThreshold={0.4}
          scoreThresholdEnabled
          onExternalSettingChange={jest.fn()}
          currentDataset={dataset}
        />
      </div>,
    )

    expect(screen.getByText('External API')).toBeInTheDocument()
    expect(screen.getByText('https://api.external.com')).toBeInTheDocument()
    expect(screen.getByText('ext-id-999')).toBeInTheDocument()
    expect(screen.getByText('appDebug.datasetConfig.top_k')).toBeInTheDocument()
  })

  it('should render internal retrieval config when indexing is qualified', () => {
    const docLink = jest.fn((path: string) => `https://docs.example${path}`)
    const retrievalConfig = createRetrievalConfig()

    render(
      <RetrievalSection
        isExternal={false}
        rowClass={rowClass}
        labelClass={labelClass}
        t={t}
        indexMethod={IndexingType.QUALIFIED}
        retrievalConfig={retrievalConfig}
        showMultiModalTip
        onRetrievalConfigChange={jest.fn()}
        docLink={docLink}
      />,
    )

    expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
    const learnMoreLink = screen.getByRole('link', { name: 'datasetSettings.form.retrievalSetting.learnMore' })
    expect(learnMoreLink).toHaveAttribute('href', 'https://docs.example/guides/knowledge-base/create-knowledge-and-upload-documents/setting-indexing-methods#setting-the-retrieval-setting')
    expect(docLink).toHaveBeenCalledWith('/guides/knowledge-base/create-knowledge-and-upload-documents/setting-indexing-methods#setting-the-retrieval-setting')
  })

  it('should render economical retrieval config when indexing is economical', () => {
    render(
      <RetrievalSection
        isExternal={false}
        rowClass={rowClass}
        labelClass={labelClass}
        t={t}
        indexMethod={IndexingType.ECONOMICAL}
        retrievalConfig={createRetrievalConfig()}
        showMultiModalTip={false}
        onRetrievalConfigChange={jest.fn()}
        docLink={path => path}
      />,
    )

    expect(screen.getByText('dataset.retrieval.keyword_search.title')).toBeInTheDocument()
    expect(screen.queryByText('dataset.retrieval.semantic_search.title')).not.toBeInTheDocument()
  })
})
