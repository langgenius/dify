import type { DatasetDocMetadataResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { KnowledgeRetrievalNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import type { consoleClient } from '@/service/console'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes, useStoreApi } from 'reactflow'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { DatasetsDetailContext } from '@/app/components/workflow/datasets-detail-store/provider'
import { createDatasetsDetailStore } from '@/app/components/workflow/datasets-detail-store/store'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { DATASET_DEFAULT } from '@/config'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import { RETRIEVE_TYPE } from '@/types/app'
import { DatasetACLPermission } from '@/utils/permission'
import Panel from '../panel'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
  MetadataFilteringVariableType,
} from '../types'

const { getDatasets, getRules } = vi.hoisted(() => ({
  getDatasets: vi.fn<typeof consoleClient.datasets.get>(),
  getRules:
    vi.fn<
      typeof consoleClient.workspaces.current.modelProviders.byProvider.models.parameterRules.get
    >(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.get': getDatasets,
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': getRules,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.get': getDatasets,
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': getRules,
    }),
  }
})

const metadata = (id: string, name: string): DatasetDocMetadataResponse => ({
  id,
  name,
  type: MetadataFilteringVariableType.string,
})
const createDatasets = () => [
  createDatasetFixture({
    id: 'dataset-1',
    name: 'First knowledge',
    provider: 'internal',
    permission_keys: [DatasetACLPermission.Use, DatasetACLPermission.Edit],
    doc_metadata: [metadata('topic-1', 'topic'), metadata('shared-1', 'shared')],
  }),
  createDatasetFixture({
    id: 'dataset-2',
    name: 'Second knowledge',
    provider: 'internal',
    permission_keys: [DatasetACLPermission.Use, DatasetACLPermission.Edit],
    doc_metadata: [metadata('shared-2', 'shared'), metadata('language-2', 'language')],
  }),
]
const createData = (
  overrides: Partial<KnowledgeRetrievalNodeType> = {},
): KnowledgeRetrievalNodeType => ({
  title: 'Knowledge Retrieval',
  desc: '',
  type: BlockEnum.KnowledgeRetrieval,
  query_variable_selector: ['source', 'question'],
  query_attachment_selector: [],
  dataset_ids: ['dataset-1', 'dataset-2'],
  retrieval_mode: RETRIEVE_TYPE.multiWay,
  multiple_retrieval_config: { top_k: 5, score_threshold: 0.5 },
  metadata_filtering_mode: MetadataFilteringModeEnum.manual,
  metadata_filtering_conditions: { logical_operator: LogicalOperator.and, conditions: [] },
  ...overrides,
})
const panelProps: NodePanelProps<KnowledgeRetrievalNodeType>['panelProps'] = {
  getInputVars: () => [],
  toVarInputs: () => [],
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: undefined,
}
let flowStore: ReturnType<typeof useStoreApi>
const getData = () =>
  flowStore
    .getState()
    .getNodes()
    .find((node) => node.id === 'knowledge')!.data as KnowledgeRetrievalNodeType
function NodePanel() {
  flowStore = useStoreApi()
  const node = useNodes<KnowledgeRetrievalNodeType>().find((node) => node.id === 'knowledge')
  return node ? <Panel id={node.id} data={node.data} panelProps={panelProps} /> : null
}
function setup({
  data = createData(),
  datasets = createDatasets(),
  readonly = false,
  chatflow = false,
  rerankDefault = true,
  pendingDetails,
}: {
  data?: KnowledgeRetrievalNodeType
  datasets?: ReturnType<typeof createDatasets>
  readonly?: boolean
  chatflow?: boolean
  rerankDefault?: boolean
  pendingDetails?: Promise<Awaited<ReturnType<typeof consoleClient.datasets.get>>>
} = {}) {
  getDatasets
    .mockReset()
    .mockImplementation(async ({ query }: Parameters<typeof getDatasets>[0] = {}) => {
      if (query?.ids && pendingDetails) return pendingDetails
      const selected = query?.ids
        ? datasets.filter((dataset) => query.ids!.includes(dataset.id))
        : datasets
      return { data: selected, has_more: false, limit: 20, page: 1, total: selected.length }
    })
  getRules.mockReset().mockResolvedValue({
    data: [
      {
        name: 'temperature',
        label: { en_US: 'Temperature' },
        type: 'float',
        default: 0.7,
        min: 0,
        max: 2,
        required: false,
        options: [],
      },
    ],
  })
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({ model_properties: { mode: 'chat' } }),
        createCatalogModelFixture({
          model: 'gpt-4.1',
          label: { en_US: 'GPT-4.1' },
          model_properties: { mode: 'chat' },
        }),
        createCatalogModelFixture({
          model: 'rerank-v3',
          label: { en_US: 'Rerank V3' },
          model_type: 'rerank',
        }),
      ],
    }),
  ])
  for (const model_type of ['llm', 'rerank'] as const) {
    if (model_type === 'rerank' && !rerankDefault) continue
    queryClient.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type } },
      }),
      {
        data: createDefaultModelFixture({
          model_type,
          model: model_type === 'llm' ? 'gpt-4' : 'rerank-v3',
        }),
      },
    )
  }
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const datasetStore = createDatasetsDetailStore()
  const sync = vi.fn(async () => null)
  const { wrapper: UrlState } = createNuqsTestWrapper()
  const rendered = renderWorkflowEditor(
    <UrlState>
      <DatasetsDetailContext value={datasetStore}>
        <NodePanel />
      </DatasetsDetailContext>
    </UrlState>,
    {
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode: chatflow ? 'advanced-chat' : 'workflow' },
      nodes: [
        createStartNode({ id: 'start', data: { variables: [] } }),
        createNode({
          id: 'source',
          data: {
            title: 'Source',
            type: BlockEnum.Code,
            outputs: {
              question: { type: VarType.string, children: null },
              count: { type: VarType.number, children: null },
              attachments: { type: VarType.arrayFile, children: null },
            },
          },
        }),
        createNode({ id: 'knowledge', data }),
      ],
      edges: [
        createEdge({ source: 'start', target: 'source' }),
        createEdge({ source: 'source', target: 'knowledge' }),
      ],
      initialStoreState: { canvasReadOnly: readonly },
      hooksStoreProps: { doSyncWorkflowDraft: sync },
    },
  )
  return { ...rendered, sync, datasetStore, user: userEvent.setup() }
}
async function openMetadataChoices(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', {
      name: /workflowModels.nodes.knowledgeRetrieval.metadata.panel.conditions/,
    }),
  )
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'workflowModels.nodes.knowledgeRetrieval.metadata.panel.add',
    }),
  )
  return screen.findByRole('menu')
}

it('offers only shared metadata and writes the chosen condition into the node', async () => {
  const { user } = setup()
  await screen.findByText('Second knowledge')
  const choices = within(await openMetadataChoices(user))
  expect(choices.getAllByRole('menuitem')).toHaveLength(1)
  expect(choices.queryByText('topic')).not.toBeInTheDocument()
  expect(choices.queryByText('language')).not.toBeInTheDocument()
  await user.click(choices.getByRole('menuitem', { name: /shared/ }))
  expect(getData().metadata_filtering_conditions?.conditions).toEqual([
    expect.objectContaining({ name: 'shared', metadata_id: 'shared-1' }),
  ])
})

it('offers no condition when selected datasets have disjoint metadata', async () => {
  const datasets = createDatasets()
  datasets[1]!.doc_metadata = []
  const { user } = setup({ datasets })
  await screen.findByText('Second knowledge')
  const choices = within(await openMetadataChoices(user))
  expect(choices.queryByRole('menuitem')).not.toBeInTheDocument()
  expect(await screen.findByText('common.noData')).toBeInTheDocument()
})

it('removes the multimodal dataset and clears its attachment reference in the saved draft', async () => {
  const datasets = [createDatasetFixture({ ...createDatasets()[0]!, is_multimodal: true })]
  const { user, store, sync } = setup({
    datasets,
    data: createData({
      dataset_ids: ['dataset-1'],
      query_attachment_selector: ['source', 'attachments'],
    }),
  })
  await screen.findByText('First knowledge')
  expect(
    screen.getByText('workflowModels.nodes.knowledgeRetrieval.queryAttachment'),
  ).toBeInTheDocument()
  act(() => store.getState().flushPendingSync())
  sync.mockClear()
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(screen.queryByText('First knowledge')).not.toBeInTheDocument()
  expect(
    screen.queryByText('workflowModels.nodes.knowledgeRetrieval.queryAttachment'),
  ).not.toBeInTheDocument()
  expect(getData()).toMatchObject({ dataset_ids: [], query_attachment_selector: [] })
  act(() => store.getState().flushPendingSync())
  expect(sync).toHaveBeenCalledOnce()
})

it('hides dataset mutations and disables retrieval settings on a readonly canvas', async () => {
  setup({ readonly: true })
  await screen.findByText('Second knowledge')
  expect(screen.getByText('First knowledge')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', {
      name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
    }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.remove' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'dataset.retrievalSettings' })).toBeDisabled()
})

it('adds a dataset through the real selector and persists its identity', async () => {
  const { user, datasetStore } = setup({ data: createData({ dataset_ids: [] }) })
  await user.click(
    screen.getByRole('button', {
      name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
    }),
  )
  const picker = within(await screen.findByRole('dialog'))
  await user.click(await picker.findByText('First knowledge'))
  await user.click(picker.getByRole('button', { name: 'common.operation.add' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(getData().dataset_ids).toEqual(['dataset-1'])
  expect(datasetStore.getState().datasetsDetail['dataset-1']?.name).toBe('First knowledge')
  expect(screen.getByText('First knowledge')).toBeInTheDocument()
})

it('chooses only a string output for the query and writes its reference into the node', async () => {
  const { user } = setup({ data: createData({ query_variable_selector: [] }) })
  await screen.findByText('Second knowledge')
  await user.click(screen.getByRole('button', { name: /workflow.common.setVarValuePlaceholder/ }))
  const picker = within(await screen.findByRole('dialog'))
  expect(picker.queryByText('count')).not.toBeInTheDocument()
  expect(picker.queryByText('attachments')).not.toBeInTheDocument()
  await user.click(picker.getByText('question'))
  expect(getData().query_variable_selector).toEqual(['source', 'question'])
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByText('question')).toBeInTheDocument()
})

it.each([true, false])(
  'initializes the chatflow query and retrieval defaults with a default reranker: %s',
  async (rerankDefault) => {
    const { user } = setup({
      chatflow: true,
      rerankDefault,
      data: createData({ query_variable_selector: [], multiple_retrieval_config: undefined }),
    })
    await screen.findByText('Second knowledge')
    expect(getData()).toMatchObject({
      query_variable_selector: ['start', 'sys.query'],
      multiple_retrieval_config: { top_k: DATASET_DEFAULT.top_k, reranking_enable: rerankDefault },
    })
    await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
    expect(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })).toHaveValue(
      String(DATASET_DEFAULT.top_k),
    )
  },
)

it('preserves the query selected while dataset details are loading', async () => {
  const details = createDeferred<Awaited<ReturnType<typeof consoleClient.datasets.get>>>()
  const { user } = setup({
    pendingDetails: details.promise,
    data: createData({ query_variable_selector: [], multiple_retrieval_config: undefined }),
  })
  await user.click(screen.getByRole('button', { name: /workflow.common.setVarValuePlaceholder/ }))
  await user.click(within(await screen.findByRole('dialog')).getByText('question'))
  await act(async () =>
    details.resolve({ data: createDatasets(), page: 1, limit: 20, total: 2, has_more: false }),
  )
  await screen.findByText('Second knowledge')
  expect(screen.getByText('question')).toBeInTheDocument()
  expect(getData()).toMatchObject({
    query_variable_selector: ['source', 'question'],
    multiple_retrieval_config: { top_k: DATASET_DEFAULT.top_k, reranking_enable: true },
  })
})

it('selects a file output for a multimodal query without offering text or number outputs', async () => {
  const datasets = [createDatasetFixture({ ...createDatasets()[0]!, is_multimodal: true })]
  const { user } = setup({ datasets, data: createData({ dataset_ids: ['dataset-1'] }) })
  await screen.findByText('First knowledge')
  await user.click(screen.getByRole('button', { name: /workflow.common.setVarValuePlaceholder/ }))
  const picker = within(await screen.findByRole('dialog'))
  expect(picker.queryByText('question')).not.toBeInTheDocument()
  expect(picker.queryByText('count')).not.toBeInTheDocument()
  await user.click(picker.getByText('attachments'))
  expect(getData().query_attachment_selector).toEqual(['source', 'attachments'])
  expect(screen.getByText('attachments')).toBeInTheDocument()
})

it('opens reranking settings for mixed indexing techniques and saves the edited retrieval limit', async () => {
  const datasets = createDatasets()
  datasets[1]!.indexing_technique = 'economy'
  const { user } = setup({ datasets, data: createData({ dataset_ids: ['dataset-1'] }) })
  await screen.findByText('First knowledge')
  await user.click(
    screen.getByRole('button', {
      name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
    }),
  )
  const picker = within(await screen.findByRole('dialog'))
  await user.click(await picker.findByText('Second knowledge'))
  await user.click(picker.getByRole('button', { name: 'common.operation.add' }))
  const topK = await screen.findByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
  expect(screen.getByText('Rerank V3')).toBeInTheDocument()
  await user.clear(topK)
  await user.type(topK, '8')
  await user.tab()
  expect(getData()).toMatchObject({
    dataset_ids: ['dataset-1', 'dataset-2'],
    multiple_retrieval_config: {
      top_k: 8,
      score_threshold: 0.5,
      reranking_enable: true,
      reranking_model: { provider: 'openai', model: 'rerank-v3' },
    },
  })
})

it('edits metadata conditions and preserves the chosen logical operator after removing one', async () => {
  const { user } = setup({ data: createData({ dataset_ids: ['dataset-1'] }) })
  await screen.findByText('First knowledge')
  await user.click(within(await openMetadataChoices(user)).getByRole('menuitem', { name: /topic/ }))
  const topic = within(screen.getByRole('group', { name: 'topic' }))
  await user.type(topic.getByRole('textbox'), 'agent')
  await user.click(topic.getByRole('button', { name: /comparisonOperator/ }))
  await user.click(screen.getByText('workflowLogic.nodes.ifElse.comparisonOperator.contains'))
  expect(getData().metadata_filtering_conditions?.conditions[0]).toMatchObject({
    name: 'topic',
    value: 'agent',
    comparison_operator: ComparisonOperator.contains,
  })
  await user.click(
    screen.getByRole('button', {
      name: 'workflowModels.nodes.knowledgeRetrieval.metadata.panel.add',
    }),
  )
  await user.click(
    within(await screen.findByRole('menu')).getByRole('menuitem', { name: /shared/ }),
  )
  await user.click(screen.getByText('AND'))
  await user.click(topic.getByRole('button', { name: 'common.operation.remove' }))
  expect(screen.queryByRole('group', { name: 'topic' })).not.toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'shared' })).toBeInTheDocument()
  expect(getData().metadata_filtering_conditions).toMatchObject({
    logical_operator: LogicalOperator.or,
    conditions: [expect.objectContaining({ name: 'shared' })],
  })
})

it('switches to automatic metadata filtering and saves the selected model and parameters', async () => {
  const { user } = setup()
  await screen.findByText('Second knowledge')
  await user.click(
    screen.getByRole('button', {
      name: 'workflowModels.nodes.knowledgeRetrieval.metadata.options.manual.title',
    }),
  )
  await user.click(screen.getByRole('menuitemradio', { name: /metadata.options.automatic.title/ }))
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
  await user.click(
    within(
      await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
    ).getByRole('button', { name: /^GPT-4.1/ }),
  )
  await user.click(
    screen.getByRole('button', { name: 'modelProvider.modelProvider.modelSettings' }),
  )
  const params = within(
    await screen.findByRole('dialog', { name: 'modelProvider.modelProvider.modelSettings' }),
  )
  expect(params.getByRole('switch', { name: 'Temperature' })).toBeChecked()
  await user.clear(params.getByRole('spinbutton', { name: 'Temperature' }))
  await user.type(params.getByRole('spinbutton', { name: 'Temperature' }), '0.2')
  await user.tab()
  expect(getData()).toMatchObject({
    metadata_filtering_mode: MetadataFilteringModeEnum.automatic,
    metadata_model_config: {
      provider: 'openai',
      name: 'gpt-4.1',
      mode: 'chat',
      completion_params: { temperature: 0.2 },
    },
  })
  await user.click(params.getByRole('button', { name: 'common.operation.close' }))
  await user.click(screen.getByRole('button', { name: /^GPT-4.1 CHAT$/ }))
  await user.click(
    within(
      await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
    ).getByRole('button', { name: 'GPT-4' }),
  )
  expect(getData().metadata_model_config).toMatchObject({
    name: 'gpt-4',
    completion_params: { temperature: 0.2 },
  })
  await user.click(
    screen.getByRole('button', { name: 'modelProvider.modelProvider.modelSettings' }),
  )
  expect(
    within(
      await screen.findByRole('dialog', { name: 'modelProvider.modelProvider.modelSettings' }),
    ).getByRole('spinbutton', { name: 'Temperature' }),
  ).toHaveValue(0.2)
})

it('edits a numeric metadata condition and limits its variable picker to numeric outputs', async () => {
  const dataset = createDatasetFixture({
    ...createDatasets()[0]!,
    doc_metadata: [{ id: 'score', name: 'score', type: MetadataFilteringVariableType.number }],
  })
  const { user } = setup({
    datasets: [dataset],
    data: createData({ dataset_ids: [dataset.id], metadata_filtering_conditions: undefined }),
  })
  await screen.findByText('First knowledge')
  await user.click(within(await openMetadataChoices(user)).getByRole('menuitem', { name: /score/ }))
  const condition = within(screen.getByRole('group', { name: 'score' }))
  await user.click(condition.getByRole('button', { name: '=' }))
  await user.click(screen.getByText('>'))
  await user.type(condition.getByRole('textbox'), '0.8')
  await user.tab()
  expect(getData().metadata_filtering_conditions?.conditions).toEqual([
    expect.objectContaining({
      name: 'score',
      value: 0.8,
      comparison_operator: ComparisonOperator.largerThan,
    }),
  ])
  await user.click(condition.getByRole('button', { name: 'Constant' }))
  await user.click(screen.getByText('Variable'))
  await user.click(condition.getByRole('button', { name: /metadata.panel.select/ }))
  const picker = within(
    screen
      .getAllByRole('dialog')
      .find((dialog) =>
        within(dialog).queryByRole('searchbox', { name: 'workflow.common.searchVar' }),
      )!,
  )
  expect(picker.queryByText('question')).not.toBeInTheDocument()
  expect(picker.queryByText('attachments')).not.toBeInTheDocument()
  await user.click(picker.getByText('count'))
  expect(condition.getByText('count')).toBeInTheDocument()
  expect(getData().metadata_filtering_conditions?.conditions).toEqual([
    expect.objectContaining({
      name: 'score',
      value: '{{#source.count#}}',
      comparison_operator: ComparisonOperator.largerThan,
    }),
  ])
})

it('keeps saved retrieval limits and the disabled reranker when defaults are available', async () => {
  const datasets = [
    createDatasetFixture({ ...createDatasets()[0]!, indexing_technique: 'economy' }),
  ]
  const config = {
    top_k: 6,
    score_threshold: 0.1,
    reranking_enable: false,
    reranking_model: { provider: 'openai', model: 'rerank-v3' },
  }
  const { user } = setup({
    datasets,
    data: createData({ dataset_ids: ['dataset-1'], multiple_retrieval_config: config }),
  })
  await screen.findByText('First knowledge')
  expect(getData().multiple_retrieval_config).toEqual(config)
  await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
  const settings = within(await screen.findByRole('dialog'))
  expect(settings.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })).toHaveValue('6')
  expect(settings.getByRole('switch')).not.toBeChecked()
  expect(settings.queryByText('Rerank V3')).not.toBeInTheDocument()
  expect(getData().multiple_retrieval_config).toEqual(config)
})

it('preserves multimodal attachments and limits when adding knowledge to a legacy node and opening retrieval settings', async () => {
  const datasets = createDatasets().map((dataset) =>
    createDatasetFixture({ ...dataset, is_multimodal: true }),
  )
  const config = { top_k: 6, score_threshold: 0.1 }
  const { user } = setup({
    datasets,
    data: createData({
      dataset_ids: ['dataset-1'],
      retrieval_mode: RETRIEVE_TYPE.oneWay,
      query_attachment_selector: ['source', 'attachments'],
      multiple_retrieval_config: config,
    }),
  })
  await screen.findByText('First knowledge')
  await user.click(
    screen.getByRole('button', {
      name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
    }),
  )
  const picker = within(await screen.findByRole('dialog'))
  await user.click(await picker.findByText('Second knowledge'))
  await user.click(picker.getByRole('button', { name: 'common.operation.add' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByText('attachments')).toBeInTheDocument()
  expect(getData()).toMatchObject({
    dataset_ids: ['dataset-1', 'dataset-2'],
    retrieval_mode: RETRIEVE_TYPE.oneWay,
    query_attachment_selector: ['source', 'attachments'],
    multiple_retrieval_config: config,
  })
  await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
  expect(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })).toHaveValue('6')
  expect(
    screen.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }),
  ).toHaveValue('0.1')
  expect(getData()).toMatchObject({
    retrieval_mode: RETRIEVE_TYPE.multiWay,
    query_attachment_selector: ['source', 'attachments'],
    multiple_retrieval_config: config,
  })
})
