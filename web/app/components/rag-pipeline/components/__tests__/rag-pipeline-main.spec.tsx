import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import type { EventEmitterValue } from '@/context/event-emitter'
import type { RAGPipelineVariables } from '@/models/pipeline'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventEmitter } from 'ahooks/lib/useEventEmitter'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { DSL_EXPORT_CHECK, WORKFLOW_DATA_UPDATE } from '@/app/components/workflow/constants'
import codeNodeDefault from '@/app/components/workflow/nodes/code/default'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import DatasetDetailContext from '@/context/dataset-detail'
import { EventEmitterContext } from '@/context/event-emitter'
import { PipelineInputVarType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { captureDownloads } from '@/test/download'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { DatasetACLPermission } from '@/utils/permission'
import { createRagPipelineSliceSlice } from '../../store'
import RagPipelineMain from '../rag-pipeline-main'

const api = vi.hoisted(() => ({
  saveDraft:
    vi.fn<
      typeof import('@/service/console').consoleClient.rag.pipelines.byPipelineId.workflows.draft.post
    >(),
  exportPipeline:
    vi.fn<
      typeof import('@/service/console').consoleClient.rag.pipelines.byPipelineId.exports.get
    >(),
}))
beforeEach(() => {
  api.saveDraft
    .mockReset()
    .mockResolvedValue({ result: 'success', hash: 'saved-hash', updated_at: 2 })
  api.exportPipeline.mockReset().mockResolvedValue({ data: 'kind: rag_pipeline' })
})
afterEach(async () => {
  await act(async () => cleanup())
  vi.restoreAllMocks()
})

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ datasetId: 'dataset-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/datasets/dataset-1/pipeline',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.publish.get': async () =>
        createWorkflowResponseFixture(),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'rag.pipelines.byPipelineId.workflows.draft.post': api.saveDraft,
      'rag.pipelines.byPipelineId.exports.get': api.exportPipeline,
      'rag.pipelines.byPipelineId.workflows.draft.variables.get': async () => ({
        items: [],
        total: 0,
      }),
    }),
  }
})

// These use-context-selector contexts expose Provider components, not React 19 context components.
const DatasetDetailProvider = DatasetDetailContext.Provider
const WorkflowEventProvider = EventEmitterContext.Provider

const nodes = [
  createNode({
    id: 'code',
    data: { ...codeNodeDefault.defaultValue, title: 'Transform documents' },
  }),
]
const fields: RAGPipelineVariables = [
  {
    belong_to_node_id: 'shared',
    type: PipelineInputVarType.textInput,
    label: 'Source name',
    variable: 'source_name',
    required: true,
  },
]
const environmentVariables: EnvironmentVariable[] = [
  { id: 'env-1', name: 'SOURCE', value: 'docs', description: '', value_type: ChatVarType.String },
]

function renderMain(
  permissionKeys: NonNullable<
    ReturnType<typeof createDatasetFixture>['permission_keys']
  > = Object.values(DatasetACLPermission),
) {
  const { queryClient } = createConsoleQueryWrapper()
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
  const eventEmitter = new EventEmitter<EventEmitterValue>()
  const dataset = createDatasetFixture({
    pipeline_id: 'pipeline-1',
    permission_keys: permissionKeys,
  })
  const view = renderWorkflowComponent(
    <NuqsTestingAdapter>
      <DatasetDetailProvider value={{ dataset }}>
        <WorkflowEventProvider value={{ eventEmitter }}>
          <WorkflowWithDefaultContext nodes={nodes} edges={[]}>
            <RagPipelineMain nodes={nodes} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />
          </WorkflowWithDefaultContext>
        </WorkflowEventProvider>
      </DatasetDetailProvider>
    </NuqsTestingAdapter>,
    {
      queryClient,
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
      injectWorkflowStoreSliceFn: createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn,
      initialStoreState: { isWorkflowDataLoaded: true, knowledgeName: 'Documentation' },
    },
  )
  return { ...view, eventEmitter }
}

it.each([
  {
    name: 'full access',
    permissions: Object.values(DatasetACLPermission),
    canEdit: true,
    canRunAndRelease: true,
  },
  {
    name: 'edit only',
    permissions: [DatasetACLPermission.Edit],
    canEdit: true,
    canRunAndRelease: false,
  },
  {
    name: 'read only',
    permissions: [DatasetACLPermission.Readonly],
    canEdit: false,
    canRunAndRelease: false,
  },
])(
  'respects $name for execution, publishing and saving on exit',
  async ({ permissions, canEdit, canRunAndRelease }) => {
    const { unmount } = renderMain(permissions)
    expect(screen.getByText('Transform documents')).toBeInTheDocument()
    const publish = screen.getByRole('button', { name: 'workflow.common.publish' })
    if (canRunAndRelease) {
      expect(publish).toBeEnabled()
      expect(screen.getByRole('button', { name: /pipeline.common.testRun/ })).toBeEnabled()
    } else {
      expect(publish).toBeDisabled()
      expect(
        screen.queryByRole('button', { name: /pipeline.common.testRun/ }),
      ).not.toBeInTheDocument()
    }
    await act(async () => unmount())
    if (canEdit) {
      expect(api.saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { pipeline_id: 'pipeline-1' },
          body: expect.objectContaining({
            graph: expect.objectContaining({
              nodes: expect.arrayContaining([expect.objectContaining({ id: 'code' })]),
            }),
          }),
        }),
        expect.anything(),
      )
    } else {
      expect(api.saveDraft).not.toHaveBeenCalled()
    }
  },
)

it('applies graph and variables from the workflow update event to the real pipeline', async () => {
  const user = userEvent.setup()
  const { store, eventEmitter } = renderMain()
  act(() =>
    eventEmitter.emit({
      type: WORKFLOW_DATA_UPDATE,
      payload: {
        nodes: [
          createNode({
            id: 'updated',
            data: { ...codeNodeDefault.defaultValue, title: 'Imported pipeline' },
          }),
        ],
        edges: [],
        hash: 'imported-hash',
        rag_pipeline_variables: fields,
        environment_variables: environmentVariables,
      },
    }),
  )
  expect(screen.getByText('Imported pipeline')).toBeInTheDocument()
  expect(screen.queryByText('Transform documents')).not.toBeInTheDocument()
  expect(store.getState()).toMatchObject({
    ragPipelineVariables: fields,
    environmentVariables,
    syncWorkflowDraftHash: 'imported-hash',
  })
  await user.click(screen.getByRole('button', { name: 'datasetPipeline.inputField' }))
  expect(await screen.findByText('Source name')).toBeInTheDocument()
})

it('retains omitted variable slices and allows an explicit empty list to clear them', () => {
  const { store, eventEmitter } = renderMain()
  act(() => {
    store.getState().setRagPipelineVariables?.(fields)
    store.getState().setEnvironmentVariables(environmentVariables)
    eventEmitter.emit({
      type: WORKFLOW_DATA_UPDATE,
      payload: { nodes, edges: [], rag_pipeline_variables: [] },
    })
  })
  expect(store.getState()).toMatchObject({ ragPipelineVariables: [], environmentVariables })
  act(() => {
    store.getState().setRagPipelineVariables?.(fields)
    eventEmitter.emit({
      type: WORKFLOW_DATA_UPDATE,
      payload: { nodes, edges: [], environment_variables: [] },
    })
  })
  expect(store.getState()).toMatchObject({ ragPipelineVariables: fields, environmentVariables: [] })
})

it('closes the real import dialog and clears its open state', async () => {
  const user = userEvent.setup()
  const { store } = renderMain()
  act(() => store.getState().setShowImportDSLModal(true))
  expect(
    await screen.findByRole('dialog', { name: 'workflow.common.importDSL' }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(store.getState().showImportDSLModal).toBe(false)
})

it('exports the pipeline with secrets only after confirmation and downloads the response', async () => {
  const user = userEvent.setup()
  const downloads = captureDownloads()
  const { eventEmitter } = renderMain()
  act(() =>
    eventEmitter.emit({
      type: DSL_EXPORT_CHECK,
      payload: { data: [{ name: 'API_KEY', value: 'masked' }] },
    }),
  )
  expect(screen.getByRole('alertdialog')).toHaveTextContent('API_KEY')
  expect(api.exportPipeline).not.toHaveBeenCalled()
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'workflow.env.export.export' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(api.exportPipeline).toHaveBeenCalledExactlyOnceWith(
    { params: { pipeline_id: 'pipeline-1' }, query: { include_secret: 'true' } },
    { context: { silent: true } },
  )
  expect(downloads).toHaveLength(1)
  expect(downloads[0]!.filename).toBe('Documentation.pipeline')
  expect(await downloads[0]!.blob.text()).toBe('kind: rag_pipeline')
})
