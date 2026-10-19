import type { WorkflowPublishResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import type { Node } from '@/app/components/workflow/types'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import codeDefault from '@/app/components/workflow/nodes/code/default'
import datasourceDefault from '@/app/components/workflow/nodes/data-source/default'
import { DataSourceClassification } from '@/app/components/workflow/nodes/data-source/types'
import knowledgeDefault from '@/app/components/workflow/nodes/knowledge-base/default'
import {
  ChunkStructureEnum,
  IndexMethodEnum,
} from '@/app/components/workflow/nodes/knowledge-base/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import DatasetDetailContext from '@/context/dataset-detail'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { RETRIEVE_METHOD } from '@/types/app'
import { DatasetACLPermission } from '@/utils/permission'
import { createRagPipelineSliceSlice } from '../../../../store'
import RagPipelineMain from '../../../rag-pipeline-main'

const api = vi.hoisted(() => ({
  save: vi.fn<
    typeof import('@/service/console').consoleClient.rag.pipelines.byPipelineId.workflows.draft.post
  >(),
  publish:
    vi.fn<
      (
        url: string,
        options: { body: { marked_name: string; marked_comment: string } },
      ) => Promise<WorkflowPublishResponse>
    >(),
  template:
    vi.fn<
      typeof import('@/service/console').consoleClient.rag.pipelines.byPipelineId.customized.publish.post
    >(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ datasetId: 'dataset-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/datasets/dataset-1/pipeline',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  post: api.publish,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'rag.pipelines.byPipelineId.workflows.draft.post': api.save,
      'rag.pipelines.byPipelineId.workflows.draft.variables.get': async () => ({
        items: [],
        total: 0,
      }),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.publish.get': async () =>
        createWorkflowResponseFixture(),
      'rag.pipelines.byPipelineId.customized.publish.post': api.template,
    }),
  }
})

beforeEach(() => {
  api.save
    .mockReset()
    .mockResolvedValue({ result: 'success', hash: 'saved', updated_at: 1700000001 })
  api.publish.mockReset().mockResolvedValue({ result: 'success', created_at: 1700100000 })
  api.template.mockReset().mockResolvedValue({ id: 'template-1' })
})
afterEach(async () => {
  await act(async () => cleanup())
  vi.restoreAllMocks()
})

const DatasetProvider = DatasetDetailContext.Provider
const icon = { icon_type: 'emoji' as const, icon: '📚', icon_background: '#fff', icon_url: '' }
const datasetListKey = consoleQuery.datasets.get.key()
const templateListKey = consoleQuery.rag.pipeline.templates.get.queryKey({
  input: { query: { type: 'customized' } },
})
const graph = () => ({
  nodes: [
    createNode({
      id: 'source',
      data: {
        ...datasourceDefault.defaultValue,
        type: BlockEnum.DataSource,
        title: 'Local documents',
        provider_type: DataSourceClassification.localFile,
        provider_name: 'upload-file',
        datasource_name: 'upload-file',
        datasource_label: 'Local documents',
        plugin_id: '',
      },
    }),
    createNode({
      id: 'chunks',
      position: { x: 300, y: 0 },
      data: {
        ...codeDefault.defaultValue,
        title: 'Build chunks',
        code: 'def main():\n    return {"chunks": ["Document content"]}',
        outputs: { chunks: { type: VarType.arrayString } },
      },
    }),
    createNode({
      id: 'knowledge',
      position: { x: 600, y: 0 },
      data: {
        ...knowledgeDefault.defaultValue,
        type: BlockEnum.KnowledgeBase,
        title: 'Knowledge',
        chunk_structure: ChunkStructureEnum.general,
        indexing_technique: IndexMethodEnum.ECONOMICAL,
        index_chunk_variable_selector: ['chunks', 'chunks'],
        retrieval_model: {
          ...knowledgeDefault.defaultValue.retrieval_model,
          search_method: RETRIEVE_METHOD.keywordSearch,
        },
      },
    }),
  ],
  edges: [
    createEdge({
      source: 'source',
      target: 'chunks',
      sourceHandle: 'source',
      targetHandle: 'target',
      data: { sourceType: BlockEnum.DataSource, targetType: BlockEnum.Code },
    }),
    createEdge({
      source: 'chunks',
      target: 'knowledge',
      sourceHandle: 'source',
      targetHandle: 'target',
      data: { sourceType: BlockEnum.Code, targetType: BlockEnum.KnowledgeBase },
    }),
  ],
})

function renderPipeline({
  published = true,
  publishEnabled = true,
  nodes,
  permissions = Object.values(DatasetACLPermission),
}: {
  published?: boolean
  publishEnabled?: boolean
  nodes?: Node[]
  permissions?: NonNullable<ReturnType<typeof createDatasetFixture>['permission_keys']>
} = {}) {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: {
      deployment_edition: 'CLOUD',
      enable_collaboration_mode: false,
      enable_marketplace: false,
    },
    features: { knowledge_pipeline: { publish_enabled: publishEnabled } },
  })
  seedAppDslVersion(queryClient)
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  queryClient.setQueryData(datasetListKey, { data: [] })
  queryClient.setQueryData(templateListKey, { pipeline_templates: [] })
  const initialGraph = graph()
  const pipelineNodes = nodes ?? initialGraph.nodes
  const dataset = createDatasetFixture({ pipeline_id: 'pipeline-1', permission_keys: permissions })
  const onUrlUpdate = vi.fn()
  const view = renderWorkflowComponent(
    <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
      <DatasetProvider value={{ dataset }}>
        <EventEmitterContextProvider>
          <WorkflowWithDefaultContext nodes={pipelineNodes} edges={initialGraph.edges}>
            <RagPipelineMain
              nodes={pipelineNodes}
              edges={initialGraph.edges}
              viewport={{ x: 0, y: 0, zoom: 1 }}
            />
          </WorkflowWithDefaultContext>
        </EventEmitterContextProvider>
      </DatasetProvider>
    </NuqsTestingAdapter>,
    {
      queryClient,
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
      injectWorkflowStoreSliceFn: createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn,
      initialStoreState: {
        isWorkflowDataLoaded: true,
        knowledgeName: 'Documentation',
        knowledgeIcon: icon,
        publishedAt: published ? 1700000000 : undefined,
        draftUpdatedAt: 1700000001,
      },
    },
  )
  return { ...view, queryClient, onUrlUpdate }
}

const trigger = () => screen.getByRole('button', { name: 'workflow.common.publish' })
const publishButton = () => screen.getByRole('button', { name: /workflow.common.publishUpdate/ })
async function openPublisher(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger())
  return screen.findByRole('button', { name: /workflow.common.publishUpdate/ })
}
async function openTemplate(user: ReturnType<typeof userEvent.setup>) {
  await openPublisher(user)
  await user.click(screen.getByRole('button', { name: /pipeline.common.publishAs/ }))
  return within(await screen.findByRole('dialog', { name: 'pipeline.common.publishAs' }))
}

it('saves the real graph when opening publish and closes without a second save', async () => {
  const user = userEvent.setup()
  renderPipeline()
  await openPublisher(user)
  await waitFor(() => expect(api.save).toHaveBeenCalledOnce())
  expect(api.save.mock.lastCall?.[0]).toMatchObject({
    params: { pipeline_id: 'pipeline-1' },
    body: { graph: { nodes: [{ id: 'source' }, { id: 'chunks' }, { id: 'knowledge' }] } },
  })
  await user.click(trigger())
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: /workflow.common.publishUpdate/ }),
    ).not.toBeInTheDocument(),
  )
  expect(api.save).toHaveBeenCalledOnce()
})

it('publishes a valid pipeline and updates its publication state and dataset cache', async () => {
  const user = userEvent.setup()
  const { queryClient } = renderPipeline()
  await user.click(await openPublisher(user))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'workflow.common.published' })).toBeDisabled(),
  )
  expect(api.publish).toHaveBeenCalledExactlyOnceWith(
    '/rag/pipelines/pipeline-1/workflows/publish',
    { body: { marked_name: '', marked_comment: '' } },
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'pipeline.common.goToAddDocuments' })).toHaveAttribute(
    'href',
    '/datasets/dataset-1/documents/create-from-pipeline',
  )
  expect(queryClient.getQueryState(datasetListKey)?.isInvalidated).toBe(true)
})

it('requires confirmation for first publication and only then enables document ingestion', async () => {
  const user = userEvent.setup()
  renderPipeline({ published: false })
  await openPublisher(user)
  expect(screen.getByRole('button', { name: 'pipeline.common.goToAddDocuments' })).toBeDisabled()
  expect(screen.getByRole('button', { name: /pipeline.common.publishAs/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'workflow.common.accessAPIReference' })).toBeDisabled()
  const button = publishButton()
  act(() => button.focus())
  await user.keyboard('{Control>}{Shift>}P{/Shift}{/Control}')
  const confirm = within(
    await screen.findByRole('alertdialog', { name: 'pipeline.common.confirmPublish' }),
  )
  expect(api.publish).not.toHaveBeenCalled()
  await user.click(confirm.getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(api.publish).toHaveBeenCalledOnce()
  expect(screen.queryByText('pipeline.publishToast.title')).not.toBeInTheDocument()
  await openPublisher(user)
  expect(screen.getByRole('link', { name: 'pipeline.common.goToAddDocuments' })).toBeInTheDocument()
})

it('cancels first publication without sending a publish request', async () => {
  const user = userEvent.setup()
  renderPipeline({ published: false })
  await user.click(await openPublisher(user))
  const confirm = within(await screen.findByRole('alertdialog'))
  await user.click(confirm.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(api.publish).not.toHaveBeenCalled()
})

it('rejects a pipeline with an unconfigured knowledge node through the real checklist', async () => {
  const user = userEvent.setup()
  const error = vi.spyOn(toast, 'error')
  const nodes = graph().nodes.map((node) =>
    node.id === 'knowledge'
      ? { ...node, data: { ...node.data, chunk_structure: undefined } }
      : node,
  )
  renderPipeline({ nodes })
  await user.click(await openPublisher(user))
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith('[Knowledge] workflow.nodes.knowledgeBase.chunkIsRequired'),
  )
  expect(api.publish).not.toHaveBeenCalled()
  expect(publishButton()).toBeEnabled()
})

it('keeps the draft available after a publish failure and supports retry', async () => {
  const user = userEvent.setup()
  const error = vi.spyOn(toast, 'error')
  api.publish.mockRejectedValueOnce(new Error('Publish unavailable'))
  const { queryClient } = renderPipeline()
  await user.click(await openPublisher(user))
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith('datasetPipeline.publishPipeline.error.message'),
  )
  expect(queryClient.getQueryState(datasetListKey)?.isInvalidated).toBe(false)
  await user.click(publishButton())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'workflow.common.published' })).toBeDisabled(),
  )
  expect(api.publish).toHaveBeenCalledTimes(2)
})

it('publishes with the scoped shortcut and suppresses repeats during and after publication', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<WorkflowPublishResponse>()
  api.publish.mockReturnValueOnce(pending.promise)
  renderPipeline()
  const button = await openPublisher(user)
  act(() => button.focus())
  await user.keyboard('{Control>}{Shift>}P{/Shift}{/Control}')
  await waitFor(() => expect(button).toBeDisabled())
  await user.keyboard('{Control>}{Shift>}P{/Shift}{/Control}')
  expect(api.publish).toHaveBeenCalledOnce()
  await act(async () => pending.resolve({ result: 'success', created_at: 1700100000 }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'workflow.common.published' })).toBeDisabled(),
  )
  await user.keyboard('{Control>}{Shift>}P{/Shift}{/Control}')
  expect(api.publish).toHaveBeenCalledOnce()
})

it('closes the publish popover and opens pricing when template publishing is unavailable', async () => {
  const user = userEvent.setup()
  const { onUrlUpdate } = renderPipeline({ publishEnabled: false })
  await openPublisher(user)
  await user.click(screen.getByRole('button', { name: /pipeline.common.publishAs/ }))
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: /workflow.common.publishUpdate/ }),
    ).not.toBeInTheDocument(),
  )
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.template).not.toHaveBeenCalled()
})

it('publishes the actual template form values and invalidates the template catalog', async () => {
  const user = userEvent.setup()
  const { queryClient } = renderPipeline()
  const dialog = await openTemplate(user)
  const name = dialog.getByRole('textbox', { name: 'pipeline.common.publishAsPipeline.name' })
  expect(name).toHaveValue('Documentation')
  await user.clear(name)
  await user.type(name, '  Team docs  ')
  await user.type(
    dialog.getByRole('textbox', { name: 'pipeline.common.publishAsPipeline.description' }),
    '  Search team documents  ',
  )
  await user.click(name)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.template).toHaveBeenCalledExactlyOnceWith({
    params: { pipeline_id: 'pipeline-1' },
    body: { name: 'Team docs', icon_info: icon, description: 'Search team documents' },
  })
  expect(queryClient.getQueryState(templateListKey)?.isInvalidated).toBe(true)
})

it('keeps an empty template name from submitting and lets the user cancel', async () => {
  const user = userEvent.setup()
  renderPipeline()
  const dialog = await openTemplate(user)
  await user.clear(dialog.getByRole('textbox', { name: 'pipeline.common.publishAsPipeline.name' }))
  expect(dialog.getByRole('button', { name: 'workflow.common.publish' })).toBeDisabled()
  await user.keyboard('{Enter}')
  expect(api.template).not.toHaveBeenCalled()
  await user.click(dialog.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.template).not.toHaveBeenCalled()
})

it('reports template publication failure without invalidating the catalog', async () => {
  const user = userEvent.setup()
  const error = vi.spyOn(toast, 'error')
  api.template.mockRejectedValueOnce(new Error('Templates unavailable'))
  const { queryClient } = renderPipeline()
  const dialog = await openTemplate(user)
  await user.click(dialog.getByRole('button', { name: 'workflow.common.publish' }))
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith('datasetPipeline.publishTemplate.error.message'),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(queryClient.getQueryState(templateListKey)?.isInvalidated).toBe(false)
})

it('keeps ingestion unavailable without use permission while allowing a release', async () => {
  const user = userEvent.setup()
  renderPipeline({
    permissions: [
      DatasetACLPermission.Readonly,
      DatasetACLPermission.Edit,
      DatasetACLPermission.PipelineRelease,
    ],
  })
  await openPublisher(user)
  expect(screen.getByRole('button', { name: 'pipeline.common.goToAddDocuments' })).toBeDisabled()
  expect(publishButton()).toBeEnabled()
  const apiReference = screen.getByRole('link', { name: 'workflow.common.accessAPIReference' })
  expect(apiReference.getAttribute('href')).toContain('/api-reference/guides/knowledge')
  expect(apiReference).toHaveAttribute('target', '_blank')
  expect(apiReference).toHaveAttribute('rel', 'noopener noreferrer')
})

it('prevents another template submission while the first request is pending', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<Awaited<ReturnType<typeof api.template>>>()
  api.template.mockReturnValueOnce(pending.promise)
  renderPipeline()
  const dialog = await openTemplate(user)
  const submit = dialog.getByRole('button', { name: 'workflow.common.publish' })
  await user.click(submit)
  await waitFor(() => expect(submit).toBeDisabled())
  await user.click(dialog.getByRole('textbox', { name: 'pipeline.common.publishAsPipeline.name' }))
  await user.keyboard('{Enter}')
  expect(api.template).toHaveBeenCalledOnce()
  await act(async () => pending.resolve({ id: 'template-1' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
