import type { KnowledgeBaseNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes, useStoreApi } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import Panel from '../panel'
import {
  ChunkStructureEnum,
  HybridSearchModeEnum,
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
  WeightedScoreEnum,
} from '../types'

const createData = (overrides: Partial<KnowledgeBaseNodeType> = {}): KnowledgeBaseNodeType => ({
  title: 'Knowledge Base',
  desc: '',
  type: BlockEnum.KnowledgeBase,
  index_chunk_variable_selector: [],
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
let flowStore: ReturnType<typeof useStoreApi>
const getData = () =>
  flowStore
    .getState()
    .getNodes()
    .find((node) => node.id === 'knowledge')!.data as KnowledgeBaseNodeType
function NodePanel() {
  flowStore = useStoreApi()
  const node = useNodes<KnowledgeBaseNodeType>().find((node) => node.id === 'knowledge')
  return node ? <Panel id={node.id} data={node.data} panelProps={panelProps} /> : null
}
function setup(data = createData(), readonly = false) {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'COMMUNITY' },
  })
  const catalog = createModelCatalogFixture({
    models: [
      createCatalogModelFixture({
        model: 'text-embedding-3-large',
        label: { en_US: 'Embedding Large' },
        model_type: 'text-embedding',
      }),
      createCatalogModelFixture({
        model: 'text-embedding-3-small',
        label: { en_US: 'Embedding Small' },
        model_type: 'text-embedding',
      }),
      createCatalogModelFixture({
        model: 'reranker',
        label: { en_US: 'Reranker' },
        model_type: 'rerank',
      }),
      createCatalogModelFixture(),
    ],
  })
  seedModelProviderQueries(queryClient, [catalog])
  const chunkSchema = { type: 'array', items: { type: 'string' } }
  seedToolProviders(queryClient, {
    builtInTools: [
      createToolProviderFixture({
        tools: [
          {
            name: 'chunk',
            author: 'Dify',
            label: { en_US: 'Chunk' },
            description: { en_US: 'Chunk text' },
            parameters: [],
            output_schema: {
              type: 'object',
              properties: { chunks: chunkSchema, status: { type: 'string' } },
            },
          },
        ],
      }),
    ],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [
    { name: 'general_structure', label: 'General Structure', schema: chunkSchema },
  ])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
      input: { params: { provider: 'openai' } },
    }),
    { data: [] },
  )
  const { wrapper: UrlState } = createNuqsTestWrapper()
  const sync = vi.fn(async () => null)
  const rendered = renderWorkflowFlowComponent(
    <UrlState>
      <NodePanel />
    </UrlState>,
    {
      queryClient,
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
      nodes: [
        createNode({
          id: 'chunker',
          data: {
            type: BlockEnum.Tool,
            title: 'Chunker',
            provider_id: 'provider-1',
            provider_type: 'builtin',
            tool_name: 'chunk',
          },
        }),
        createNode({ id: 'knowledge', data }),
      ],
      edges: [createEdge({ source: 'chunker', target: 'knowledge' })],
      initialStoreState: { canvasReadOnly: readonly },
      hooksStoreProps: { doSyncWorkflowDraft: sync },
    },
  )
  return { ...rendered, user: userEvent.setup(), sync }
}

it('starts with chunk selection and exposes configuration after choosing a structure', async () => {
  const { user, store, sync } = setup(
    createData({ chunk_structure: undefined, indexing_technique: undefined }),
  )
  expect(screen.queryByText('workflow.nodes.knowledgeBase.chunksInput')).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'workflow.nodes.knowledgeBase.chooseChunkStructure' }),
  )
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: /datasetCreation.stepTwo.general/,
    }),
  )
  expect(screen.getByText('workflow.nodes.knowledgeBase.chunksInput')).toBeInTheDocument()
  expect(getData().chunk_structure).toBe(ChunkStructureEnum.general)
  act(() => store.getState().flushPendingSync())
  expect(sync).toHaveBeenCalledOnce()
})

it('switches indexing modes and retains keyword settings while updating retrieval defaults', async () => {
  const { user } = setup()
  expect(
    screen.getByRole('switch', { name: 'datasetSettings.form.summaryAutoGen' }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /datasetSettings.form.indexMethodEconomy/ }))
  expect(getData()).toMatchObject({
    indexing_technique: IndexMethodEnum.ECONOMICAL,
    retrieval_model: { search_method: RetrievalSearchMethodEnum.keywordSearch },
  })
  expect(screen.queryByText('datasetSettings.form.embeddingModel')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('switch', { name: 'datasetSettings.form.summaryAutoGen' }),
  ).not.toBeInTheDocument()
  const keywords = screen.getByRole('textbox', { name: 'datasetSettings.form.numberOfKeywords' })
  await user.clear(keywords)
  await user.type(keywords, '9')
  await user.tab()
  expect(getData().keyword_number).toBe(9)
  await user.click(screen.getByRole('button', { name: /datasetCreation.stepTwo.qualified/ }))
  expect(getData()).toMatchObject({
    indexing_technique: IndexMethodEnum.QUALIFIED,
    keyword_number: 9,
    retrieval_model: { search_method: RetrievalSearchMethodEnum.semantic },
  })
  expect(screen.getByText('datasetSettings.form.embeddingModel')).toBeInTheDocument()
})

it('forces high-quality indexing when changing an economical node to parent-child chunks', async () => {
  const { user } = setup(
    createData({
      indexing_technique: IndexMethodEnum.ECONOMICAL,
      retrieval_model: {
        ...createData().retrieval_model,
        search_method: RetrievalSearchMethodEnum.keywordSearch,
      },
    }),
  )
  await user.click(screen.getByRole('button', { name: 'workflow.panel.change' }))
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: /datasetCreation.stepTwo.parentChild/,
    }),
  )
  expect(getData()).toMatchObject({
    chunk_structure: ChunkStructureEnum.parent_child,
    indexing_technique: IndexMethodEnum.QUALIFIED,
  })
  expect(
    screen.queryByRole('button', { name: /datasetSettings.form.indexMethodEconomy/ }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('switch', { name: 'datasetSettings.form.summaryAutoGen' }),
  ).toBeInTheDocument()
})

it('persists embedding selection and retrieval limits in the node draft', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: /Embedding Large/ }))
  await user.click(within(await screen.findByRole('dialog')).getByText('Embedding Small'))
  expect(getData()).toMatchObject({
    embedding_model: 'text-embedding-3-small',
    retrieval_model: {
      weights: {
        vector_setting: {
          embedding_model_name: 'text-embedding-3-small',
          embedding_provider_name: 'openai',
        },
      },
    },
  })
  const topK = screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
  await user.clear(topK)
  await user.type(topK, '6')
  await user.tab()
  await user.click(screen.getByRole('switch', { name: 'appDebug.datasetConfig.score_threshold' }))
  const threshold = screen.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' })
  await user.clear(threshold)
  await user.type(threshold, '0.75')
  await user.tab()
  expect(getData().retrieval_model).toMatchObject({
    top_k: 6,
    score_threshold_enabled: true,
    score_threshold: 0.75,
  })
})

it('preserves summary instructions when summary generation is disabled and enabled again', async () => {
  const { user } = setup(
    createData({
      summary_index_setting: {
        enable: false,
        summary_prompt: 'Summarize the content.',
        model_name: 'gpt-4',
        model_provider_name: 'openai',
      },
    }),
  )
  const toggle = screen.getByRole('switch', { name: 'datasetSettings.form.summaryAutoGen' })
  await user.click(toggle)
  const instructions = screen.getByRole('textbox', {
    name: 'datasetSettings.form.summaryInstructions',
  })
  await user.type(instructions, ' Include key facts.')
  await user.click(toggle)
  expect(getData().summary_index_setting).toMatchObject({
    enable: false,
    summary_prompt: 'Summarize the content. Include key facts.',
  })
  await user.click(toggle)
  expect(
    screen.getByRole('textbox', { name: 'datasetSettings.form.summaryInstructions' }),
  ).toHaveValue('Summarize the content. Include key facts.')
  expect(getData().summary_index_setting).toMatchObject({
    enable: true,
    model_name: 'gpt-4',
    model_provider_name: 'openai',
  })
})

it('prevents node edits on a readonly canvas', async () => {
  const { user, store, sync } = setup(createData(), true)
  const before = getData()
  expect(screen.getByRole('button', { name: 'workflow.panel.change' })).toBeDisabled()
  expect(screen.getByRole('button', { name: /Embedding Large/ })).toBeDisabled()
  const summary = screen.getByRole('switch', { name: 'datasetSettings.form.summaryAutoGen' })
  expect(summary).toHaveAttribute('aria-disabled', 'true')
  await user.click(summary)
  await user.click(screen.getByRole('button', { name: /datasetSettings.form.indexMethodEconomy/ }))
  expect(getData()).toEqual(before)
  act(() => store.getState().flushPendingSync())
  expect(sync).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })).toBeDisabled()
})

it('selects only compatible chunk outputs, clears them, and resets them when the structure changes', async () => {
  const { user } = setup()
  const selectChunks = async () => {
    await user.click(screen.getByRole('button', { name: /workflow.common.setVarValuePlaceholder/ }))
    const picker = await screen.findByRole('dialog')
    expect(within(picker).queryByText('status')).not.toBeInTheDocument()
    await user.click(within(picker).getByText('chunks'))
  }
  const chooseStructure = async (name: RegExp) => {
    await user.click(screen.getByRole('button', { name: 'workflow.panel.change' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name }))
  }
  await selectChunks()
  expect(getData().index_chunk_variable_selector).toEqual(['chunker', 'chunks'])
  await chooseStructure(/datasetCreation.stepTwo.general/)
  expect(getData().index_chunk_variable_selector).toEqual(['chunker', 'chunks'])
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  expect(getData().index_chunk_variable_selector).toEqual([])
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await selectChunks()
  await chooseStructure(/Q&A/)
  expect(
    screen.queryByRole('switch', { name: 'datasetSettings.form.summaryAutoGen' }),
  ).not.toBeInTheDocument()
  expect(getData()).toMatchObject({
    index_chunk_variable_selector: [],
    chunk_structure: ChunkStructureEnum.question_answer,
    retrieval_model: { search_method: RetrievalSearchMethodEnum.semantic },
  })
})

it('preserves custom weights through reranking mode and embedding model changes', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('radio', { name: /dataset.retrieval.full_text_search.title/ }))
  expect(getData().retrieval_model).toMatchObject({
    search_method: RetrievalSearchMethodEnum.fullText,
    reranking_mode: HybridSearchModeEnum.RerankingModel,
  })
  await user.click(
    screen.getByRole('switch', { name: 'modelProvider.modelProvider.rerankModel.key' }),
  )
  expect(getData().retrieval_model.reranking_enable).toBe(true)
  await user.click(screen.getByRole('radio', { name: /dataset.retrieval.hybrid_search.title/ }))
  expect(getData().retrieval_model).toMatchObject({
    search_method: RetrievalSearchMethodEnum.hybrid,
    reranking_mode: HybridSearchModeEnum.RerankingModel,
    reranking_enable: true,
  })
  await user.click(screen.getByRole('radio', { name: /dataset.weightedScore.title/ }))
  expect(getData().retrieval_model).toMatchObject({
    reranking_mode: HybridSearchModeEnum.WeightedScore,
    reranking_enable: false,
    weights: {
      vector_setting: {
        vector_weight: 0.7,
        embedding_model_name: 'text-embedding-3-large',
        embedding_provider_name: 'openai',
      },
      keyword_setting: { keyword_weight: 0.3 },
    },
  })
  const slider = screen.getByRole('slider', { name: 'dataset.weightedScore.semantic' })
  act(() => slider.focus())
  await user.keyboard('{ArrowLeft}')
  expect(getData().retrieval_model.weights).toMatchObject({
    weight_type: WeightedScoreEnum.Customized,
    vector_setting: { vector_weight: 0.6 },
    keyword_setting: { keyword_weight: 0.4 },
  })
  await user.click(
    screen.getByRole('radio', { name: /modelProvider.modelProvider.rerankModel.key/ }),
  )
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
  await user.click(within(await screen.findByRole('dialog')).getByText('Reranker'))
  expect(getData().retrieval_model).toMatchObject({
    reranking_enable: true,
    reranking_model: { reranking_provider_name: 'openai', reranking_model_name: 'reranker' },
  })
  await user.click(screen.getByRole('radio', { name: /dataset.weightedScore.title/ }))
  expect(screen.getByRole('slider', { name: 'dataset.weightedScore.semantic' })).toHaveAttribute(
    'aria-valuenow',
    '0.6',
  )
  await user.click(screen.getByRole('button', { name: /Embedding Large/ }))
  await user.click(within(await screen.findByRole('dialog')).getByText('Embedding Small'))
  expect(getData().retrieval_model.weights).toMatchObject({
    vector_setting: {
      vector_weight: 0.6,
      embedding_model_name: 'text-embedding-3-small',
      embedding_provider_name: 'openai',
    },
    keyword_setting: { keyword_weight: 0.4 },
  })
})
