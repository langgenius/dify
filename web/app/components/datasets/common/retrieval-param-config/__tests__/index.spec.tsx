import type { RetrievalConfig } from '@/types/app'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_WEIGHTED_SCORE, RerankingModeEnum, WeightedScoreEnum } from '@/models/datasets'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { RETRIEVE_METHOD } from '@/types/app'
import RetrievalParamConfig from '../index'

const mockNotify = vi.fn()
vi.mock('@/app/notifications', () => ({
  toast: {
    error: (message: string) => mockNotify(message),
  },
}))

let modelAvailable = true
const render = createNuqsTestRenderer((ui) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(
    queryClient,
    modelAvailable
      ? [
          createModelCatalogFixture({
            provider: 'rerank-provider',
            models: [
              createCatalogModelFixture({
                model: 'rerank-model',
                label: { en_US: 'Rerank Model' },
                model_type: 'rerank',
              }),
            ],
          }),
          createModelCatalogFixture({
            provider: 'new-provider',
            models: [
              createCatalogModelFixture({
                model: 'new-model',
                label: { en_US: 'New Model' },
                model_type: 'rerank',
              }),
            ],
          }),
        ]
      : [],
  )
  return renderWithConsoleQuery(ui, { queryClient })
})

describe('RetrievalParamConfig', () => {
  const createDefaultConfig = (overrides?: Partial<RetrievalConfig>): RetrievalConfig => ({
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: true,
    reranking_model: {
      reranking_provider_name: 'rerank-provider',
      reranking_model_name: 'rerank-model',
    },
    top_k: 5,
    score_threshold_enabled: true,
    score_threshold: 0.5,
    reranking_mode: RerankingModeEnum.RerankingModel,
    ...overrides,
  })

  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    modelAvailable = true
  })

  describe('Semantic Search Mode', () => {
    it('should render model selector when reranking is enabled', () => {
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByRole('button', { name: /Rerank Model/ }))!.toBeInTheDocument()
    })

    it('should not render model selector when reranking is disabled', () => {
      const config = createDefaultConfig({ reranking_enable: false })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(screen.queryByRole('button', { name: /Rerank Model/ })).not.toBeInTheDocument()
    })

    it('should toggle reranking enable', async () => {
      const user = userEvent.setup()
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      await user.click(
        screen.getByRole('switch', { name: 'modelProvider.modelProvider.rerankModel.key' }),
      )

      expect(mockOnChange).toHaveBeenCalledWith({
        ...config,
        reranking_enable: false,
      })
    })

    it('should show error toast when enabling rerank without model', async () => {
      const user = userEvent.setup()
      modelAvailable = false
      const config = createDefaultConfig({ reranking_enable: false })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      await user.click(
        screen.getByRole('switch', { name: 'modelProvider.modelProvider.rerankModel.key' }),
      )

      expect(mockNotify).toHaveBeenCalledWith('workflow.errorMsg.rerankModelRequired')
    })

    it('should update reranking model on selection', async () => {
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /Rerank Model/ }))
      await user.click(await screen.findByRole('button', { name: /New Model/ }))

      expect(mockOnChange).toHaveBeenCalledWith({
        ...config,
        reranking_model: {
          reranking_provider_name: 'new-provider',
          reranking_model_name: 'new-model',
        },
      })
    })

    it('should update top_k value', async () => {
      const user = userEvent.setup()
      const config = createDefaultConfig()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      await user.click(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }))
      await user.keyboard('{ArrowUp}')

      expect(mockOnChange).toHaveBeenCalledWith({
        ...config,
        top_k: 6,
      })
    })

    it('should update score threshold value', async () => {
      const user = userEvent.setup()
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      await user.click(
        screen.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }),
      )
      await user.keyboard('{ArrowUp}')

      expect(mockOnChange).toHaveBeenCalledWith({
        ...config,
        score_threshold: 0.51,
      })
    })

    it('should toggle score threshold enabled', async () => {
      const user = userEvent.setup()
      const config = createDefaultConfig({ reranking_enable: true, score_threshold_enabled: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      await user.click(
        screen.getByRole('switch', { name: 'appDebug.datasetConfig.score_threshold' }),
      )

      expect(mockOnChange).toHaveBeenCalledWith({
        ...config,
        score_threshold_enabled: false,
      })
    })

    it('should show multimodal tip when showMultiModalTip is true and reranking enabled', () => {
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          showMultiModalTip={true}
          onChange={mockOnChange}
        />,
      )

      expect(
        screen.getByText('datasetSettings.form.retrievalSetting.multiModalTip'),
      )!.toBeInTheDocument()
    })

    it('should not show multimodal tip when showMultiModalTip is false', () => {
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          showMultiModalTip={false}
          onChange={mockOnChange}
        />,
      )

      expect(
        screen.queryByText('datasetSettings.form.retrievalSetting.multiModalTip'),
      ).not.toBeInTheDocument()
    })
  })

  describe('Full Text Search Mode', () => {
    it('should hide score threshold when reranking is disabled for full text search', () => {
      const config = createDefaultConfig({
        search_method: RETRIEVE_METHOD.fullText,
        reranking_enable: false,
      })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.fullText}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(
        screen.queryByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }),
      ).not.toBeInTheDocument()
    })

    it('should show score threshold when reranking is enabled for full text search', () => {
      const config = createDefaultConfig({
        search_method: RETRIEVE_METHOD.fullText,
        reranking_enable: true,
      })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.fullText}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(
        screen.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }),
      )!.toBeInTheDocument()
    })
  })

  describe('Keyword Search Mode (Economical)', () => {
    it('should not render rerank switch for keyword search', () => {
      const config = createDefaultConfig()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.keywordSearch}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(
        screen.queryByRole('switch', { name: 'modelProvider.modelProvider.rerankModel.key' }),
      ).not.toBeInTheDocument()
    })

    it('should not render score threshold for keyword search', () => {
      const config = createDefaultConfig()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.keywordSearch}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(
        screen.queryByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Hybrid Search Mode', () => {
    const hybridConfig = createDefaultConfig({
      search_method: RETRIEVE_METHOD.hybrid,
      reranking_mode: RerankingModeEnum.RerankingModel,
    })

    it('should show model selector when RerankingModel mode is selected', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByRole('button', { name: /Rerank Model/ }))!.toBeInTheDocument()
    })

    it('should show WeightedScore component when WeightedScore mode is selected', () => {
      const weightedConfig = createDefaultConfig({
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_mode: RerankingModeEnum.WeightedScore,
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            vector_weight: 0.7,
            embedding_provider_name: '',
            embedding_model_name: '',
          },
          keyword_setting: {
            keyword_weight: 0.3,
          },
        },
      })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={weightedConfig}
          onChange={mockOnChange}
        />,
      )

      expect(
        screen.getByRole('slider', { name: 'dataset.weightedScore.semantic' }),
      )!.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Rerank Model/ })).not.toBeInTheDocument()
    })

    it('should show error toast when switching to RerankingModel without model', async () => {
      const user = userEvent.setup()
      modelAvailable = false
      const weightedConfig = createDefaultConfig({
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_mode: RerankingModeEnum.WeightedScore,
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            vector_weight: 0.7,
            embedding_provider_name: '',
            embedding_model_name: '',
          },
          keyword_setting: {
            keyword_weight: 0.3,
          },
        },
      })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={weightedConfig}
          onChange={mockOnChange}
        />,
      )

      await user.click(
        screen.getByRole('radio', { name: /modelProvider\.modelProvider\.rerankModel\.key/ }),
      )

      expect(mockNotify).toHaveBeenCalledWith('workflow.errorMsg.rerankModelRequired')
    })

    it('should update weights when WeightedScore changes', async () => {
      const user = userEvent.setup()
      const weightedConfig = createDefaultConfig({
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_mode: RerankingModeEnum.WeightedScore,
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            vector_weight: 0.7,
            embedding_provider_name: '',
            embedding_model_name: '',
          },
          keyword_setting: {
            keyword_weight: 0.3,
          },
        },
      })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={weightedConfig}
          onChange={mockOnChange}
        />,
      )

      screen.getByRole('slider', { name: 'dataset.weightedScore.semantic' }).focus()
      await user.keyboard('{ArrowLeft}')

      expect(mockOnChange).toHaveBeenCalled()
      const calledWith = mockOnChange.mock.calls[0]![0]
      expect(calledWith.weights.vector_setting.vector_weight).toBe(0.6)
      expect(calledWith.weights.keyword_setting.keyword_weight).toBe(0.4)
    })

    it('should update top_k for hybrid search', async () => {
      const user = userEvent.setup()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      await user.click(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }))
      await user.keyboard('{ArrowUp}')

      expect(mockOnChange).toHaveBeenCalledWith({
        ...hybridConfig,
        top_k: 6,
      })
    })

    it('should update score threshold for hybrid search', async () => {
      const user = userEvent.setup()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      await user.click(
        screen.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }),
      )
      await user.keyboard('{ArrowUp}')

      expect(mockOnChange).toHaveBeenCalledWith({
        ...hybridConfig,
        score_threshold: 0.51,
      })
    })

    it('should toggle score threshold enabled for hybrid search', async () => {
      const user = userEvent.setup()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      await user.click(
        screen.getByRole('switch', { name: 'appDebug.datasetConfig.score_threshold' }),
      )

      expect(mockOnChange).toHaveBeenCalledWith({
        ...hybridConfig,
        score_threshold_enabled: false,
      })
    })

    it('should show multimodal tip for hybrid search with RerankingModel', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          showMultiModalTip={true}
          onChange={mockOnChange}
        />,
      )

      expect(
        screen.getByText('datasetSettings.form.retrievalSetting.multiModalTip'),
      )!.toBeInTheDocument()
    })

    it('should not show multimodal tip for hybrid search with WeightedScore', () => {
      const weightedConfig = createDefaultConfig({
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_mode: RerankingModeEnum.WeightedScore,
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            vector_weight: 0.7,
            embedding_provider_name: '',
            embedding_model_name: '',
          },
          keyword_setting: {
            keyword_weight: 0.3,
          },
        },
      })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={weightedConfig}
          showMultiModalTip={true}
          onChange={mockOnChange}
        />,
      )

      expect(
        screen.queryByText('datasetSettings.form.retrievalSetting.multiModalTip'),
      ).not.toBeInTheDocument()
    })

    it('should not render rerank switch for hybrid search', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      expect(
        screen.queryByRole('switch', { name: 'modelProvider.modelProvider.rerankModel.key' }),
      ).not.toBeInTheDocument()
    })

    it('should update model selection for hybrid search', async () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /Rerank Model/ }))
      await user.click(await screen.findByRole('button', { name: /New Model/ }))

      expect(mockOnChange).toHaveBeenCalledWith({
        ...hybridConfig,
        reranking_model: {
          reranking_provider_name: 'new-provider',
          reranking_model_name: 'new-model',
        },
      })
    })
  })

  describe('Default weights initialization', () => {
    it('should initialize default weights when switching to WeightedScore without existing weights', async () => {
      const user = userEvent.setup()
      const configWithoutWeights = createDefaultConfig({
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_mode: RerankingModeEnum.RerankingModel,
        weights: undefined,
      })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={configWithoutWeights}
          onChange={mockOnChange}
        />,
      )

      await user.click(screen.getByRole('radio', { name: /dataset\.weightedScore\.title/ }))

      expect(mockOnChange).toHaveBeenCalled()
      const calledWith = mockOnChange.mock.calls[0]![0]
      expect(calledWith).toEqual({
        ...configWithoutWeights,
        reranking_mode: RerankingModeEnum.WeightedScore,
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            vector_weight: DEFAULT_WEIGHTED_SCORE.other.semantic,
            embedding_provider_name: '',
            embedding_model_name: '',
          },
          keyword_setting: { keyword_weight: DEFAULT_WEIGHTED_SCORE.other.keyword },
        },
      })
    })

    it('should preserve existing weights when switching to WeightedScore', async () => {
      const user = userEvent.setup()
      const configWithWeights = createDefaultConfig({
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_mode: RerankingModeEnum.RerankingModel,
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            vector_weight: 0.8,
            embedding_provider_name: 'test-provider',
            embedding_model_name: 'test-model',
          },
          keyword_setting: {
            keyword_weight: 0.2,
          },
        },
      })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={configWithWeights}
          onChange={mockOnChange}
        />,
      )

      await user.click(screen.getByRole('radio', { name: /dataset\.weightedScore\.title/ }))

      expect(mockOnChange).toHaveBeenCalled()
      const calledWith = mockOnChange.mock.calls[0]![0]
      expect(calledWith).toEqual({
        ...configWithWeights,
        reranking_mode: RerankingModeEnum.WeightedScore,
      })
    })
  })
})
