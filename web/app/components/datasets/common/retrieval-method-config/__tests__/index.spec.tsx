import type { RetrievalMethod } from '@dify/contracts/api/console/datasets/types.gen'
import type { ComponentProps } from 'react'
import type { RetrievalConfig } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_WEIGHTED_SCORE, RerankingModeEnum, WeightedScoreEnum } from '@/models/datasets'
import { consoleQuery } from '@/service/client'
import { RETRIEVE_METHOD } from '@/types/app'
import RetrievalMethodConfig from '../index'

let supportedMethods: RetrievalMethod[] = ['semantic_search', 'full_text_search', 'hybrid_search']
let rerankDefaultModel: { provider: { provider: string }; model: string } | undefined = {
  provider: { provider: 'test-provider' },
  model: 'test-rerank-model',
}
let isRerankDefaultModelValid: boolean | undefined = true

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: rerankDefaultModel,
    currentModel: isRerankDefaultModelValid,
  }),
}))

vi.mock('../../retrieval-param-config', () => ({
  default: ({
    type,
    value,
    onChange,
  }: {
    type: RETRIEVE_METHOD
    value: RetrievalConfig
    onChange: (value: RetrievalConfig) => void
  }) => <button onClick={() => onChange({ ...value, top_k: 10 })}>Update {type} parameters</button>,
}))

function createRetrievalConfig(overrides: Partial<RetrievalConfig> = {}): RetrievalConfig {
  return {
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
  }
}

function renderComponent(props: Partial<ComponentProps<typeof RetrievalMethodConfig>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  })
  queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryKey(), {
    retrieval_method: supportedMethods,
  })

  const defaultProps = {
    value: createRetrievalConfig(),
    onChange: vi.fn(),
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <RetrievalMethodConfig {...defaultProps} {...props} />
    </QueryClientProvider>,
  )
}

describe('RetrievalMethodConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supportedMethods = ['semantic_search', 'full_text_search', 'hybrid_search']
    rerankDefaultModel = {
      provider: { provider: 'test-provider' },
      model: 'test-rerank-model',
    }
    isRerankDefaultModelValid = true
  })

  it('shows only the retrieval methods supported by the current vector store', () => {
    supportedMethods = ['semantic_search', 'hybrid_search']

    renderComponent()

    expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
    expect(screen.queryByText('dataset.retrieval.full_text_search.title')).not.toBeInTheDocument()
    expect(screen.getByText('dataset.retrieval.hybrid_search.title')).toBeInTheDocument()
  })

  it('shows no retrieval choice when the vector store supports none', () => {
    supportedMethods = []

    renderComponent()

    expect(screen.queryByText('dataset.retrieval.semantic_search.title')).not.toBeInTheDocument()
    expect(screen.queryByText('dataset.retrieval.full_text_search.title')).not.toBeInTheDocument()
    expect(screen.queryByText('dataset.retrieval.hybrid_search.title')).not.toBeInTheDocument()
  })

  it.each([
    ['semantic search', 'dataset.retrieval.semantic_search.title', RETRIEVE_METHOD.semantic],
    ['full-text search', 'dataset.retrieval.full_text_search.title', RETRIEVE_METHOD.fullText],
  ])('selects %s with the available default reranking model', async (_, title, method) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderComponent({
      value: createRetrievalConfig({
        search_method: RETRIEVE_METHOD.hybrid,
      }),
      onChange,
    })

    await user.click(screen.getByText(title))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        search_method: method,
        reranking_enable: true,
        reranking_model: {
          reranking_provider_name: 'test-provider',
          reranking_model_name: 'test-rerank-model',
        },
      }),
    )
  })

  it('falls back to weighted scoring when hybrid search has no valid reranking model', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    isRerankDefaultModelValid = false
    renderComponent({
      value: createRetrievalConfig(),
      onChange,
    })

    await user.click(screen.getByText('dataset.retrieval.hybrid_search.title'))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_enable: false,
        reranking_mode: RerankingModeEnum.WeightedScore,
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

  it('preserves an existing reranking model and weights when hybrid search is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const rerankingModel = {
      reranking_provider_name: 'existing-provider',
      reranking_model_name: 'existing-model',
    }
    const weights = {
      weight_type: WeightedScoreEnum.Customized,
      vector_setting: {
        vector_weight: 0.8,
        embedding_provider_name: 'embedding-provider',
        embedding_model_name: 'embedding-model',
      },
      keyword_setting: {
        keyword_weight: 0.2,
      },
    }
    renderComponent({
      value: createRetrievalConfig({
        search_method: RETRIEVE_METHOD.semantic,
        reranking_model: rerankingModel,
        weights,
      }),
      onChange,
    })

    await user.click(screen.getByText('dataset.retrieval.hybrid_search.title'))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        search_method: RETRIEVE_METHOD.hybrid,
        reranking_enable: true,
        reranking_mode: RerankingModeEnum.RerankingModel,
        reranking_model: rerankingModel,
        weights,
      }),
    )
  })

  it('does not change the retrieval method while the control is disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderComponent({
      disabled: true,
      onChange,
    })

    await user.click(screen.getByText('dataset.retrieval.full_text_search.title'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('applies parameter changes for the active retrieval method', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderComponent({ onChange })

    await user.click(screen.getByRole('button', { name: 'Update semantic_search parameters' }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        search_method: RETRIEVE_METHOD.semantic,
        top_k: 10,
      }),
    )
  })
})
