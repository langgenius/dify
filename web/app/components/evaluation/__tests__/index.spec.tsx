import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Evaluation from '..'
import ConditionsSection from '../components/conditions-section'
import { useEvaluationStore } from '../store'

const mockUpload = vi.hoisted(() => vi.fn())
const mockUseDatasetEvaluationMetrics = vi.hoisted(() => vi.fn())
const mockUseDefaultEvaluationMetrics = vi.hoisted(() => vi.fn())
const mockUseEvaluationConfig = vi.hoisted(() => vi.fn())
const mockUseSaveEvaluationConfigMutation = vi.hoisted(() => vi.fn())
const mockUseStartEvaluationRunMutation = vi.hoisted(() => vi.fn())
const mockUseEvaluationTemplateColumns = vi.hoisted(() => vi.fn())
const mockUsePublishedPipelineInfo = vi.hoisted(() => vi.fn())
const mockUseSnippetPublishedWorkflow = vi.hoisted(() => vi.fn())

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

vi.mock('@/service/base', () => ({
  upload: (...args: unknown[]) => mockUpload(...args),
}))

vi.mock('@/service/use-evaluation', () => ({
  useEvaluationConfig: (...args: unknown[]) => mockUseEvaluationConfig(...args),
  useDatasetEvaluationMetrics: (...args: unknown[]) => mockUseDatasetEvaluationMetrics(...args),
  useDefaultEvaluationMetrics: (...args: unknown[]) => mockUseDefaultEvaluationMetrics(...args),
  useSaveEvaluationConfigMutation: (...args: unknown[]) => mockUseSaveEvaluationConfigMutation(...args),
  useStartEvaluationRunMutation: (...args: unknown[]) => mockUseStartEvaluationRunMutation(...args),
  useEvaluationTemplateColumns: (...args: unknown[]) => mockUseEvaluationTemplateColumns(...args),
}))

vi.mock('@/service/use-pipeline', () => ({
  usePublishedPipelineInfo: (...args: unknown[]) => mockUsePublishedPipelineInfo(...args),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: { pipeline_id: string } }) => unknown) =>
    selector({ dataset: { pipeline_id: 'pipeline-1' } }),
}))

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: () => ({
    data: {
      graph: {
        nodes: [{
          id: 'start',
          data: {
            type: 'start',
            variables: [{
              variable: 'query',
              type: 'text-input',
            }],
          },
        }],
      },
    },
    isLoading: false,
  }),
}))

vi.mock('@/service/use-snippet-workflows', () => ({
  useSnippetPublishedWorkflow: (...args: unknown[]) => mockUseSnippetPublishedWorkflow(...args),
}))

const renderWithQueryClient = (ui: ReactNode) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    ),
  })
}

describe('Evaluation', () => {
  beforeEach(() => {
    useEvaluationStore.setState({ resources: {}, initialResources: {} })
    vi.clearAllMocks()
    mockUseEvaluationConfig.mockReturnValue({
      data: null,
    })

    mockUseDatasetEvaluationMetrics.mockReturnValue({
      data: {
        metrics: ['answer-correctness', 'faithfulness', 'context-precision', 'context-recall', 'context-relevance'],
      },
      isLoading: false,
    })

    mockUseDefaultEvaluationMetrics.mockReturnValue({
      data: {
        default_metrics: [
          {
            metric: 'answer-correctness',
            value_type: 'number',
            node_info_list: [
              { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
            ],
          },
          {
            metric: 'faithfulness',
            value_type: 'number',
            node_info_list: [
              { node_id: 'node-faithfulness', title: 'Retriever Node', type: 'retriever' },
            ],
          },
          {
            metric: 'context-precision',
            value_type: 'number',
            node_info_list: [],
          },
          {
            metric: 'context-recall',
            value_type: 'number',
            node_info_list: [],
          },
          {
            metric: 'context-relevance',
            value_type: 'number',
            node_info_list: [],
          },
        ],
      },
      isLoading: false,
    })
    mockUseSaveEvaluationConfigMutation.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    })
    mockUseStartEvaluationRunMutation.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    })
    mockUseEvaluationTemplateColumns.mockReturnValue({
      data: {
        columns: [
          { name: 'index', type: 'number' },
          { name: 'query', type: 'string' },
          { name: 'expected_output', type: 'string' },
        ],
      },
      isError: false,
      isFetching: false,
      isPending: false,
    })
    mockUsePublishedPipelineInfo.mockReturnValue({
      data: {
        graph: {
          nodes: [{
            id: 'knowledge-node',
            data: {
              type: 'knowledge-index',
              title: 'Knowledge Base',
            },
          }],
          edges: [],
        },
      },
    })
    mockUseSnippetPublishedWorkflow.mockReturnValue({
      data: {
        graph: {
          nodes: [{
            id: 'start',
            data: {
              type: 'start',
              variables: [{
                variable: 'query',
                type: 'text-input',
              }],
            },
          }],
        },
        input_fields: [],
      },
      isLoading: false,
    })
    mockUpload.mockResolvedValue({
      id: 'uploaded-file-id',
      name: 'evaluation.csv',
    })
  })

  it('should search, select metric nodes, and save evaluation config', () => {
    const saveConfig = vi.fn()
    mockUseSaveEvaluationConfigMutation.mockReturnValue({
      isPending: false,
      mutate: saveConfig,
    })

    renderWithQueryClient(<Evaluation resourceType="apps" resourceId="app-1" />)

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

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(saveConfig).toHaveBeenCalledWith({
      params: {
        targetType: 'apps',
        targetId: 'app-1',
      },
      body: {
        evaluation_model: 'gpt-4o-mini',
        evaluation_model_provider: 'openai',
        default_metrics: [
          {
            metric: 'faithfulness',
            value_type: 'number',
            node_info_list: [
              { node_id: 'node-faithfulness', title: 'Retriever Node', type: 'retriever' },
            ],
          },
          {
            metric: 'answer-correctness',
            value_type: 'number',
            node_info_list: [
              { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
            ],
          },
        ],
        customized_metrics: null,
        judgment_config: null,
      },
    }, {
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    })
  })

  it('should reset unsaved non-pipeline config changes to the hydrated config', () => {
    mockUseEvaluationConfig.mockReturnValue({
      data: {
        evaluation_model: 'gpt-4o-mini',
        evaluation_model_provider: 'openai',
        default_metrics: [],
        customized_metrics: null,
        judgment_config: null,
      },
    })

    renderWithQueryClient(<Evaluation resourceType="apps" resourceId="app-reset" />)

    const resetButton = screen.getByRole('button', { name: 'common.operation.reset' })
    expect(resetButton).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.add' }))
    fireEvent.change(screen.getByPlaceholderText('evaluation.metrics.searchNodeOrMetrics'), {
      target: { value: 'faith' },
    })
    fireEvent.click(screen.getByTestId('evaluation-metric-node-faithfulness-node-faithfulness'))

    expect(useEvaluationStore.getState().resources['apps:app-reset']!.metrics).toHaveLength(1)
    expect(resetButton).toBeEnabled()

    fireEvent.click(resetButton)

    expect(useEvaluationStore.getState().resources['apps:app-reset']!.metrics).toHaveLength(0)
    expect(resetButton).toBeDisabled()
  })

  it('should hide the batch config warning when judge model and metrics are configured', () => {
    const resourceType = 'apps'
    const resourceId = 'app-batch-configured'
    const store = useEvaluationStore.getState()

    act(() => {
      store.ensureResource(resourceType, resourceId)
      store.setJudgeModel(resourceType, resourceId, 'openai::gpt-4o-mini')
      store.addBuiltinMetric(resourceType, resourceId, 'faithfulness', [
        { node_id: 'node-faithfulness', title: 'Retriever Node', type: 'retriever' },
      ])
    })

    renderWithQueryClient(<Evaluation resourceType={resourceType} resourceId={resourceId} />)

    expect(screen.queryByText('evaluation.batch.noticeDescription')).not.toBeInTheDocument()
  })

  it('should use template columns for snippet batch templates', () => {
    const store = useEvaluationStore.getState()
    act(() => {
      store.ensureResource('snippets', 'snippet-fields')
      store.setJudgeModel('snippets', 'snippet-fields', 'openai::gpt-4o-mini')
      store.addBuiltinMetric('snippets', 'snippet-fields', 'answer-correctness', [
        { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
      ])
    })
    mockUseEvaluationTemplateColumns.mockReturnValue({
      data: {
        columns: [
          { name: 'index', type: 'number' },
          { name: 'snippet_topic', type: 'string' },
          { name: 'need_summary', type: 'boolean' },
        ],
      },
      isError: false,
      isFetching: false,
      isPending: false,
    })

    renderWithQueryClient(<Evaluation resourceType="snippets" resourceId="snippet-fields" />)

    expect(mockUseEvaluationTemplateColumns).toHaveBeenCalledWith(
      'snippets',
      'snippet-fields',
      expect.any(Object),
      true,
    )
    expect(screen.getByText('snippet_topic')).toBeInTheDocument()
    expect(screen.getByText('need_summary')).toBeInTheDocument()
  })

  it('should show empty template columns copy', () => {
    const store = useEvaluationStore.getState()
    act(() => {
      store.ensureResource('snippets', 'snippet-empty-fields')
      store.setJudgeModel('snippets', 'snippet-empty-fields', 'openai::gpt-4o-mini')
      store.addBuiltinMetric('snippets', 'snippet-empty-fields', 'answer-correctness', [
        { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
      ])
    })
    mockUseEvaluationTemplateColumns.mockReturnValue({
      data: {
        columns: [],
      },
      isError: false,
      isFetching: false,
      isPending: false,
    })

    renderWithQueryClient(<Evaluation resourceType="snippets" resourceId="snippet-empty-fields" />)

    expect(screen.getByText('evaluation.batch.noTemplateColumns')).toBeInTheDocument()
  })

  it('should hide the value row for empty operators', () => {
    const resourceType = 'apps'
    const resourceId = 'app-2'
    const store = useEvaluationStore.getState()
    let conditionId = ''

    act(() => {
      store.ensureResource(resourceType, resourceId)
      store.setJudgeModel(resourceType, resourceId, 'openai::gpt-4o-mini')
      store.addBuiltinMetric(resourceType, resourceId, 'faithfulness', [
        { node_id: 'node-faithfulness', title: 'Retriever Node', type: 'retriever' },
      ])
      store.addCondition(resourceType, resourceId)

      const condition = useEvaluationStore.getState().resources['apps:app-2'].judgmentConfig.conditions[0]
      conditionId = condition.id
      store.updateConditionOperator(resourceType, resourceId, conditionId, '=')
    })

    let rerender: ReturnType<typeof render>['rerender']
    act(() => {
      ({ rerender } = renderWithQueryClient(<Evaluation resourceType={resourceType} resourceId={resourceId} />))
    })

    expect(screen.getByPlaceholderText('evaluation.conditions.valuePlaceholder')).toBeInTheDocument()

    act(() => {
      store.updateConditionOperator(resourceType, resourceId, conditionId, 'is null')
      rerender(<Evaluation resourceType={resourceType} resourceId={resourceId} />)
    })

    expect(screen.queryByPlaceholderText('evaluation.conditions.valuePlaceholder')).not.toBeInTheDocument()
  })

  it('should add a condition from grouped metric dropdown items', () => {
    const resourceType = 'apps'
    const resourceId = 'app-conditions-dropdown'
    const store = useEvaluationStore.getState()

    act(() => {
      store.ensureResource(resourceType, resourceId)
      store.setJudgeModel(resourceType, resourceId, 'openai::gpt-4o-mini')
      store.addBuiltinMetric(resourceType, resourceId, 'faithfulness', [
        { node_id: 'node-faithfulness', title: 'Retriever Node', type: 'retriever' },
      ])
      store.addCustomMetric(resourceType, resourceId)

      const customMetric = useEvaluationStore.getState().resources['apps:app-conditions-dropdown'].metrics.find(metric => metric.kind === 'custom-workflow')!
      store.setCustomMetricWorkflow(resourceType, resourceId, customMetric.id, {
        workflowId: 'workflow-1',
        workflowAppId: 'workflow-app-1',
        workflowName: 'Review Workflow',
      })
      store.syncCustomMetricOutputs(resourceType, resourceId, customMetric.id, [{
        id: 'reason',
        valueType: 'string',
      }])
    })

    render(<ConditionsSection resourceType={resourceType} resourceId={resourceId} />)

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.conditions.addCondition' }))

    expect(screen.getByText('Faithfulness')).toBeInTheDocument()
    expect(screen.getByText('Review Workflow')).toBeInTheDocument()
    expect(screen.getByText('Retriever Node')).toBeInTheDocument()
    expect(screen.getByText('reason')).toBeInTheDocument()
    expect(screen.getByText('evaluation.conditions.valueTypes.number')).toBeInTheDocument()
    expect(screen.getByText('evaluation.conditions.valueTypes.string')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: /reason/i }))

    const condition = useEvaluationStore.getState().resources['apps:app-conditions-dropdown'].judgmentConfig.conditions[0]

    expect(condition.variableSelector).toEqual(['workflow-1', 'reason'])
    expect(screen.getAllByText('Review Workflow').length).toBeGreaterThan(0)
  })

  it('should render the metric no-node empty state', () => {
    mockUseDefaultEvaluationMetrics.mockReturnValue({
      data: {
        default_metrics: [
          {
            metric: 'context-precision',
            value_type: 'number',
            node_info_list: [],
          },
        ],
      },
      isLoading: false,
    })

    renderWithQueryClient(<Evaluation resourceType="apps" resourceId="app-3" />)

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.add' }))

    expect(screen.getByText('evaluation.metrics.noNodesInWorkflow')).toBeInTheDocument()
  })

  it('should add a node from a dynamically returned metric option', () => {
    mockUseDefaultEvaluationMetrics.mockReturnValue({
      data: {
        default_metrics: [
          {
            metric: 'answer-correctness',
            value_type: 'number',
            node_info_list: [
              { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
            ],
          },
          {
            metric: 'context-precision',
            value_type: 'number',
            node_info_list: [
              { node_id: 'node-context', title: 'Context Node', type: 'knowledge-retrieval' },
            ],
          },
        ],
      },
      isLoading: false,
    })

    renderWithQueryClient(<Evaluation resourceType="apps" resourceId="app-dynamic-metric" />)

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.add' }))
    fireEvent.click(screen.getByTestId('evaluation-metric-node-context-precision-node-context'))

    const metrics = useEvaluationStore.getState().resources['apps:app-dynamic-metric']!.metrics
    expect(metrics).toHaveLength(1)
    expect(metrics[0]).toMatchObject({
      optionId: 'context-precision',
      label: 'Context Precision',
      nodeInfoList: [
        { node_id: 'node-context', title: 'Context Node', type: 'knowledge-retrieval' },
      ],
    })
  })

  it('should render the global empty state when no metrics are available', () => {
    mockUseDefaultEvaluationMetrics.mockReturnValue({
      data: {
        default_metrics: [],
      },
      isLoading: false,
    })

    renderWithQueryClient(<Evaluation resourceType="apps" resourceId="app-4" />)

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.add' }))

    expect(screen.getByText('evaluation.metrics.noResults')).toBeInTheDocument()
  })

  it('should show more nodes when a metric has more than three nodes', () => {
    mockUseDefaultEvaluationMetrics.mockReturnValue({
      data: {
        default_metrics: [
          {
            metric: 'answer-correctness',
            value_type: 'number',
            node_info_list: [
              { node_id: 'node-1', title: 'LLM 1', type: 'llm' },
              { node_id: 'node-2', title: 'LLM 2', type: 'llm' },
              { node_id: 'node-3', title: 'LLM 3', type: 'llm' },
              { node_id: 'node-4', title: 'LLM 4', type: 'llm' },
            ],
          },
        ],
      },
      isLoading: false,
    })

    renderWithQueryClient(<Evaluation resourceType="apps" resourceId="app-5" />)

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.add' }))

    expect(screen.getByText('LLM 3')).toBeInTheDocument()
    expect(screen.queryByText('LLM 4')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.showMore' }))

    expect(screen.getByText('LLM 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'evaluation.metrics.showLess' })).toBeInTheDocument()
  })

  it('should render the pipeline-specific layout without auto-selecting a judge model', () => {
    renderWithQueryClient(<Evaluation resourceType="datasets" resourceId="dataset-1" />)

    expect(mockUseDatasetEvaluationMetrics).toHaveBeenCalledWith('dataset-1')
    expect(screen.getByTestId('evaluation-model-selector')).toHaveTextContent('empty')
    expect(screen.getByText('evaluation.history.columns.time')).toBeInTheDocument()
    expect(screen.getByText('Context Precision')).toBeInTheDocument()
    expect(screen.getByText('Context Recall')).toBeInTheDocument()
    expect(screen.getByText('Context Relevance')).toBeInTheDocument()
    expect(screen.getByText('evaluation.results.empty')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'evaluation.pipeline.uploadAndRun' })).toBeDisabled()
  })

  it('should render selected pipeline metrics from config with the default threshold input', () => {
    mockUseEvaluationConfig.mockReturnValue({
      data: {
        evaluation_model: null,
        evaluation_model_provider: null,
        default_metrics: [{
          metric: 'context-precision',
        }],
        customized_metrics: null,
        judgment_config: null,
      },
    })

    renderWithQueryClient(<Evaluation resourceType="datasets" resourceId="dataset-2" />)

    expect(screen.getByText('Context Precision')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0.85')).toBeInTheDocument()
  })

  it('should enable pipeline batch actions after selecting a judge model and metric', () => {
    renderWithQueryClient(<Evaluation resourceType="datasets" resourceId="dataset-2" />)

    fireEvent.click(screen.getByRole('button', { name: 'select-model' }))
    fireEvent.click(screen.getByRole('button', { name: /Context Precision/i }))

    expect(screen.getByDisplayValue('0.85')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'evaluation.batch.downloadTemplate' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'evaluation.pipeline.uploadAndRun' })).toBeEnabled()
  })

  it('should download the fixed pipeline template columns', () => {
    const createElement = document.createElement.bind(document)
    mockUseEvaluationTemplateColumns.mockReturnValue({
      data: {
        columns: [
          { name: 'index', type: 'number' },
          { name: 'query', type: 'string' },
          { name: 'expected_output', type: 'string' },
        ],
      },
      isError: false,
      isFetching: false,
      isPending: false,
    })
    let downloadLink: HTMLAnchorElement | undefined
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = createElement(tagName, options)

      if (tagName === 'a') {
        downloadLink = element as HTMLAnchorElement
        vi.spyOn(downloadLink, 'click').mockImplementation(() => {})
      }

      return element
    })

    renderWithQueryClient(<Evaluation resourceType="datasets" resourceId="dataset-template" />)

    fireEvent.click(screen.getByRole('button', { name: 'select-model' }))
    fireEvent.click(screen.getByRole('button', { name: /Context Precision/i }))
    fireEvent.click(screen.getByRole('button', { name: 'evaluation.batch.downloadTemplate' }))

    const templateContent = decodeURIComponent(downloadLink?.href ?? '').replace('data:text/csv;charset=utf-8,', '')
    expect(downloadLink?.download).toBe('pipeline-evaluation-template.csv')
    expect(templateContent.trim().split(',')).toEqual(['index', 'query', 'expected_output'])
    expect(mockUseEvaluationTemplateColumns).toHaveBeenLastCalledWith(
      'datasets',
      'dataset-template',
      expect.objectContaining({
        evaluation_model: 'gpt-4o-mini',
        evaluation_model_provider: 'openai',
      }),
      true,
    )

    createElementSpy.mockRestore()
  })

  it('should upload and start a pipeline evaluation run', async () => {
    const startRun = vi.fn()
    mockUseStartEvaluationRunMutation.mockReturnValue({
      isPending: false,
      mutate: startRun,
    })
    mockUpload.mockResolvedValue({
      id: 'file-1',
      name: 'pipeline-evaluation.csv',
    })

    renderWithQueryClient(<Evaluation resourceType="datasets" resourceId="dataset-run" />)

    fireEvent.click(screen.getByRole('button', { name: 'select-model' }))
    fireEvent.click(screen.getByRole('button', { name: /Context Precision/i }))
    fireEvent.click(screen.getByRole('button', { name: 'evaluation.pipeline.uploadAndRun' }))

    expect(screen.getAllByText('query').length).toBeGreaterThan(0)
    expect(screen.getAllByText('expected_output').length).toBeGreaterThan(0)

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][accept=".csv"]')
    expect(fileInput).toBeInTheDocument()

    fireEvent.change(fileInput!, {
      target: {
        files: [new File(['index,query,expected_output'], 'pipeline-evaluation.csv', { type: 'text/csv' })],
      },
    })

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith({
        xhr: expect.any(XMLHttpRequest),
        data: expect.any(FormData),
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.batch.run' }))

    await waitFor(() => {
      expect(startRun).toHaveBeenCalledWith({
        params: {
          targetType: 'datasets',
          targetId: 'dataset-run',
        },
        body: {
          evaluation_model: 'gpt-4o-mini',
          evaluation_model_provider: 'openai',
          default_metrics: [{
            metric: 'context-precision',
            value_type: 'number',
            node_info_list: [
              { node_id: 'knowledge-node', title: 'Knowledge Base', type: 'knowledge-index' },
            ],
          }],
          customized_metrics: null,
          judgment_config: {
            logical_operator: 'and',
            conditions: [{
              variable_selector: ['knowledge-node', 'context-precision'],
              comparison_operator: '≥',
              value: '0.85',
            }],
          },
          file_id: 'file-1',
        },
      }, {
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    })
  })
})
