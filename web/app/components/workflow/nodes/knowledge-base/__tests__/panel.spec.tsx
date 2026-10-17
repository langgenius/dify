import type { PanelProps } from '@/types/workflow'
import { screen } from '@testing-library/react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderWorkflowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'
import { ChunkStructureEnum, IndexMethodEnum, RetrievalSearchMethodEnum } from '../types'

const mockUseEmbeddingModelStatus = vi.hoisted(() => vi.fn())
const mockChunkStructure = vi.hoisted(() => vi.fn(() => <div data-testid="chunk-structure" />))
const mockEmbeddingModel = vi.hoisted(() => vi.fn(() => <div data-testid="embedding-model" />))
const mockSummaryIndexSetting = vi.hoisted(() =>
  vi.fn(() => <div data-testid="summary-index-setting" />),
)

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.models.modelTypes.byModelType.get': async ({
        params,
      }: {
        params: { model_type: string }
      }) => ({
        data:
          params.model_type === ModelTypeEnum.textEmbedding
            ? [{ provider: 'openai', models: [{ model: 'text-embedding-3-large' }] }]
            : [],
      }),
      'workspaces.current.modelProviders.byProvider.models.get': async () => ({ data: [] }),
    }),
  }
})

vi.mock('../hooks/use-config', () => ({
  useConfig: () => ({
    handleChunkStructureChange: vi.fn(),
    handleIndexMethodChange: vi.fn(),
    handleKeywordNumberChange: vi.fn(),
    handleEmbeddingModelChange: vi.fn(),
    handleRetrievalSearchMethodChange: vi.fn(),
    handleHybridSearchModeChange: vi.fn(),
    handleRerankingModelEnabledChange: vi.fn(),
    handleWeighedScoreChange: vi.fn(),
    handleRerankingModelChange: vi.fn(),
    handleTopKChange: vi.fn(),
    handleScoreThresholdChange: vi.fn(),
    handleScoreThresholdEnabledChange: vi.fn(),
    handleInputVariableChange: vi.fn(),
    handleSummaryIndexSettingChange: vi.fn(),
  }),
}))

vi.mock('../hooks/use-embedding-model-status', () => ({
  useEmbeddingModelStatus: mockUseEmbeddingModelStatus,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: () => <div data-testid="var-reference-picker" />,
}))

vi.mock('@/app/components/datasets/settings/summary-index-setting', () => ({
  default: mockSummaryIndexSetting,
}))

vi.mock('../components/chunk-structure', () => ({
  default: mockChunkStructure,
}))

vi.mock('../components/index-method', () => ({
  default: () => <div data-testid="index-method" />,
}))

vi.mock('../components/embedding-model', () => ({
  default: mockEmbeddingModel,
}))

vi.mock('../components/retrieval-setting', () => ({
  default: () => <div data-testid="retrieval-setting" />,
}))

const createData = (overrides: Record<string, unknown> = {}) => ({
  title: 'Knowledge Base',
  desc: '',
  type: BlockEnum.KnowledgeBase,
  index_chunk_variable_selector: ['chunks', 'results'],
  chunk_structure: ChunkStructureEnum.general,
  indexing_technique: IndexMethodEnum.QUALIFIED,
  embedding_model: 'text-embedding-3-large',
  embedding_model_provider: 'openai',
  keyword_number: 10,
  retrieval_model: {
    search_method: RetrievalSearchMethodEnum.semantic,
    reranking_enable: false,
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  },
  ...overrides,
})

const panelProps: PanelProps = {
  getInputVars: () => [],
  toVarInputs: () => [],
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: undefined,
}

describe('KnowledgeBasePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEmbeddingModelStatus.mockReturnValue({ status: 'active' })
  })

  it('should show a warning dot on chunk structure and skip nested sections when chunk structure is missing', () => {
    render(
      <Panel
        id="knowledge-base-1"
        data={createData({ chunk_structure: undefined }) as never}
        panelProps={panelProps}
      />,
    )

    expect(mockChunkStructure).toHaveBeenCalledWith(
      expect.objectContaining({
        warningDot: true,
      }),
      undefined,
    )
    expect(screen.queryByText('workflow.nodes.knowledgeBase.chunksInput')).not.toBeInTheDocument()
  })

  it('should pass warning dots and render summary settings when the qualified configuration needs attention', () => {
    mockUseEmbeddingModelStatus.mockReturnValue({ status: 'disabled' })

    render(
      <Panel
        id="knowledge-base-1"
        data={createData({ index_chunk_variable_selector: [] }) as never}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('workflow.nodes.knowledgeBase.chunksInput')).toBeInTheDocument()
    expect(mockEmbeddingModel).toHaveBeenCalledWith(
      expect.objectContaining({
        warningDot: true,
      }),
      undefined,
    )
    expect(screen.getByTestId('summary-index-setting')).toBeInTheDocument()
  })

  it('should hide embedding and summary settings for non-qualified index methods', () => {
    render(
      <Panel
        id="knowledge-base-1"
        data={createData({ indexing_technique: IndexMethodEnum.ECONOMICAL }) as never}
        panelProps={panelProps}
      />,
    )

    expect(screen.queryByTestId('embedding-model')).not.toBeInTheDocument()
    expect(screen.queryByTestId('summary-index-setting')).not.toBeInTheDocument()
  })
})
