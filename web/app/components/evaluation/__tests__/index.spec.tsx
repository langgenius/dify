import { act, fireEvent, render, screen } from '@testing-library/react'
import Evaluation from '..'
import { getEvaluationMockConfig } from '../mock'
import { useEvaluationStore } from '../store'

const mockUseAvailableEvaluationMetrics = vi.hoisted(() => vi.fn())
const mockUseEvaluationNodeInfoMutation = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: () => ({
    data: [{
      provider: 'openai',
      models: [{ model: 'gpt-4o-mini' }],
    }],
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({
    defaultModel,
    onSelect,
  }: {
    defaultModel?: { provider: string, model: string }
    onSelect: (model: { provider: string, model: string }) => void
  }) => (
    <div>
      <div data-testid="evaluation-model-selector">
        {defaultModel ? `${defaultModel.provider}:${defaultModel.model}` : 'empty'}
      </div>
      <button
        type="button"
        onClick={() => onSelect({ provider: 'openai', model: 'gpt-4o-mini' })}
      >
        select-model
      </button>
    </div>
  ),
}))

vi.mock('@/service/use-evaluation', () => ({
  useAvailableEvaluationMetrics: (...args: unknown[]) => mockUseAvailableEvaluationMetrics(...args),
  useEvaluationNodeInfoMutation: (...args: unknown[]) => mockUseEvaluationNodeInfoMutation(...args),
}))

describe('Evaluation', () => {
  beforeEach(() => {
    useEvaluationStore.setState({ resources: {} })
    vi.clearAllMocks()

    mockUseAvailableEvaluationMetrics.mockReturnValue({
      data: {
        metrics: ['answer-correctness', 'faithfulness'],
      },
      isLoading: false,
    })

    mockUseEvaluationNodeInfoMutation.mockReturnValue({
      isPending: false,
      mutate: (_input: unknown, options?: { onSuccess?: (data: Record<string, Array<{ node_id: string, title: string, type: string }>>) => void }) => {
        options?.onSuccess?.({
          'answer-correctness': [
            { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
          ],
          'faithfulness': [
            { node_id: 'node-faithfulness', title: 'Retriever Node', type: 'retriever' },
          ],
        })
      },
    })
  })

  it('should search, select metric nodes, and create a batch history record', async () => {
    vi.useFakeTimers()

    render(<Evaluation resourceType="workflow" resourceId="app-1" />)

    expect(screen.getByTestId('evaluation-model-selector')).toHaveTextContent('openai:gpt-4o-mini')

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.add' }))

    fireEvent.change(screen.getByPlaceholderText('evaluation.metrics.searchNodeOrMetrics'), {
      target: { value: 'does-not-exist' },
    })

    expect(screen.getByText('evaluation.metrics.noResults')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('evaluation.metrics.searchNodeOrMetrics'), {
      target: { value: 'faith' },
    })

    fireEvent.click(screen.getByTestId('evaluation-metric-node-faithfulness-node-faithfulness'))
    expect(screen.getAllByText('Faithfulness').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Retriever Node').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByPlaceholderText('evaluation.metrics.searchNodeOrMetrics'), {
      target: { value: '' },
    })

    fireEvent.click(screen.getByTestId('evaluation-metric-node-answer-correctness-node-answer'))
    expect(screen.getAllByText('Answer Correctness').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.batch.run' }))
    expect(screen.getByText('evaluation.batch.status.running')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1300)
    })

    expect(screen.getByText('evaluation.batch.status.success')).toBeInTheDocument()
    expect(screen.getByText('Workflow evaluation batch')).toBeInTheDocument()

    vi.useRealTimers()
  })

  it('should render time placeholders and hide the value row for empty operators', () => {
    const resourceType = 'workflow'
    const resourceId = 'app-2'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    const timeField = config.fieldOptions.find(field => field.type === 'time')!
    let groupId = ''
    let itemId = ''

    act(() => {
      store.ensureResource(resourceType, resourceId)
      store.setJudgeModel(resourceType, resourceId, 'openai::gpt-4o-mini')

      const group = useEvaluationStore.getState().resources['workflow:app-2'].conditions[0]
      groupId = group.id
      itemId = group.items[0].id

      store.updateConditionField(resourceType, resourceId, groupId, itemId, timeField.id)
      store.updateConditionOperator(resourceType, resourceId, groupId, itemId, 'before')
    })

    let rerender: ReturnType<typeof render>['rerender']
    act(() => {
      ({ rerender } = render(<Evaluation resourceType={resourceType} resourceId={resourceId} />))
    })

    expect(screen.getByText('evaluation.conditions.selectTime')).toBeInTheDocument()

    act(() => {
      store.updateConditionOperator(resourceType, resourceId, groupId, itemId, 'is_empty')
      rerender(<Evaluation resourceType={resourceType} resourceId={resourceId} />)
    })

    expect(screen.queryByText('evaluation.conditions.selectTime')).not.toBeInTheDocument()
  })

  it('should render the metric no-node empty state', () => {
    mockUseAvailableEvaluationMetrics.mockReturnValue({
      data: {
        metrics: ['context-precision'],
      },
      isLoading: false,
    })

    mockUseEvaluationNodeInfoMutation.mockReturnValue({
      isPending: false,
      mutate: (_input: unknown, options?: { onSuccess?: (data: Record<string, Array<{ node_id: string, title: string, type: string }>>) => void }) => {
        options?.onSuccess?.({
          'context-precision': [],
        })
      },
    })

    render(<Evaluation resourceType="workflow" resourceId="app-3" />)

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.add' }))

    expect(screen.getByText('evaluation.metrics.noNodesInWorkflow')).toBeInTheDocument()
  })

  it('should render the global empty state when no metrics are available', () => {
    mockUseAvailableEvaluationMetrics.mockReturnValue({
      data: {
        metrics: [],
      },
      isLoading: false,
    })

    render(<Evaluation resourceType="workflow" resourceId="app-4" />)

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.add' }))

    expect(screen.getByText('evaluation.metrics.noResults')).toBeInTheDocument()
  })

  it('should show more nodes when a metric has more than three nodes', () => {
    mockUseAvailableEvaluationMetrics.mockReturnValue({
      data: {
        metrics: ['answer-correctness'],
      },
      isLoading: false,
    })

    mockUseEvaluationNodeInfoMutation.mockReturnValue({
      isPending: false,
      mutate: (_input: unknown, options?: { onSuccess?: (data: Record<string, Array<{ node_id: string, title: string, type: string }>>) => void }) => {
        options?.onSuccess?.({
          'answer-correctness': [
            { node_id: 'node-1', title: 'LLM 1', type: 'llm' },
            { node_id: 'node-2', title: 'LLM 2', type: 'llm' },
            { node_id: 'node-3', title: 'LLM 3', type: 'llm' },
            { node_id: 'node-4', title: 'LLM 4', type: 'llm' },
          ],
        })
      },
    })

    render(<Evaluation resourceType="workflow" resourceId="app-5" />)

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.add' }))

    expect(screen.getByText('LLM 3')).toBeInTheDocument()
    expect(screen.queryByText('LLM 4')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.showMore' }))

    expect(screen.getByText('LLM 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'evaluation.metrics.showLess' })).toBeInTheDocument()
  })

  it('should render the pipeline-specific layout without auto-selecting a judge model', () => {
    render(<Evaluation resourceType="pipeline" resourceId="dataset-1" />)

    expect(screen.getByTestId('evaluation-model-selector')).toHaveTextContent('empty')
    expect(screen.getByText('evaluation.history.title')).toBeInTheDocument()
    expect(screen.getByText('Context Precision')).toBeInTheDocument()
    expect(screen.getByText('Context Recall')).toBeInTheDocument()
    expect(screen.getByText('Context Relevance')).toBeInTheDocument()
    expect(screen.getByText('evaluation.results.empty')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'evaluation.pipeline.uploadAndRun' })).toBeDisabled()
  })

  it('should enable pipeline batch actions after selecting a judge model and metric', () => {
    render(<Evaluation resourceType="pipeline" resourceId="dataset-2" />)

    fireEvent.click(screen.getByRole('button', { name: 'select-model' }))
    fireEvent.click(screen.getByRole('button', { name: /Context Precision/i }))

    expect(screen.getByRole('button', { name: 'evaluation.batch.downloadTemplate' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'evaluation.pipeline.uploadAndRun' })).toBeEnabled()
  })
})
