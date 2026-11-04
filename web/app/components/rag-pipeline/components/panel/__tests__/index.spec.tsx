import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { FetchWorkflowDraftPageResponse, FetchWorkflowDraftResponse } from '@/types/workflow'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { FeaturesProvider } from '@/app/components/base/features'
import { createRagPipelineSliceSlice } from '@/app/components/rag-pipeline/store'
import { createNode, createWorkflowRunningData } from '@/app/components/workflow/__tests__/fixtures'
import DatasetsDetailProvider from '@/app/components/workflow/datasets-detail-store/provider'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import DatasetDetailContext from '@/context/dataset-detail'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { DatasourceType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import RagPipelinePanel from '../index'

const api = vi.hoisted(() => ({
  history: vi.fn<(url: string, options?: unknown) => Promise<FetchWorkflowDraftPageResponse>>(),
  update:
    vi.fn<
      typeof import('@/service/console').consoleClient.rag.pipelines.byPipelineId.workflows.byWorkflowId.patch
    >(),
  remove:
    vi.fn<
      typeof import('@/service/console').consoleClient.rag.pipelines.byPipelineId.workflows.byWorkflowId.delete
    >(),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: api.history,
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ datasetId: 'dataset-1' }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.byWorkflowId.patch': api.update,
      'rag.pipelines.byPipelineId.workflows.byWorkflowId.delete': api.remove,
      'rag.pipelines.byPipelineId.workflows.draft.preProcessing.parameters.get': async () => ({
        variables: [],
      }),
      'rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get': async () => ({
        variables: [],
      }),
    }),
  }
})

const version = (
  overrides: Partial<FetchWorkflowDraftResponse> = {},
): FetchWorkflowDraftResponse => ({
  ...createWorkflowResponseFixture(),
  id: 'release-1',
  version: '2026-06-01T00:00:00Z',
  marked_name: 'First release',
  conversation_variables: [],
  environment_variables: [],
  rag_pipeline_variables: [],
  graph: { nodes: [], edges: [] },
  created_by: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
  updated_by: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
  ...overrides,
})
let versions: FetchWorkflowDraftResponse[]
const nodes = [
  createNode({
    id: 'local',
    data: {
      type: BlockEnum.DataSource,
      title: 'Local File',
      desc: '',
      provider_type: DatasourceType.localFile,
      provider_name: 'Local File',
      plugin_id: 'datasource-plugin',
      datasource_name: 'local',
      datasource_label: 'Local File',
      datasource_parameters: {},
      datasource_configurations: {},
      fileExtensions: ['txt', 'pdf'],
    } satisfies DataSourceNodeType,
  }),
]

function OpenPanels() {
  const showInputs = useStore((s) => s.setShowInputFieldPanel)
  const showGlobals = useStore((s) => s.setShowGlobalVariablePanel)
  return (
    <>
      <button type="button" onClick={() => showInputs?.(true)}>
        Open inputs
      </button>
      <button type="button" onClick={() => showGlobals(true)}>
        Open global variables
      </button>
    </>
  )
}

function setup(initialStoreState: Partial<Shape> = {}) {
  const { queryClient } = createConsoleQueryWrapper({
    appDslVersion: '0.6.0',
    features: {},
    systemFeatures: { deployment_edition: 'COMMUNITY' },
  })
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  queryClient.setQueryData(consoleQuery.files.supportType.get.queryKey(), {
    allowed_extensions: ['txt', 'pdf'],
  })
  const rendered = renderWorkflowEditor(
    <NuqsTestingAdapter>
      <FeaturesProvider>
        <EventEmitterContextProvider>
          {/* oxlint-disable-next-line eslint-react/no-context-provider -- This use-context-selector context requires its Provider. */}
          <DatasetDetailContext.Provider
            value={{
              dataset: createDatasetFixture({ id: 'dataset-1', pipeline_id: 'pipeline-1' }),
            }}
          >
            <DatasetsDetailProvider nodes={nodes}>
              <OpenPanels />
              <RagPipelinePanel />
              <AppToaster timeout={0} />
            </DatasetsDetailProvider>
          </DatasetDetailContext.Provider>
        </EventEmitterContextProvider>
      </FeaturesProvider>
    </NuqsTestingAdapter>,
    {
      queryClient,
      nodes,
      historyStore: { nodes, edges: [] },
      initialStoreState,
      injectWorkflowStoreSliceFn: createRagPipelineSliceSlice,
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    },
  )
  return { ...rendered, user: userEvent.setup() }
}

let originalUrl: string
beforeEach(() => {
  originalUrl = window.location.href
  window.history.replaceState({}, '', '/datasets/dataset-1/pipeline')
  versions = [version()]
  api.history.mockReset().mockImplementation(async (url) => {
    if (url !== '/rag/pipelines/pipeline-1/workflows') throw new Error(`Unexpected GET: ${url}`)
    return { items: versions, page: 1, limit: 10, total: versions.length, has_more: false }
  })
  api.update.mockReset().mockImplementation(async ({ body }) => {
    versions = [
      version({ marked_name: body.marked_name ?? '', marked_comment: body.marked_comment ?? '' }),
    ]
    return createWorkflowResponseFixture({
      marked_name: body.marked_name ?? '',
      marked_comment: body.marked_comment ?? '',
      id: 'release-1',
    })
  })
  api.remove.mockReset().mockImplementation(async () => {
    versions = []
  })
})
afterEach(() => {
  window.history.replaceState({}, '', originalUrl)
  act(() => toast.dismiss())
})

it('loads, edits and deletes versions belonging to this pipeline', async () => {
  const { user } = setup({ showWorkflowVersionHistoryPanel: true })
  expect(await screen.findByText('First release')).toBeVisible()
  expect(api.history).toHaveBeenCalledWith('/rag/pipelines/pipeline-1/workflows', {
    params: { page: 1, limit: 10, user_id: '', named_only: false },
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(
    await screen.findByRole('menuitem', { name: 'workflowHistory.versionHistory.editVersionInfo' }),
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'workflowHistory.versionHistory.editVersionInfo',
  })
  const title = within(dialog).getByRole('textbox', {
    name: 'workflowHistory.versionHistory.editField.title',
  })
  await user.clear(title)
  await user.type(title, 'Pipeline v2')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  expect(await screen.findByText('Pipeline v2')).toBeVisible()
  expect(api.update).toHaveBeenCalledExactlyOnceWith({
    params: { pipeline_id: 'pipeline-1', workflow_id: 'release-1' },
    body: { marked_name: 'Pipeline v2', marked_comment: '' },
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))
  const confirm = await screen.findByRole('alertdialog')
  await user.click(within(confirm).getByRole('button', { name: 'common.operation.delete' }))
  await waitFor(() =>
    expect(api.remove).toHaveBeenCalledExactlyOnceWith({
      params: { pipeline_id: 'pipeline-1', workflow_id: 'release-1' },
    }),
  )
  await waitFor(() => expect(screen.queryByText('Pipeline v2')).not.toBeInTheDocument())
})

it('closes input preview with its owner and reopens the editable input panel', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Open inputs' }))
  await user.click(
    await screen.findByRole('button', { name: 'datasetPipeline.operations.preview' }),
  )
  expect(
    await screen.findByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle'),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() =>
    expect(screen.queryByText('datasetPipeline.inputFieldPanel.title')).not.toBeInTheDocument(),
  )
  expect(
    screen.queryByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle'),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Open inputs' }))
  expect(await screen.findByText('datasetPipeline.inputFieldPanel.title')).toBeVisible()
  expect(
    screen.queryByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle'),
  ).not.toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.add' })[0]!)
  expect(await screen.findByRole('textbox', { name: /variableConfig.varName/ })).toBeVisible()
  expect(screen.getByRole('button', { name: 'datasetPipeline.operations.preview' })).toBeDisabled()
})

it('shows datasource preparation and closes the complete test-run panel', async () => {
  const { user } = setup({ showDebugAndPreviewPanel: true, isPreparingDataSource: true })
  expect(await screen.findByRole('radio', { name: 'Local File' })).toBeVisible()
  expect(screen.queryByRole('tab', { name: 'runLog.result' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() =>
    expect(screen.queryByText('datasetPipeline.testRun.title')).not.toBeInTheDocument(),
  )
})

it('opens failure details in the real result panel after preparation', async () => {
  const { user } = setup({
    showDebugAndPreviewPanel: true,
    isPreparingDataSource: false,
    workflowRunningData: createWorkflowRunningData({
      result: {
        status: WorkflowRunningStatus.Failed,
        error: 'Unable to process document',
        inputs_truncated: false,
        process_data_truncated: false,
        outputs_truncated: false,
      },
    }),
  })
  await user.click(
    await screen.findByRole('button', { name: 'pipeline.result.resultPreview.viewDetails' }),
  )
  expect(screen.getByRole('tab', { name: 'runLog.detail' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(await screen.findByText('Unable to process document')).toBeVisible()
  expect(screen.queryByRole('radio', { name: 'Local File' })).not.toBeInTheDocument()
})

it('shows pipeline globals without chat-only variables', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Open global variables' }))
  expect(await screen.findByText('workflow.globalVar.title')).toBeVisible()
  expect(screen.getByText((_, node) => node?.textContent === 'sys.workflow_id')).toBeVisible()
  expect(
    screen.queryByText((_, node) => node?.textContent === 'sys.conversation_id'),
  ).not.toBeInTheDocument()
})
