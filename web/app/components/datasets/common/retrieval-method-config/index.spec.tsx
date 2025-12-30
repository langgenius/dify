import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import {
  DEFAULT_WEIGHTED_SCORE,
  RerankingModeEnum,
  WeightedScoreEnum,
} from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import RetrievalMethodConfig from './index'

// Mock provider context with controllable supportRetrievalMethods
let mockSupportRetrievalMethods: RETRIEVE_METHOD[] = [
  RETRIEVE_METHOD.semantic,
  RETRIEVE_METHOD.fullText,
  RETRIEVE_METHOD.hybrid,
]

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    supportRetrievalMethods: mockSupportRetrievalMethods,
  }),
}))

// Mock model hooks with controllable return values
let mockRerankDefaultModel: { provider: { provider: string }, model: string } | undefined = {
  provider: { provider: 'test-provider' },
  model: 'test-rerank-model',
}
let mockIsRerankDefaultModelValid: boolean | undefined = true

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: mockRerankDefaultModel,
    currentModel: mockIsRerankDefaultModelValid,
  }),
}))

// Mock child component RetrievalParamConfig to simplify testing
vi.mock('../retrieval-param-config', () => ({
  default: ({ type, value, onChange, showMultiModalTip }: {
    type: RETRIEVE_METHOD
    value: RetrievalConfig
    onChange: (v: RetrievalConfig) => void
    showMultiModalTip?: boolean
  }) => (
    <div data-testid={`retrieval-param-config-${type}`}>
      <span data-testid="param-config-type">{type}</span>
      <span data-testid="param-config-multimodal-tip">{String(showMultiModalTip)}</span>
      <button
        data-testid={`update-top-k-${type}`}
        onClick={() => onChange({ ...value, top_k: 10 })}
      >
        Update Top K
      </button>
    </div>
  ),
}))

// Factory function to create mock RetrievalConfig
const createMockRetrievalConfig = (overrides: Partial<RetrievalConfig> = {}): RetrievalConfig => ({
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: {
    reranking_provider_name: '',
    reranking_model_name: '',
  },
  top_k: 4,
  score_threshold_enabled: false,
  score_threshold: 0.5,
  ...overrides,
})

// Helper to render component with default props
const renderComponent = (props: Partial<React.ComponentProps<typeof RetrievalMethodConfig>> = {}) => {
  const defaultProps = {
    value: createMockRetrievalConfig(),
    onChange: vi.fn(),
  }
  return render(<RetrievalMethodConfig {...defaultProps} {...props} />)
}

describe('RetrievalMethodConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock values to defaults
    mockSupportRetrievalMethods = [
      RETRIEVE_METHOD.semantic,
      RETRIEVE_METHOD.fullText,
      RETRIEVE_METHOD.hybrid,
    ]
    mockRerankDefaultModel = {
      provider: { provider: 'test-provider' },
      model: 'test-rerank-model',
    }
    mockIsRerankDefaultModelValid = true
  })

  // Tests for basic rendering
  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderComponent()

      expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
    })

    it('should render all three retrieval methods when all are supported', () => {
      renderComponent()

      expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
      expect(screen.getByText('dataset.retrieval.full_text_search.title')).toBeInTheDocument()
      expect(screen.getByText('dataset.retrieval.hybrid_search.title')).toBeInTheDocument()
    })

    it('should render descriptions for all retrieval methods', () => {
      renderComponent()

      expect(screen.getByText('dataset.retrieval.semantic_search.description')).toBeInTheDocument()
      expect(screen.getByText('dataset.retrieval.full_text_search.description')).toBeInTheDocument()
      expect(screen.getByText('dataset.retrieval.hybrid_search.description')).toBeInTheDocument()
    })

    it('should only render semantic search when only semantic is supported', () => {
      mockSupportRetrievalMethods = [RETRIEVE_METHOD.semantic]
      renderComponent()

      expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
      expect(screen.queryByText('dataset.retrieval.full_text_search.title')).not.toBeInTheDocument()
      expect(screen.queryByText('dataset.retrieval.hybrid_search.title')).not.toBeInTheDocument()
    })

    it('should only render fullText search when only fullText is supported', () => {
      mockSupportRetrievalMethods = [RETRIEVE_METHOD.fullText]
      renderComponent()

      expect(screen.queryByText('dataset.retrieval.semantic_search.title')).not.toBeInTheDocument()
      expect(screen.getByText('dataset.retrieval.full_text_search.title')).toBeInTheDocument()
      expect(screen.queryByText('dataset.retrieval.hybrid_search.title')).not.toBeInTheDocument()
    })

    it('should only render hybrid search when only hybrid is supported', () => {
      mockSupportRetrievalMethods = [RETRIEVE_METHOD.hybrid]
      renderComponent()

      expect(screen.queryByText('dataset.retrieval.semantic_search.title')).not.toBeInTheDocument()
      expect(screen.queryByText('dataset.retrieval.full_text_search.title')).not.toBeInTheDocument()
      expect(screen.getByText('dataset.retrieval.hybrid_search.title')).toBeInTheDocument()
    })

    it('should render nothing when no retrieval methods are supported', () => {
      mockSupportRetrievalMethods = []
      const { container } = renderComponent()

      // Only the wrapper div should exist
      expect(container.firstChild?.childNodes.length).toBe(0)
    })

    it('should show RetrievalParamConfig for the active method', () => {
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
      })

      expect(screen.getByTestId('retrieval-param-config-semantic_search')).toBeInTheDocument()
      expect(screen.queryByTestId('retrieval-param-config-full_text_search')).not.toBeInTheDocument()
      expect(screen.queryByTestId('retrieval-param-config-hybrid_search')).not.toBeInTheDocument()
    })

    it('should show RetrievalParamConfig for fullText when active', () => {
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.fullText }),
      })

      expect(screen.queryByTestId('retrieval-param-config-semantic_search')).not.toBeInTheDocument()
      expect(screen.getByTestId('retrieval-param-config-full_text_search')).toBeInTheDocument()
      expect(screen.queryByTestId('retrieval-param-config-hybrid_search')).not.toBeInTheDocument()
    })

    it('should show RetrievalParamConfig for hybrid when active', () => {
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.hybrid }),
      })

      expect(screen.queryByTestId('retrieval-param-config-semantic_search')).not.toBeInTheDocument()
      expect(screen.queryByTestId('retrieval-param-config-full_text_search')).not.toBeInTheDocument()
      expect(screen.getByTestId('retrieval-param-config-hybrid_search')).toBeInTheDocument()
    })
  })

  // Tests for props handling
  describe('Props', () => {
    it('should pass showMultiModalTip to RetrievalParamConfig', () => {
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
        showMultiModalTip: true,
      })

      expect(screen.getByTestId('param-config-multimodal-tip')).toHaveTextContent('true')
    })

    it('should default showMultiModalTip to false', () => {
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
      })

      expect(screen.getByTestId('param-config-multimodal-tip')).toHaveTextContent('false')
    })

    it('should apply disabled state to option cards', () => {
      renderComponent({ disabled: true })

      // When disabled, clicking should not trigger onChange
      const semanticOption = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor"]')
      expect(semanticOption).toHaveClass('cursor-not-allowed')
    })

    it('should default disabled to false', () => {
      renderComponent()

      const semanticOption = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor"]')
      expect(semanticOption).not.toHaveClass('cursor-not-allowed')
    })
  })

  // Tests for user interactions and event handlers
  describe('User Interactions', () => {
    it('should call onChange when switching to semantic search', () => {
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.fullText }),
        onChange,
      })

      const semanticOption = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(semanticOption!)

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_enable: true,
        }),
      )
    })

    it('should call onChange when switching to fullText search', () => {
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
        onChange,
      })

      const fullTextOption = screen.getByText('dataset.retrieval.full_text_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(fullTextOption!)

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          search_method: RETRIEVE_METHOD.fullText,
          reranking_enable: true,
        }),
      )
    })

    it('should call onChange when switching to hybrid search', () => {
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
        onChange,
      })

      const hybridOption = screen.getByText('dataset.retrieval.hybrid_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(hybridOption!)

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          search_method: RETRIEVE_METHOD.hybrid,
          reranking_enable: true,
        }),
      )
    })

    it('should not call onChange when clicking the already active method', () => {
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
        onChange,
      })

      const semanticOption = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(semanticOption!)

      expect(onChange).not.toHaveBeenCalled()
    })

    it('should not call onChange when disabled', () => {
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
        onChange,
        disabled: true,
      })

      const fullTextOption = screen.getByText('dataset.retrieval.full_text_search.title').closest('div[class*="cursor"]')
      fireEvent.click(fullTextOption!)

      expect(onChange).not.toHaveBeenCalled()
    })

    it('should propagate onChange from RetrievalParamConfig', () => {
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
        onChange,
      })

      const updateButton = screen.getByTestId('update-top-k-semantic_search')
      fireEvent.click(updateButton)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          top_k: 10,
        }),
      )
    })
  })

  // Tests for reranking model configuration
  describe('Reranking Model Configuration', () => {
    it('should set reranking model when switching to semantic and model is valid', () => {
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({
          search_method: RETRIEVE_METHOD.fullText,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        }),
        onChange,
      })

      const semanticOption = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(semanticOption!)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          reranking_model: {
            reranking_provider_name: 'test-provider',
            reranking_model_name: 'test-rerank-model',
          },
          reranking_enable: true,
        }),
      )
    })

    it('should preserve existing reranking model when switching', () => {
      const onChange = vi.fn()
      const existingModel = {
        reranking_provider_name: 'existing-provider',
        reranking_model_name: 'existing-model',
      }
      renderComponent({
        value: createMockRetrievalConfig({
          search_method: RETRIEVE_METHOD.fullText,
          reranking_model: existingModel,
        }),
        onChange,
      })

      const semanticOption = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(semanticOption!)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          reranking_model: existingModel,
          reranking_enable: true,
        }),
      )
    })

    it('should set reranking_enable to false when no valid model', () => {
      mockIsRerankDefaultModelValid = false
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({
          search_method: RETRIEVE_METHOD.fullText,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        }),
        onChange,
      })

      const semanticOption = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(semanticOption!)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          reranking_enable: false,
        }),
      )
    })

    it('should set reranking_mode for hybrid search', () => {
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        }),
        onChange,
      })

      const hybridOption = screen.getByText('dataset.retrieval.hybrid_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(hybridOption!)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          search_method: RETRIEVE_METHOD.hybrid,
          reranking_mode: RerankingModeEnum.RerankingModel,
        }),
      )
    })

    it('should set weighted score mode when no valid rerank model for hybrid', () => {
      mockIsRerankDefaultModelValid = false
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        }),
        onChange,
      })

      const hybridOption = screen.getByText('dataset.retrieval.hybrid_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(hybridOption!)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          reranking_mode: RerankingModeEnum.WeightedScore,
        }),
      )
    })

    it('should set default weights for hybrid search when no existing weights', () => {
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          weights: undefined,
        }),
        onChange,
      })

      const hybridOption = screen.getByText('dataset.retrieval.hybrid_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(hybridOption!)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          weights: {
            weight_type: WeightedScoreEnum.Customized,
            vector_setting: {
              vector_weight: DEFAULT_WEIGHTED_SCORE.other.semantic,
              embedding_provider_name: '',
              embedding_model_name: '',
            },
            keyword_setting: {
              keyword_weight: DEFAULT_WEIGHTED_SCORE.other.keyword,
            },
          },
        }),
      )
    })

    it('should preserve existing weights for hybrid search', () => {
      const existingWeights = {
        weight_type: WeightedScoreEnum.Customized,
        vector_setting: {
          vector_weight: 0.8,
          embedding_provider_name: 'test-embed-provider',
          embedding_model_name: 'test-embed-model',
        },
        keyword_setting: {
          keyword_weight: 0.2,
        },
      }
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          weights: existingWeights,
        }),
        onChange,
      })

      const hybridOption = screen.getByText('dataset.retrieval.hybrid_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(hybridOption!)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          weights: existingWeights,
        }),
      )
    })

    it('should use RerankingModel mode and enable reranking for hybrid when existing reranking model', () => {
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({
          search_method: RETRIEVE_METHOD.semantic,
          reranking_model: {
            reranking_provider_name: 'existing-provider',
            reranking_model_name: 'existing-model',
          },
        }),
        onChange,
      })

      const hybridOption = screen.getByText('dataset.retrieval.hybrid_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(hybridOption!)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          search_method: RETRIEVE_METHOD.hybrid,
          reranking_enable: true,
          reranking_mode: RerankingModeEnum.RerankingModel,
        }),
      )
    })
  })

  // Tests for callback stability and memoization
  describe('Callback Stability', () => {
    it('should maintain stable onSwitch callback when value changes', () => {
      const onChange = vi.fn()
      const value1 = createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.fullText, top_k: 4 })
      const value2 = createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.fullText, top_k: 8 })

      const { rerender } = render(
        <RetrievalMethodConfig value={value1} onChange={onChange} />,
      )

      const semanticOption = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(semanticOption!)

      expect(onChange).toHaveBeenCalledTimes(1)

      rerender(<RetrievalMethodConfig value={value2} onChange={onChange} />)

      fireEvent.click(semanticOption!)
      expect(onChange).toHaveBeenCalledTimes(2)
    })

    it('should use updated onChange callback after rerender', () => {
      const onChange1 = vi.fn()
      const onChange2 = vi.fn()
      const value = createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.fullText })

      const { rerender } = render(
        <RetrievalMethodConfig value={value} onChange={onChange1} />,
      )

      rerender(<RetrievalMethodConfig value={value} onChange={onChange2} />)

      const semanticOption = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(semanticOption!)

      expect(onChange1).not.toHaveBeenCalled()
      expect(onChange2).toHaveBeenCalledTimes(1)
    })
  })

  // Tests for component memoization
  describe('Component Memoization', () => {
    it('should be memoized with React.memo', () => {
      // Verify the component is wrapped with React.memo by checking its displayName or type
      expect(RetrievalMethodConfig).toBeDefined()
      // React.memo components have a $$typeof property
      expect((RetrievalMethodConfig as any).$$typeof).toBeDefined()
    })

    it('should not re-render when props are the same', () => {
      const onChange = vi.fn()
      const value = createMockRetrievalConfig()

      const { rerender } = render(
        <RetrievalMethodConfig value={value} onChange={onChange} />,
      )

      // Rerender with same props reference
      rerender(<RetrievalMethodConfig value={value} onChange={onChange} />)

      // Component should still be rendered correctly
      expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
    })
  })

  // Tests for edge cases and error handling
  describe('Edge Cases', () => {
    it('should handle undefined reranking_model', () => {
      const onChange = vi.fn()
      const value = createMockRetrievalConfig({
        search_method: RETRIEVE_METHOD.fullText,
      })
      // @ts-expect-error - Testing edge case
      value.reranking_model = undefined

      renderComponent({
        value,
        onChange,
      })

      // Should not crash
      expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
    })

    it('should handle missing default model', () => {
      mockRerankDefaultModel = undefined
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({
          search_method: RETRIEVE_METHOD.fullText,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        }),
        onChange,
      })

      const semanticOption = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(semanticOption!)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        }),
      )
    })

    it('should use fallback empty string when default model provider is undefined', () => {
      // @ts-expect-error - Testing edge case where provider is undefined
      mockRerankDefaultModel = { provider: undefined, model: 'test-model' }
      mockIsRerankDefaultModelValid = true
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({
          search_method: RETRIEVE_METHOD.fullText,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        }),
        onChange,
      })

      const hybridOption = screen.getByText('dataset.retrieval.hybrid_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(hybridOption!)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: 'test-model',
          },
        }),
      )
    })

    it('should use fallback empty string when default model name is undefined', () => {
      // @ts-expect-error - Testing edge case where model is undefined
      mockRerankDefaultModel = { provider: { provider: 'test-provider' }, model: undefined }
      mockIsRerankDefaultModelValid = true
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({
          search_method: RETRIEVE_METHOD.fullText,
          reranking_model: {
            reranking_provider_name: '',
            reranking_model_name: '',
          },
        }),
        onChange,
      })

      const hybridOption = screen.getByText('dataset.retrieval.hybrid_search.title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(hybridOption!)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          reranking_model: {
            reranking_provider_name: 'test-provider',
            reranking_model_name: '',
          },
        }),
      )
    })

    it('should handle rapid sequential clicks', () => {
      const onChange = vi.fn()
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
        onChange,
      })

      const fullTextOption = screen.getByText('dataset.retrieval.full_text_search.title').closest('div[class*="cursor-pointer"]')
      const hybridOption = screen.getByText('dataset.retrieval.hybrid_search.title').closest('div[class*="cursor-pointer"]')

      // Rapid clicks
      fireEvent.click(fullTextOption!)
      fireEvent.click(hybridOption!)
      fireEvent.click(fullTextOption!)

      expect(onChange).toHaveBeenCalledTimes(3)
    })

    it('should handle empty supportRetrievalMethods array', () => {
      mockSupportRetrievalMethods = []
      const { container } = renderComponent()

      expect(container.querySelector('[class*="flex-col"]')?.childNodes.length).toBe(0)
    })

    it('should handle partial supportRetrievalMethods', () => {
      mockSupportRetrievalMethods = [RETRIEVE_METHOD.semantic, RETRIEVE_METHOD.hybrid]
      renderComponent()

      expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
      expect(screen.queryByText('dataset.retrieval.full_text_search.title')).not.toBeInTheDocument()
      expect(screen.getByText('dataset.retrieval.hybrid_search.title')).toBeInTheDocument()
    })

    it('should handle value with all optional fields set', () => {
      const fullValue = createMockRetrievalConfig({
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_enable: true,
        reranking_model: {
          reranking_provider_name: 'provider',
          reranking_model_name: 'model',
        },
        top_k: 10,
        score_threshold_enabled: true,
        score_threshold: 0.8,
        reranking_mode: RerankingModeEnum.WeightedScore,
        weights: {
          weight_type: WeightedScoreEnum.Customized,
          vector_setting: {
            vector_weight: 0.6,
            embedding_provider_name: 'embed-provider',
            embedding_model_name: 'embed-model',
          },
          keyword_setting: {
            keyword_weight: 0.4,
          },
        },
      })

      renderComponent({ value: fullValue })

      expect(screen.getByTestId('retrieval-param-config-hybrid_search')).toBeInTheDocument()
    })
  })

  // Tests for all prop variations
  describe('Prop Variations', () => {
    it('should render with minimum required props', () => {
      const { container } = render(
        <RetrievalMethodConfig
          value={createMockRetrievalConfig()}
          onChange={vi.fn()}
        />,
      )

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render with all props set', () => {
      renderComponent({
        disabled: true,
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.hybrid }),
        showMultiModalTip: true,
        onChange: vi.fn(),
      })

      expect(screen.getByText('dataset.retrieval.hybrid_search.title')).toBeInTheDocument()
    })

    describe('disabled prop variations', () => {
      it('should handle disabled=true', () => {
        renderComponent({ disabled: true })
        const option = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor"]')
        expect(option).toHaveClass('cursor-not-allowed')
      })

      it('should handle disabled=false', () => {
        renderComponent({ disabled: false })
        const option = screen.getByText('dataset.retrieval.semantic_search.title').closest('div[class*="cursor"]')
        expect(option).toHaveClass('cursor-pointer')
      })
    })

    describe('search_method variations', () => {
      const methods = [
        RETRIEVE_METHOD.semantic,
        RETRIEVE_METHOD.fullText,
        RETRIEVE_METHOD.hybrid,
      ]

      it.each(methods)('should correctly highlight %s when active', (method) => {
        renderComponent({
          value: createMockRetrievalConfig({ search_method: method }),
        })

        // The active method should have its RetrievalParamConfig rendered
        expect(screen.getByTestId(`retrieval-param-config-${method}`)).toBeInTheDocument()
      })
    })

    describe('showMultiModalTip variations', () => {
      it('should pass true to child component', () => {
        renderComponent({
          value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
          showMultiModalTip: true,
        })
        expect(screen.getByTestId('param-config-multimodal-tip')).toHaveTextContent('true')
      })

      it('should pass false to child component', () => {
        renderComponent({
          value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
          showMultiModalTip: false,
        })
        expect(screen.getByTestId('param-config-multimodal-tip')).toHaveTextContent('false')
      })
    })
  })

  // Tests for active state visual indication
  describe('Active State Visual Indication', () => {
    it('should show recommended badge only on hybrid search', () => {
      renderComponent()

      // The hybrid search option should have the recommended badge
      // This is verified by checking the isRecommended prop passed to OptionCard
      const hybridTitle = screen.getByText('dataset.retrieval.hybrid_search.title')
      const hybridCard = hybridTitle.closest('div[class*="cursor"]')

      // Should contain recommended badge from OptionCard
      expect(hybridCard?.querySelector('[class*="badge"]') || screen.queryByText('datasetCreation.stepTwo.recommend')).toBeTruthy()
    })
  })

  // Tests for integration with OptionCard
  describe('OptionCard Integration', () => {
    it('should pass correct props to OptionCard for semantic search', () => {
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.semantic }),
      })

      const semanticTitle = screen.getByText('dataset.retrieval.semantic_search.title')
      expect(semanticTitle).toBeInTheDocument()

      // Check description
      const semanticDesc = screen.getByText('dataset.retrieval.semantic_search.description')
      expect(semanticDesc).toBeInTheDocument()
    })

    it('should pass correct props to OptionCard for fullText search', () => {
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.fullText }),
      })

      const fullTextTitle = screen.getByText('dataset.retrieval.full_text_search.title')
      expect(fullTextTitle).toBeInTheDocument()

      const fullTextDesc = screen.getByText('dataset.retrieval.full_text_search.description')
      expect(fullTextDesc).toBeInTheDocument()
    })

    it('should pass correct props to OptionCard for hybrid search', () => {
      renderComponent({
        value: createMockRetrievalConfig({ search_method: RETRIEVE_METHOD.hybrid }),
      })

      const hybridTitle = screen.getByText('dataset.retrieval.hybrid_search.title')
      expect(hybridTitle).toBeInTheDocument()

      const hybridDesc = screen.getByText('dataset.retrieval.hybrid_search.description')
      expect(hybridDesc).toBeInTheDocument()
    })
  })
})
