import type { Shape } from '@/app/components/workflow/store/workflow'
import type { consoleClient } from '@/service/console'
import type { fetchRunDetail, fetchTracingList } from '@/service/log'
import type { FetchWorkflowDraftPageResponse, FetchWorkflowDraftResponse } from '@/types/workflow'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { FeaturesProvider } from '@/app/components/base/features'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import DatasetsDetailProvider from '@/app/components/workflow/datasets-detail-store/provider'
import { useStore } from '@/app/components/workflow/store'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDetail } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import WorkflowPanel from '../workflow-panel'

const api = vi.hoisted(() => ({
  externalTrace: vi.fn<typeof consoleClient.apps.byAppId.traceRuns.bySourceKind.bySourceId.get>(),
  run: vi.fn<typeof fetchRunDetail>(),
  tracing: vi.fn<typeof fetchTracingList>(),
  history: vi.fn<(url: string, options?: unknown) => Promise<FetchWorkflowDraftPageResponse>>(),
  update:
    vi.fn<
      typeof import('@/service/console').consoleClient.apps.byAppId.workflows.byWorkflowId.patch
    >(),
  remove:
    vi.fn<
      typeof import('@/service/console').consoleClient.apps.byAppId.workflows.byWorkflowId.delete
    >(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-123' }),
  usePathname: () => '/app/app-123/workflow',
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: api.history,
}))
vi.mock('@/service/log', () => ({
  fetchRunDetail: api.run,
  fetchTracingList: api.tracing,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.byWorkflowId.patch': api.update,
      'apps.byAppId.workflows.byWorkflowId.delete': api.remove,
      'apps.byAppId.traceRuns.bySourceKind.bySourceId.get': (input) => api.externalTrace(input),
      'workspaces.current.agentProviders.get': async () => [],
      'apps.byAppId.workflows.draft.environmentVariables.get': async () => ({ items: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggers.get': async () => [],
      'apps.byAppId.workflows.draft.variables.get': async () => ({ items: [], total: 0 }),
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
const nodes = [createStartNode({ id: 'start', data: { title: 'User input', variables: [] } })]
const logItem = { id: 'log-1', content: 'Answer', isAnswer: true, workflow_run_id: 'run-1' }
function OpenPanels() {
  const showLog = useStore((s) => s.setMessageLogItem)
  const showPreview = useStore((s) => s.setShowDebugAndPreviewPanel)
  const showGlobals = useStore((s) => s.setShowGlobalVariablePanel)
  return (
    <>
      <button type="button" onClick={() => showLog(logItem)}>
        Open message log
      </button>
      <button type="button" onClick={() => showPreview(true)}>
        Open preview
      </button>
      <button type="button" onClick={() => showGlobals(true)}>
        Open global variables
      </button>
    </>
  )
}
function setup(
  initialStoreState: Partial<Shape> = {},
  mode: 'workflow' | 'advanced-chat' = 'workflow',
) {
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
  seedAppDetail(
    queryClient,
    createAppDetailFixture({ id: 'app-123', mode, workflow: { id: 'release-1' } }),
  )
  const rendered = renderWorkflowEditor(
    <NuqsTestingAdapter>
      <FeaturesProvider>
        <EventEmitterContextProvider>
          <DatasetsDetailProvider nodes={nodes}>
            <OpenPanels />
            <WorkflowPanel />
            <AppToastHost timeout={0} />
          </DatasetsDetailProvider>
        </EventEmitterContextProvider>
      </FeaturesProvider>
    </NuqsTestingAdapter>,
    {
      queryClient,
      nodes,
      historyStore: { nodes, edges: [] },
      initialStoreState,
      resource: { kind: 'app', appId: 'app-123', mode },
    },
  )
  return { ...rendered, user: userEvent.setup() }
}
let originalUrl: string
beforeEach(() => {
  api.externalTrace.mockReset().mockResolvedValue({
    status: 'accepted',
    source_kind: 'workflow',
    source_id: 'run-1',
    provider: 'langfuse',
    trace_url: 'https://cloud.langfuse.com/trace/run-1',
  })
  originalUrl = window.location.href
  window.history.replaceState({}, '', '/app/app-123/workflow')
  versions = [version()]
  api.run.mockReset().mockResolvedValue({
    id: 'run-1',
    version: '1',
    graph: { nodes: [], edges: [] },
    inputs: '{}',
    inputs_truncated: false,
    status: 'succeeded',
    outputs: '{}',
    outputs_truncated: false,
    elapsed_time: 1,
    total_tokens: 24,
    total_steps: 2,
    created_by_role: 'account',
    created_by_account: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    created_at: 1700000000,
    finished_at: 1700000001,
  })
  api.tracing.mockReset().mockResolvedValue({ data: [] })
  api.history.mockReset().mockImplementation(async (url) => {
    if (url !== '/apps/app-123/workflows') throw new Error(`Unexpected GET: ${url}`)
    return { items: versions, page: 1, limit: 10, total: versions.length, has_more: false }
  })
  api.update.mockReset().mockImplementation(async ({ body }) => {
    const updated = version({
      marked_name: body.marked_name ?? '',
      marked_comment: body.marked_comment ?? '',
    })
    versions = [updated]
    return createWorkflowResponseFixture({
      marked_name: body.marked_name ?? '',
      marked_comment: body.marked_comment ?? '',
      id: updated.id,
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

it('loads this app’s version history and protects the published version from deletion', async () => {
  const { user } = setup({ showWorkflowVersionHistoryPanel: true })
  expect(await screen.findByText('First release')).toBeInTheDocument()
  expect(api.history).toHaveBeenCalledWith('/apps/app-123/workflows', {
    params: { page: 1, limit: 10, user_id: '', named_only: false },
  })
  expect(screen.getByText('workflowHistory.versionHistory.latest')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  expect(
    screen.queryByRole('menuitem', { name: 'common.operation.delete' }),
  ).not.toBeInTheDocument()
})

it('edits and deletes an older version through this app’s real history actions', async () => {
  versions = [version({ id: 'old-release' })]
  api.update.mockImplementation(async ({ body }) => {
    versions = [
      version({
        marked_name: body.marked_name ?? '',
        marked_comment: body.marked_comment ?? '',
        id: 'old-release',
      }),
    ]
    return createWorkflowResponseFixture({
      marked_name: body.marked_name ?? '',
      marked_comment: body.marked_comment ?? '',
      id: 'old-release',
    })
  })
  const { user } = setup({ showWorkflowVersionHistoryPanel: true })
  await screen.findByText('First release')
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
  await user.type(title, 'Renamed release')
  await user.type(
    within(dialog).getByRole('textbox', {
      name: 'workflowHistory.versionHistory.editField.releaseNotes',
    }),
    'Updated notes',
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  expect(await screen.findByText('Renamed release')).toBeInTheDocument()
  expect(api.update).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-123', workflow_id: 'old-release' },
    body: { marked_name: 'Renamed release', marked_comment: 'Updated notes' },
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))
  const confirm = await screen.findByRole('alertdialog')
  await user.click(within(confirm).getByRole('button', { name: 'common.operation.delete' }))
  await waitFor(() =>
    expect(api.remove).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'app-123', workflow_id: 'old-release' },
    }),
  )
  await waitFor(() => expect(screen.queryByText('Renamed release')).not.toBeInTheDocument())
})

it('reopens a closed message log on its default detail tab', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Open message log' }))
  expect(await screen.findByRole('tab', { name: 'runLog.detail' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(api.run).toHaveBeenCalledWith('/apps/app-123/workflow-runs/run-1')
  expect(await screen.findByRole('link', { name: 'app.tracing.run.viewTrace' })).toHaveAttribute(
    'href',
    'https://cloud.langfuse.com/trace/run-1',
  )
  expect(api.externalTrace).toHaveBeenCalledWith({
    params: { app_id: 'app-123', source_kind: 'workflow', source_id: 'run-1' },
  })
  await user.click(screen.getByRole('tab', { name: 'runLog.tracing' }))
  expect(screen.getByRole('tab', { name: 'runLog.tracing' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() =>
    expect(screen.queryByRole('tab', { name: 'runLog.detail' })).not.toBeInTheDocument(),
  )
  await user.click(screen.getByRole('button', { name: 'Open message log' }))
  expect(await screen.findByRole('tab', { name: 'runLog.detail' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

it.each(['workflow', 'advanced-chat'] as const)(
  'opens and closes the appropriate real preview in %s mode',
  async (mode) => {
    const { user } = setup({}, mode)
    await user.click(screen.getByRole('button', { name: 'Open preview' }))
    const name =
      mode === 'workflow' ? 'workflow.singleRun.testRun' : 'workflow.common.debugAndPreview'
    expect(await screen.findByRole('separator', { name })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('separator', { name })).not.toBeInTheDocument())
  },
)

it.each(['workflow', 'advanced-chat'] as const)(
  'exposes the system variables belonging to %s mode',
  async (mode) => {
    const { user } = setup({}, mode)
    await user.click(screen.getByRole('button', { name: 'Open global variables' }))
    expect(await screen.findByText('workflow.globalVar.title')).toBeInTheDocument()
    if (mode === 'workflow') {
      expect(
        screen.getByText((_, node) => node?.textContent === 'sys.timestamp'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('workflow.globalVar.fieldsDescription.triggerTimestamp'),
      ).toBeInTheDocument()
      expect(
        screen.queryByText((_, node) => node?.textContent === 'sys.conversation_id'),
      ).not.toBeInTheDocument()
    } else {
      expect(
        screen.getByText((_, node) => node?.textContent === 'sys.conversation_id'),
      ).toBeInTheDocument()
      expect(
        screen.getByText((_, node) => node?.textContent === 'sys.dialog_count'),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('workflow.globalVar.fieldsDescription.triggerTimestamp'),
      ).not.toBeInTheDocument()
    }
  },
)
