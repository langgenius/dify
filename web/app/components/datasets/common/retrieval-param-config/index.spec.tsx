import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RerankingModeEnum, WeightedScoreEnum } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import RetrievalParamConfig from './index'

// Mock dependencies
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModel: vi.fn(() => ({
    modelList: [
      {
        provider: 'cohere',
        models: [{ model: 'rerank-english-v2.0' }],
      },
    ],
  })),
  useCurrentProviderAndModel: vi.fn(() => ({
    currentModel: {
      provider: 'cohere',
      model: 'rerank-english-v2.0',
    },
  })),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

type ModelSelectorProps = {
  onSelect: (model: { provider: string, model: string }) => void
}

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ onSelect }: ModelSelectorProps) => (
    <button data-testid="model-selector" onClick={() => onSelect({ provider: 'cohere', model: 'rerank-english-v2.0' })}>
      Select Model
    </button>
  ),
}))

type WeightedScoreProps = {
  value: { value: number[] }
  onChange: (newValue: { value: number[] }) => void
}

vi.mock('@/app/components/app/configuration/dataset-config/params-config/weighted-score', () => ({
  default: ({ value, onChange }: WeightedScoreProps) => (
    <div data-testid="weighted-score">
      <input
        data-testid="weight-input"
        type="range"
        value={value.value[0]}
        onChange={e => onChange({ value: [Number(e.target.value), 1 - Number(e.target.value)] })}
      />
    </div>
  ),
}))

const createDefaultConfig = (overrides: Partial<RetrievalConfig> = {}): RetrievalConfig => ({
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: {
    reranking_provider_name: '',
    reranking_model_name: '',
  },
  top_k: 3,
  score_threshold_enabled: false,
  score_threshold: 0.5,
  reranking_mode: RerankingModeEnum.RerankingModel,
  ...overrides,
})

describe('RetrievalParamConfig', () => {
  const defaultOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={createDefaultConfig()}
          onChange={defaultOnChange}
        />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render TopKItem', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={createDefaultConfig()}
          onChange={defaultOnChange}
        />,
      )
      // TopKItem contains "Top K" text
      expect(screen.getByText(/top.*k/i)).toBeInTheDocument()
    })
  })

  describe('Semantic Search Mode', () => {
    it('should show rerank toggle for semantic search', () => {
      const { container } = render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={createDefaultConfig()}
          onChange={defaultOnChange}
        />,
      )
      // Switch component should be present
      expect(container.querySelector('[role="switch"]')).toBeInTheDocument()
    })

    it('should show model selector when reranking is enabled', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={createDefaultConfig({ reranking_enable: true })}
          onChange={defaultOnChange}
        />,
      )
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    })

    it('should not show model selector when reranking is disabled', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={createDefaultConfig({ reranking_enable: false })}
          onChange={defaultOnChange}
        />,
      )
      expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    })
  })

  describe('FullText Search Mode', () => {
    it('should show rerank toggle for fullText search', () => {
      const { container } = render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.fullText}
          value={createDefaultConfig({ search_method: RETRIEVE_METHOD.fullText })}
          onChange={defaultOnChange}
        />,
      )
      expect(container.querySelector('[role="switch"]')).toBeInTheDocument()
    })
  })

  describe('Hybrid Search Mode', () => {
    it('should show reranking mode options for hybrid search', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={createDefaultConfig({
            search_method: RETRIEVE_METHOD.hybrid,
            reranking_mode: RerankingModeEnum.RerankingModel,
          })}
          onChange={defaultOnChange}
        />,
      )
      // Should show weighted score and reranking model options
      expect(screen.getAllByText(/weight/i).length).toBeGreaterThan(0)
    })

    it('should show WeightedScore component when WeightedScore mode is selected', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={createDefaultConfig({
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
          })}
          onChange={defaultOnChange}
        />,
      )
      expect(screen.getByTestId('weighted-score')).toBeInTheDocument()
    })

    it('should show model selector when RerankingModel mode is selected', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={createDefaultConfig({
            search_method: RETRIEVE_METHOD.hybrid,
            reranking_mode: RerankingModeEnum.RerankingModel,
          })}
          onChange={defaultOnChange}
        />,
      )
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    })
  })

  describe('Keyword Search Mode', () => {
    it('should not show rerank toggle for keyword search', () => {
      const { container } = render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.keywordSearch}
          value={createDefaultConfig()}
          onChange={defaultOnChange}
        />,
      )
      // Switch should not be present for economical mode
      expect(container.querySelector('[role="switch"]')).not.toBeInTheDocument()
    })

    it('should still show TopKItem for keyword search', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.keywordSearch}
          value={createDefaultConfig()}
          onChange={defaultOnChange}
        />,
      )
      expect(screen.getByText(/top.*k/i)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onChange when model is selected', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={createDefaultConfig({ reranking_enable: true })}
          onChange={defaultOnChange}
        />,
      )

      const modelSelector = screen.getByTestId('model-selector')
      fireEvent.click(modelSelector)

      expect(defaultOnChange).toHaveBeenCalledWith(expect.objectContaining({
        reranking_model: {
          reranking_provider_name: 'cohere',
          reranking_model_name: 'rerank-english-v2.0',
        },
      }))
    })
  })

  describe('Multi-Modal Tip', () => {
    it('should show multi-modal tip when showMultiModalTip is true and reranking is enabled', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={createDefaultConfig({ reranking_enable: true })}
          onChange={defaultOnChange}
          showMultiModalTip
        />,
      )
      // Warning icon should be present
      expect(document.querySelector('.text-text-warning-secondary')).toBeInTheDocument()
    })

    it('should not show multi-modal tip when showMultiModalTip is false', () => {
      render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={createDefaultConfig({ reranking_enable: true })}
          onChange={defaultOnChange}
          showMultiModalTip={false}
        />,
      )
      expect(document.querySelector('.text-text-warning-secondary')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined reranking_model', () => {
      const config = createDefaultConfig()
      const { container } = render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={config}
          onChange={defaultOnChange}
        />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle switching from semantic to hybrid search', () => {
      const { rerender } = render(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.semantic}
          value={createDefaultConfig()}
          onChange={defaultOnChange}
        />,
      )

      rerender(
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.hybrid}
          value={createDefaultConfig({
            search_method: RETRIEVE_METHOD.hybrid,
            reranking_mode: RerankingModeEnum.RerankingModel,
          })}
          onChange={defaultOnChange}
        />,
      )

      expect(screen.getAllByText(/weight/i).length).toBeGreaterThan(0)
    })
  })
})
