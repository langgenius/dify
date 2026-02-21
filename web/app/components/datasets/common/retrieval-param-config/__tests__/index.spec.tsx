import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { RerankingModeEnum, WeightedScoreEnum } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import RetrievalParamConfig from '../index'

const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (params: { type: string, message: string }) => mockNotify(params),
  },
}))

let mockCurrentModel: { model: string, provider: string } | null = {
  model: 'rerank-model',
  provider: 'rerank-provider',
}

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModel: () => ({
    modelList: [
      {
        provider: 'rerank-provider',
        models: [{ model: 'rerank-model', label: { en_US: 'Rerank Model' } }],
      },
    ],
    defaultModel: { provider: 'rerank-provider', model: 'rerank-model' },
  }),
  useCurrentProviderAndModel: () => ({
    currentModel: mockCurrentModel,
    currentProvider: mockCurrentModel ? { provider: 'rerank-provider' } : null,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ onSelect, defaultModel }: { onSelect: (v: { provider: string, model: string }) => void, defaultModel?: { provider: string, model: string } }) => (
    <div data-testid="model-selector" data-default-model={defaultModel ? JSON.stringify(defaultModel) : ''}>
      <button
        data-testid="select-model-btn"
        onClick={() => onSelect({ provider: 'new-provider', model: 'new-model' })}
      >
        Select Model
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/app/configuration/dataset-config/params-config/weighted-score', () => ({
  default: ({ value, onChange }: { value: { value: number[] }, onChange: (v: { value: number[] }) => void }) => (
    <div data-testid="weighted-score" data-value={JSON.stringify(value)}>
      <button
        data-testid="change-weights-btn"
        onClick={() => onChange({ value: [0.6, 0.4] })}
      >
        Change Weights
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/base/param-item/top-k-item', () => ({
  default: ({ value, onChange }: { value: number, onChange: (key: string, v: number) => void }) => (
    <div data-testid="top-k-item" data-value={value}>
      <button
        data-testid="change-top-k-btn"
        onClick={() => onChange('top_k', 10)}
      >
        Change TopK
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/base/param-item/score-threshold-item', () => ({
  default: ({ value, onChange, enable, hasSwitch, onSwitchChange }: {
    value: number
    onChange: (key: string, v: number) => void
    enable: boolean
    hasSwitch: boolean
    onSwitchChange?: (key: string, v: boolean) => void
  }) => (
    <div
      data-testid="score-threshold-item"
      data-value={value}
      data-enabled={enable}
      data-has-switch={hasSwitch}
    >
      <button
        data-testid="change-score-btn"
        onClick={() => onChange('score_threshold', 0.8)}
      >
        Change Score
      </button>
      {hasSwitch && onSwitchChange && (
        <button
          data-testid="toggle-score-switch-btn"
          onClick={() => onSwitchChange('score_threshold_enabled', !enable)}
        >
          Toggle Score Switch
        </button>
      )}
    </div>
  ),
}))

vi.mock('@/app/components/base/radio-card', () => ({
  default: ({ isChosen, onChosen, title, description }: {
    isChosen: boolean
    onChosen: () => void
    title: string
    description: string
  }) => (
    <div
      data-testid="radio-card"
      data-chosen={isChosen}
      data-title={title}
      onClick={onChosen}
    >
      {title}
      <span data-testid="radio-description">{description}</span>
    </div>
  ),
}))

vi.mock('@/app/components/base/switch', () => ({
  default: ({ value, onChange }: { value: boolean, onChange?: (v: boolean) => void }) => (
    <button
      data-testid="rerank-switch"
      data-checked={value}
      onClick={() => onChange?.(!value)}
    >
      Switch
    </button>
  ),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ popupContent }: { popupContent: React.ReactNode }) => (
    <div data-testid="tooltip">{popupContent}</div>
  ),
}))

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
    mockCurrentModel = { model: 'rerank-model', provider: 'rerank-provider' }
  })

  describe('Semantic Search Mode', () => {
    it('should render rerank switch for semantic search', () => {
      const config = createDefaultConfig()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByTestId('rerank-switch')).toBeInTheDocument()
    })

    it('should render model selector when reranking is enabled', () => {
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
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

      expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    })

    it('should render TopK item', () => {
      const config = createDefaultConfig()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByTestId('top-k-item')).toBeInTheDocument()
      expect(screen.getByTestId('top-k-item')).toHaveAttribute('data-value', '5')
    })

    it('should render score threshold item when reranking is enabled', () => {
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByTestId('score-threshold-item')).toBeInTheDocument()
    })

    it('should toggle reranking enable', () => {
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      fireEvent.click(screen.getByTestId('rerank-switch'))

      expect(mockOnChange).toHaveBeenCalledWith({
        ...config,
        reranking_enable: false,
      })
    })

    it('should show error toast when enabling rerank without model', () => {
      mockCurrentModel = null
      const config = createDefaultConfig({ reranking_enable: false })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      fireEvent.click(screen.getByTestId('rerank-switch'))

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.errorMsg.rerankModelRequired',
      })
    })

    it('should update reranking model on selection', () => {
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      fireEvent.click(screen.getByTestId('select-model-btn'))

      expect(mockOnChange).toHaveBeenCalledWith({
        ...config,
        reranking_model: {
          reranking_provider_name: 'new-provider',
          reranking_model_name: 'new-model',
        },
      })
    })

    it('should update top_k value', () => {
      const config = createDefaultConfig()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      fireEvent.click(screen.getByTestId('change-top-k-btn'))

      expect(mockOnChange).toHaveBeenCalledWith({
        ...config,
        top_k: 10,
      })
    })

    it('should update score threshold value', () => {
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      fireEvent.click(screen.getByTestId('change-score-btn'))

      expect(mockOnChange).toHaveBeenCalledWith({
        ...config,
        score_threshold: 0.8,
      })
    })

    it('should toggle score threshold enabled', () => {
      const config = createDefaultConfig({ reranking_enable: true, score_threshold_enabled: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      fireEvent.click(screen.getByTestId('toggle-score-switch-btn'))

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

      expect(screen.getByText('datasetSettings.form.retrievalSetting.multiModalTip')).toBeInTheDocument()
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

      expect(screen.queryByText('datasetSettings.form.retrievalSetting.multiModalTip')).not.toBeInTheDocument()
    })
  })

  describe('Full Text Search Mode', () => {
    it('should render rerank switch for full text search', () => {
      const config = createDefaultConfig({ search_method: RETRIEVE_METHOD.fullText })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.fullText}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByTestId('rerank-switch')).toBeInTheDocument()
    })

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

      expect(screen.queryByTestId('score-threshold-item')).not.toBeInTheDocument()
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

      expect(screen.getByTestId('score-threshold-item')).toBeInTheDocument()
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

      expect(screen.queryByTestId('rerank-switch')).not.toBeInTheDocument()
    })

    it('should not render model selector for keyword search', () => {
      const config = createDefaultConfig({ reranking_enable: true })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.keywordSearch}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    })

    it('should render TopK item for keyword search', () => {
      const config = createDefaultConfig()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.keywordSearch}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByTestId('top-k-item')).toBeInTheDocument()
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

      expect(screen.queryByTestId('score-threshold-item')).not.toBeInTheDocument()
    })
  })

  describe('Hybrid Search Mode', () => {
    const hybridConfig = createDefaultConfig({
      search_method: RETRIEVE_METHOD.hybrid,
      reranking_mode: RerankingModeEnum.RerankingModel,
    })

    it('should render radio cards for reranking mode selection', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      const radioCards = screen.getAllByTestId('radio-card')
      expect(radioCards).toHaveLength(2)
    })

    it('should have WeightedScore option', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('dataset.weightedScore.title')).toBeInTheDocument()
    })

    it('should have RerankingModel option', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('common.modelProvider.rerankModel.key')).toBeInTheDocument()
    })

    it('should show model selector when RerankingModel mode is selected', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
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

      expect(screen.getByTestId('weighted-score')).toBeInTheDocument()
      expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    })

    it('should change reranking mode to WeightedScore', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      const radioCards = screen.getAllByTestId('radio-card')
      const weightedScoreCard = radioCards.find(card => card.getAttribute('data-title') === 'dataset.weightedScore.title')
      fireEvent.click(weightedScoreCard!)

      expect(mockOnChange).toHaveBeenCalled()
      const calledWith = mockOnChange.mock.calls[0][0]
      expect(calledWith.reranking_mode).toBe(RerankingModeEnum.WeightedScore)
      expect(calledWith.weights).toBeDefined()
    })

    it('should not call onChange when clicking already selected mode', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      const radioCards = screen.getAllByTestId('radio-card')
      const rerankModelCard = radioCards.find(card => card.getAttribute('data-title') === 'common.modelProvider.rerankModel.key')
      fireEvent.click(rerankModelCard!)

      expect(mockOnChange).not.toHaveBeenCalled()
    })

    it('should show error toast when switching to RerankingModel without model', () => {
      mockCurrentModel = null
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

      const radioCards = screen.getAllByTestId('radio-card')
      const rerankModelCard = radioCards.find(card => card.getAttribute('data-title') === 'common.modelProvider.rerankModel.key')
      fireEvent.click(rerankModelCard!)

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.errorMsg.rerankModelRequired',
      })
    })

    it('should update weights when WeightedScore changes', () => {
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

      fireEvent.click(screen.getByTestId('change-weights-btn'))

      expect(mockOnChange).toHaveBeenCalled()
      const calledWith = mockOnChange.mock.calls[0][0]
      expect(calledWith.weights.vector_setting.vector_weight).toBe(0.6)
      expect(calledWith.weights.keyword_setting.keyword_weight).toBe(0.4)
    })

    it('should render TopK and score threshold for hybrid search', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByTestId('top-k-item')).toBeInTheDocument()
      expect(screen.getByTestId('score-threshold-item')).toBeInTheDocument()
    })

    it('should update top_k for hybrid search', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      fireEvent.click(screen.getByTestId('change-top-k-btn'))

      expect(mockOnChange).toHaveBeenCalledWith({
        ...hybridConfig,
        top_k: 10,
      })
    })

    it('should update score threshold for hybrid search', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      fireEvent.click(screen.getByTestId('change-score-btn'))

      expect(mockOnChange).toHaveBeenCalledWith({
        ...hybridConfig,
        score_threshold: 0.8,
      })
    })

    it('should toggle score threshold enabled for hybrid search', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      fireEvent.click(screen.getByTestId('toggle-score-switch-btn'))

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

      expect(screen.getByText('datasetSettings.form.retrievalSetting.multiModalTip')).toBeInTheDocument()
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

      expect(screen.queryByText('datasetSettings.form.retrievalSetting.multiModalTip')).not.toBeInTheDocument()
    })

    it('should not render rerank switch for hybrid search', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      expect(screen.queryByTestId('rerank-switch')).not.toBeInTheDocument()
    })

    it('should update model selection for hybrid search', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={hybridConfig}
          onChange={mockOnChange}
        />,
      )

      fireEvent.click(screen.getByTestId('select-model-btn'))

      expect(mockOnChange).toHaveBeenCalledWith({
        ...hybridConfig,
        reranking_model: {
          reranking_provider_name: 'new-provider',
          reranking_model_name: 'new-model',
        },
      })
    })
  })

  describe('Tooltip', () => {
    it('should render tooltip with rerank model tip', () => {
      const config = createDefaultConfig()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByTestId('tooltip')).toBeInTheDocument()
    })
  })

  describe('Rerank Model Label', () => {
    it('should display rerank model label', () => {
      const config = createDefaultConfig()
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('common.modelProvider.rerankModel.key')).toBeInTheDocument()
    })
  })

  describe('Default weights initialization', () => {
    it('should initialize default weights when switching to WeightedScore without existing weights', () => {
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

      const radioCards = screen.getAllByTestId('radio-card')
      const weightedScoreCard = radioCards.find(card => card.getAttribute('data-title') === 'dataset.weightedScore.title')
      fireEvent.click(weightedScoreCard!)

      expect(mockOnChange).toHaveBeenCalled()
      const calledWith = mockOnChange.mock.calls[0][0]
      expect(calledWith.weights).toBeDefined()
      expect(calledWith.weights.weight_type).toBe(WeightedScoreEnum.Customized)
    })

    it('should preserve existing weights when switching to WeightedScore', () => {
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

      const radioCards = screen.getAllByTestId('radio-card')
      const weightedScoreCard = radioCards.find(card => card.getAttribute('data-title') === 'dataset.weightedScore.title')
      fireEvent.click(weightedScoreCard!)

      expect(mockOnChange).toHaveBeenCalled()
      const calledWith = mockOnChange.mock.calls[0][0]
      expect(calledWith.weights.vector_setting.vector_weight).toBe(0.8)
    })
  })

  describe('Model Selector Default Model', () => {
    it('should pass correct default model to ModelSelector', () => {
      const config = createDefaultConfig({
        reranking_enable: true,
        reranking_model: {
          reranking_provider_name: 'custom-provider',
          reranking_model_name: 'custom-model',
        },
      })
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={mockOnChange}
        />,
      )

      const modelSelector = screen.getByTestId('model-selector')
      const defaultModel = JSON.parse(modelSelector.getAttribute('data-default-model') || '{}')
      expect(defaultModel.provider).toBe('custom-provider')
      expect(defaultModel.model).toBe('custom-model')
    })
  })
})
