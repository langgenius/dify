import type { ComponentType, SVGProps } from 'react'
import {
  fireEvent,
  render,
  screen,
} from '@testing-library/react'
import {
  HybridSearchModeEnum,
  RetrievalSearchMethodEnum,
  WeightedScoreEnum,
} from '../../../types'
import SearchMethodOption from '../search-method-option'

const mockUseModelListAndDefaultModel = vi.hoisted(() => vi.fn())
const mockUseProviderContext = vi.hoisted(() => vi.fn())
const mockUseCredentialPanelState = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/header/account-setting/model-provider-page/hooks')>()
  return {
    ...actual,
    useModelListAndDefaultModel: (...args: Parameters<typeof actual.useModelListAndDefaultModel>) => mockUseModelListAndDefaultModel(...args),
  }
})

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state', () => ({
  useCredentialPanelState: (...args: unknown[]) => mockUseCredentialPanelState(...args),
}))

const SearchIcon: ComponentType<SVGProps<SVGSVGElement>> = props => (
  <svg aria-hidden="true" {...props} />
)

const hybridSearchModeOptions = [
  {
    id: HybridSearchModeEnum.WeightedScore,
    title: 'Weighted mode',
    description: 'Use weighted score',
  },
  {
    id: HybridSearchModeEnum.RerankingModel,
    title: 'Rerank mode',
    description: 'Use reranking model',
  },
]

const weightedScore = {
  weight_type: WeightedScoreEnum.Customized,
  vector_setting: {
    vector_weight: 0.8,
    embedding_provider_name: 'openai',
    embedding_model_name: 'text-embedding-3-large',
  },
  keyword_setting: {
    keyword_weight: 0.2,
  },
}

const createProps = () => ({
  option: {
    id: RetrievalSearchMethodEnum.semantic,
    icon: SearchIcon,
    title: 'Semantic title',
    description: 'Semantic description',
    effectColor: 'purple',
  },
  hybridSearchModeOptions,
  searchMethod: RetrievalSearchMethodEnum.semantic,
  onRetrievalSearchMethodChange: vi.fn(),
  hybridSearchMode: HybridSearchModeEnum.WeightedScore,
  onHybridSearchModeChange: vi.fn(),
  weightedScore,
  onWeightedScoreChange: vi.fn(),
  rerankingModelEnabled: false,
  onRerankingModelEnabledChange: vi.fn(),
  rerankingModel: {
    reranking_provider_name: '',
    reranking_model_name: '',
  },
  onRerankingModelChange: vi.fn(),
  topK: 3,
  onTopKChange: vi.fn(),
  scoreThreshold: 0.5,
  onScoreThresholdChange: vi.fn(),
  isScoreThresholdEnabled: true,
  onScoreThresholdEnabledChange: vi.fn(),
  showMultiModalTip: false,
})

describe('SearchMethodOption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseModelListAndDefaultModel.mockReturnValue({
      modelList: [],
      defaultModel: undefined,
    })
    mockUseProviderContext.mockReturnValue({
      modelProviders: [],
    })
    mockUseCredentialPanelState.mockReturnValue({
      variant: 'api-active',
      priority: 'apiKeyOnly',
      supportsCredits: false,
      showPrioritySwitcher: false,
      hasCredentials: true,
      isCreditsExhausted: false,
      credentialName: undefined,
      credits: 0,
    })
  })

  it('should render semantic search controls and notify retrieval and reranking changes', () => {
    const props = createProps()

    render(<SearchMethodOption {...props} />)

    expect(screen.getByText('Semantic title'))!.toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.rerankModel.key'))!.toBeInTheDocument()
    expect(screen.getByText('plugin.detailPanel.configureModel'))!.toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(2)

    fireEvent.click(screen.getByText('Semantic title'))
    fireEvent.click(screen.getAllByRole('switch')[0]!)

    expect(props.onRetrievalSearchMethodChange).toHaveBeenCalledWith(RetrievalSearchMethodEnum.semantic)
    expect(props.onRerankingModelEnabledChange).toHaveBeenCalledWith(true)
  })

  it('should render the reranking switch for full-text search as well', () => {
    const props = createProps()

    render(
      <SearchMethodOption
        {...props}
        option={{
          ...props.option,
          id: RetrievalSearchMethodEnum.fullText,
          title: 'Full-text title',
        }}
        searchMethod={RetrievalSearchMethodEnum.fullText}
      />,
    )

    expect(screen.getByText('Full-text title'))!.toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.rerankModel.key'))!.toBeInTheDocument()

    fireEvent.click(screen.getByText('Full-text title'))

    expect(props.onRetrievalSearchMethodChange).toHaveBeenCalledWith(RetrievalSearchMethodEnum.fullText)
  })

  it('should render hybrid weighted-score controls without reranking model selector', () => {
    const props = createProps()

    render(
      <SearchMethodOption
        {...props}
        option={{
          ...props.option,
          id: RetrievalSearchMethodEnum.hybrid,
          title: 'Hybrid title',
        }}
        searchMethod={RetrievalSearchMethodEnum.hybrid}
        hybridSearchMode={HybridSearchModeEnum.WeightedScore}
        showMultiModalTip
      />,
    )

    expect(screen.getByText('Weighted mode'))!.toBeInTheDocument()
    expect(screen.getByText('Rerank mode'))!.toBeInTheDocument()
    expect(screen.getByText('dataset.weightedScore.semantic'))!.toBeInTheDocument()
    expect(screen.getByText('dataset.weightedScore.keyword'))!.toBeInTheDocument()
    expect(screen.queryByText('common.modelProvider.rerankModel.key')).not.toBeInTheDocument()
    expect(screen.queryByText('datasetSettings.form.retrievalSetting.multiModalTip')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Rerank mode'))

    expect(props.onHybridSearchModeChange).toHaveBeenCalledWith(HybridSearchModeEnum.RerankingModel)
  })

  it('should render the hybrid reranking selector when reranking mode is selected', () => {
    const props = createProps()

    render(
      <SearchMethodOption
        {...props}
        option={{
          ...props.option,
          id: RetrievalSearchMethodEnum.hybrid,
          title: 'Hybrid title',
        }}
        searchMethod={RetrievalSearchMethodEnum.hybrid}
        hybridSearchMode={HybridSearchModeEnum.RerankingModel}
        showMultiModalTip
      />,
    )

    expect(screen.getByText('plugin.detailPanel.configureModel'))!.toBeInTheDocument()
    expect(screen.queryByText('common.modelProvider.rerankModel.key')).not.toBeInTheDocument()
    expect(screen.queryByText('dataset.weightedScore.semantic')).not.toBeInTheDocument()
    expect(screen.getByText('datasetSettings.form.retrievalSetting.multiModalTip'))!.toBeInTheDocument()
  })

  it('should hide the score-threshold control for keyword search', () => {
    const props = createProps()

    render(
      <SearchMethodOption
        {...props}
        option={{
          ...props.option,
          id: RetrievalSearchMethodEnum.keywordSearch,
          title: 'Keyword title',
        }}
        searchMethod={RetrievalSearchMethodEnum.keywordSearch}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '9' } })

    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(props.onTopKChange).toHaveBeenCalledWith(9)
  })
})
