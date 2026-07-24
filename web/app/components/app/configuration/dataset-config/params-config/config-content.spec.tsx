import type { MockedFunction, MockInstance } from 'vitest'
import type { IndexingType } from '@/app/components/datasets/create/step-two'
import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs } from '@/models/debug'
import type { RetrievalConfig } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Toast from '@/app/components/base/toast'
import {
  useCurrentProviderAndModel,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ChunkingMode, DatasetPermission, DataSourceType, RerankingModeEnum, WeightedScoreEnum } from '@/models/datasets'
import { RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'
import ConfigContent from './config-content'

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => {
  type Props = {
    defaultModel?: { provider: string, model: string }
    onSelect?: (model: { provider: string, model: string }) => void
  }

  const MockModelSelector = ({ defaultModel, onSelect }: Props) => (
    <button
      type="button"
      onClick={() => onSelect?.(defaultModel ?? { provider: 'mock-provider', model: 'mock-model' })}
    >
      Mock ModelSelector
    </button>
  )

  return {
    default: MockModelSelector,
  }
})

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: () => <div data-testid="model-parameter-modal" />,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: vi.fn(),
  useCurrentProviderAndModel: vi.fn(),
}))

const mockedUseModelListAndDefaultModelAndCurrentProviderAndModel = useModelListAndDefaultModelAndCurrentProviderAndModel as MockedFunction<typeof useModelListAndDefaultModelAndCurrentProviderAndModel>
const mockedUseCurrentProviderAndModel = useCurrentProviderAndModel as MockedFunction<typeof useCurrentProviderAndModel>

let toastNotifySpy: MockInstance

const baseRetrievalConfig: RetrievalConfig = {
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: {
    reranking_provider_name: 'provider',
    reranking_model_name: 'rerank-model',
  },
  top_k: 4,
  score_threshold_enabled: false,
  score_threshold: 0,
}

const defaultIndexingTechnique: IndexingType = 'high_quality' as IndexingType

const createDataset = (overrides: Partial<DataSet> = {}): DataSet => {
  const {
    retrieval_model,
    retrieval_model_dict,
    icon_info,
    ...restOverrides
  } = overrides

  const resolvedRetrievalModelDict = {
    ...baseRetrievalConfig,
    ...retrieval_model_dict,
  }
  const resolvedRetrievalModel = {
    ...baseRetrievalConfig,
    ...(retrieval_model ?? retrieval_model_dict),
  }

  const defaultIconInfo = {
    icon: '📘',
    icon_type: 'emoji',
    icon_background: '#FFEAD5',
    icon_url: '',
  }

  const resolvedIconInfo = ('icon_info' in overrides)
    ? icon_info
    : defaultIconInfo

  return {
    id: 'dataset-id',
    name: 'Dataset Name',
    indexing_status: 'completed',
    icon_info: resolvedIconInfo as DataSet['icon_info'],
    description: 'A test dataset',
    permission: DatasetPermission.onlyMe,
    data_source_type: DataSourceType.FILE,
    indexing_technique: defaultIndexingTechnique,
    author_name: 'author',
    created_by: 'creator',
    updated_by: 'updater',
    updated_at: 0,
    app_count: 0,
    doc_form: ChunkingMode.text,
    document_count: 0,
    total_document_count: 0,
    total_available_documents: 0,
    word_count: 0,
    provider: 'dify',
    embedding_model: 'text-embedding',
    embedding_model_provider: 'openai',
    embedding_available: true,
    retrieval_model_dict: resolvedRetrievalModelDict,
    retrieval_model: resolvedRetrievalModel,
    tags: [],
    external_knowledge_info: {
      external_knowledge_id: 'external-id',
      external_knowledge_api_id: 'api-id',
      external_knowledge_api_name: 'api-name',
      external_knowledge_api_endpoint: 'https://endpoint',
    },
    external_retrieval_model: {
      top_k: 2,
      score_threshold: 0.5,
      score_threshold_enabled: true,
    },
    built_in_field_enabled: true,
    doc_metadata: [],
    keyword_number: 3,
    pipeline_id: 'pipeline-id',
    is_published: true,
    runtime_mode: 'general',
    enable_api: true,
    is_multimodal: false,
    ...restOverrides,
  }
}

const createDatasetConfigs = (overrides: Partial<DatasetConfigs> = {}): DatasetConfigs => {
  return {
    retrieval_model: RETRIEVE_TYPE.multiWay,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 4,
    score_threshold_enabled: false,
    score_threshold: 0,
    datasets: {
      datasets: [],
    },
    reranking_mode: RerankingModeEnum.WeightedScore,
    weights: {
      weight_type: WeightedScoreEnum.Customized,
      vector_setting: {
        vector_weight: 0.5,
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding',
      },
      keyword_setting: {
        keyword_weight: 0.5,
      },
    },
    reranking_enable: false,
    ...overrides,
  }
}

describe('ConfigContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastNotifySpy = vi.spyOn(Toast, 'notify').mockImplementation(() => ({}))
    mockedUseModelListAndDefaultModelAndCurrentProviderAndModel.mockReturnValue({
      modelList: [],
      defaultModel: undefined,
      currentProvider: undefined,
      currentModel: undefined,
    })
    mockedUseCurrentProviderAndModel.mockReturnValue({
      currentProvider: undefined,
      currentModel: undefined,
    })
  })

  afterEach(() => {
    toastNotifySpy.mockRestore()
  })

  // State management
  describe('Effects', () => {
    it('should normalize oneWay retrieval mode to multiWay', async () => {
      // Arrange
      const onChange = vi.fn<(configs: DatasetConfigs, isRetrievalModeChange?: boolean) => void>()
      const datasetConfigs = createDatasetConfigs({ retrieval_model: RETRIEVE_TYPE.oneWay })

      // Act
      render(<ConfigContent datasetConfigs={datasetConfigs} onChange={onChange} />)

      // Assert
      await waitFor(() => {
        expect(onChange).toHaveBeenCalled()
      })
      const [nextConfigs] = onChange.mock.calls[0]
      expect(nextConfigs.retrieval_model).toBe(RETRIEVE_TYPE.multiWay)
    })
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render weighted score panel when datasets are high-quality and consistent', () => {
      // Arrange
      const onChange = vi.fn<(configs: DatasetConfigs, isRetrievalModeChange?: boolean) => void>()
      const datasetConfigs = createDatasetConfigs({
        reranking_mode: RerankingModeEnum.WeightedScore,
      })
      const selectedDatasets: DataSet[] = [
        createDataset({
          indexing_technique: 'high_quality' as IndexingType,
          provider: 'dify',
          embedding_model: 'text-embedding',
          embedding_model_provider: 'openai',
          retrieval_model_dict: {
            ...baseRetrievalConfig,
            search_method: RETRIEVE_METHOD.semantic,
          },
        }),
      ]

      // Act
      render(
        <ConfigContent
          datasetConfigs={datasetConfigs}
          onChange={onChange}
          selectedDatasets={selectedDatasets}
        />,
      )

      // Assert
      expect(screen.getByText('dataset.weightedScore.title')).toBeInTheDocument()
      expect(screen.getByText('common.modelProvider.rerankModel.key')).toBeInTheDocument()
      expect(screen.getByText('dataset.weightedScore.semantic')).toBeInTheDocument()
      expect(screen.getByText('dataset.weightedScore.keyword')).toBeInTheDocument()
    })
  })

  // User interactions
  describe('User Interactions', () => {
    it('should update weights when user changes weighted score slider', async () => {
      // Arrange
      const user = userEvent.setup()
      const onChange = vi.fn<(configs: DatasetConfigs, isRetrievalModeChange?: boolean) => void>()
      const datasetConfigs = createDatasetConfigs({
        reranking_mode: RerankingModeEnum.WeightedScore,
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            vector_weight: 0.5,
            embedding_provider_name: 'openai',
            embedding_model_name: 'text-embedding',
          },
          keyword_setting: {
            keyword_weight: 0.5,
          },
        },
      })
      const selectedDatasets: DataSet[] = [
        createDataset({
          indexing_technique: 'high_quality' as IndexingType,
          provider: 'dify',
          embedding_model: 'text-embedding',
          embedding_model_provider: 'openai',
          retrieval_model_dict: {
            ...baseRetrievalConfig,
            search_method: RETRIEVE_METHOD.semantic,
          },
        }),
      ]

      // Act
      render(
        <ConfigContent
          datasetConfigs={datasetConfigs}
          onChange={onChange}
          selectedDatasets={selectedDatasets}
        />,
      )

      const weightedScoreSlider = screen.getAllByRole('slider')
        .find(slider => slider.getAttribute('aria-valuemax') === '1')
      expect(weightedScoreSlider).toBeDefined()
      await user.click(weightedScoreSlider!)
      const callsBefore = onChange.mock.calls.length
      await user.keyboard('{ArrowRight}')

      // Assert
      expect(onChange.mock.calls.length).toBeGreaterThan(callsBefore)
      const [nextConfigs] = onChange.mock.calls.at(-1) ?? []
      expect(nextConfigs?.weights?.vector_setting.vector_weight).toBeCloseTo(0.6, 5)
      expect(nextConfigs?.weights?.keyword_setting.keyword_weight).toBeCloseTo(0.4, 5)
    })

    it('should warn when switching to rerank model mode without a valid model', async () => {
      // Arrange
      const user = userEvent.setup()
      const onChange = vi.fn<(configs: DatasetConfigs, isRetrievalModeChange?: boolean) => void>()
      const datasetConfigs = createDatasetConfigs({
        reranking_mode: RerankingModeEnum.WeightedScore,
      })
      const selectedDatasets: DataSet[] = [
        createDataset({
          indexing_technique: 'high_quality' as IndexingType,
          provider: 'dify',
          embedding_model: 'text-embedding',
          embedding_model_provider: 'openai',
          retrieval_model_dict: {
            ...baseRetrievalConfig,
            search_method: RETRIEVE_METHOD.semantic,
          },
        }),
      ]

      // Act
      render(
        <ConfigContent
          datasetConfigs={datasetConfigs}
          onChange={onChange}
          selectedDatasets={selectedDatasets}
        />,
      )
      await user.click(screen.getByText('common.modelProvider.rerankModel.key'))

      // Assert
      expect(toastNotifySpy).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.errorMsg.rerankModelRequired',
      })
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          reranking_mode: RerankingModeEnum.RerankingModel,
        }),
      )
    })

    it('should warn when enabling rerank without a valid model in manual toggle mode', async () => {
      // Arrange
      const user = userEvent.setup()
      const onChange = vi.fn<(configs: DatasetConfigs, isRetrievalModeChange?: boolean) => void>()
      const datasetConfigs = createDatasetConfigs({
        reranking_enable: false,
      })
      const selectedDatasets: DataSet[] = [
        createDataset({
          indexing_technique: 'economy' as IndexingType,
          provider: 'dify',
          embedding_model: 'text-embedding',
          embedding_model_provider: 'openai',
          retrieval_model_dict: {
            ...baseRetrievalConfig,
            search_method: RETRIEVE_METHOD.semantic,
          },
        }),
      ]

      // Act
      render(
        <ConfigContent
          datasetConfigs={datasetConfigs}
          onChange={onChange}
          selectedDatasets={selectedDatasets}
        />,
      )
      await user.click(screen.getByRole('switch'))

      // Assert
      expect(toastNotifySpy).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.errorMsg.rerankModelRequired',
      })
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          reranking_enable: true,
        }),
      )
    })
  })
})
