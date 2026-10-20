import type { RefObject } from 'react'
import type { ReactFlowInstance } from 'reactflow'
import type { AppUserAuthDraft } from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import type { TriggerProviderApiEntity } from '@/app/components/workflow/block-selector/types'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { Shape } from '@/app/components/workflow/store'
import type { Edge, Node } from '@/app/components/workflow/types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRef, useImperativeHandle } from 'react'
import ReactFlow, { ReactFlowProvider, useNodes, useReactFlow } from 'reactflow'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { usePluginStore } from '@/app/components/plugins/plugin-detail-panel/store'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { CollectionType } from '@/app/components/tools/types'
import WorkflowWithDefaultContext, { Workflow } from '@/app/components/workflow'
import {
  createEdge,
  createNode,
  createNodeTracing,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '@/app/components/workflow/hooks-store/store'
import { useSingleRunAuthorization } from '@/app/components/workflow/hooks/use-single-run-authorization'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import codeNodeDefault from '@/app/components/workflow/nodes/code/default'
import { BlockEnum, NodeRunningStatus, VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { convertToTriggerWithProvider } from '@/service/use-triggers'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import BasePanel from '../index'

const api = vi.hoisted(() => ({ run: vi.fn(), lastRun: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/base')>()
  return {
    ...actual,
    get: <T,>(...args: Parameters<typeof actual.get>): Promise<T> => {
      if (args[0].startsWith('/workspaces/current/tool-provider/builtin/Tool/credential/info')) {
        return Promise.resolve({
          supported_credential_types: ['api-key'],
          allow_custom_token: true,
          is_oauth_custom_client_enabled: false,
          credentials: [
            {
              id: 'credential-1',
              name: 'Production key',
              provider: 'Tool',
              credential_type: 'api-key',
              is_default: true,
              credentials: {},
            },
          ],
        } as T)
      }
      return actual.get<T>(...args)
    },
  }
})
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/app-1/workflow',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get': api.lastRun,
      'apps.byAppId.workflows.draft.systemVariables.get': async () => ({ items: [] }),
      'apps.byAppId.workflows.draft.conversationVariables.get': async () => ({ items: [] }),
      'files.upload.get': async () => ({
        file_size_limit: 15,
        batch_count_limit: 5,
        file_upload_limit: 5,
      }),
      'files.supportType.get': async () => ({ allowed_extensions: ['txt'] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.nodes.byNodeId.run.post': api.run,
      'workspaces.current.triggerProvider.byProvider.subscriptions.list.get': async () => [
        {
          id: 'subscription-1',
          name: 'Subscription One',
          provider: 'trigger-provider',
          credential_type: 'api-key',
          credentials: {},
          endpoint: 'https://example.com/trigger',
          parameters: {},
          properties: {},
          workflows_in_use: 0,
        },
      ],
      'apps.byAppId.workflows.draft.nodes.byNodeId.variables.get': async () => ({ items: [] }),
      'apps.byAppId.workflows.draft.variables.get': async () => ({ items: [], total: 0 }),
      'rag.pipelines.byPipelineId.workflows.draft.variables.get': async () => ({
        items: [],
        total: 0,
      }),
    }),
  }
})

const result = () =>
  createNodeTracing({
    status: NodeRunningStatus.Succeeded,
    outputs: { result: 'Finished transformation' },
  })
beforeEach(() => {
  usePluginStore.setState({ detail: undefined })
  api.run.mockReset().mockResolvedValue(result())
  api.lastRun.mockReset().mockResolvedValue(result())
})

function PanelContent() {
  return <h3>Node settings</h3>
}
function SelectedPanel({ graphRef }: { graphRef: RefObject<ReactFlowInstance | null> }) {
  const nodes = useNodes<Node['data']>()
  const graph = useReactFlow()
  useImperativeHandle(graphRef, () => graph, [graph])
  const selected = nodes.find((node) => node.data.selected)
  return selected ? (
    <BasePanel id={selected.id} data={selected.data}>
      <PanelContent />
    </BasePanel>
  ) : null
}

function renderPanel({
  data,
  initialStoreState,
  accessControl,
  selected = true,
  tools = [],
  triggers = [],
  resource,
  otherNodes = [],
  edges = [],
}: {
  edges?: Edge[]
  otherNodes?: Node[]
  resource?: EditorResource
  data?: Partial<Node['data']> & Record<string, unknown>
  tools?: ReturnType<typeof createToolProviderFixture>[]
  triggers?: TriggerProviderApiEntity[]
  initialStoreState?: Partial<Shape>
  accessControl?: HooksStoreShape['accessControl']
  selected?: boolean
} = {}) {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_collaboration_mode: false },
    workspacePermissionKeys: ['credential.use'],
  })
  seedAppDslVersion(queryClient)
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: tools,
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  for (const tool of tools) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get.queryKey(
        {
          input: { params: { provider: tool.name, credential_type: 'api-key' } },
        },
      ),
      [],
    )
  }
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(
    [...consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} })],
    triggers.map(convertToTriggerWithProvider),
  )
  for (const trigger of triggers) {
    queryClient.setQueryData(
      [
        ...consoleQuery.workspaces.current.triggerProvider.byProvider.info.get.queryKey({
          input: { params: { provider: trigger.name } },
        }),
      ],
      trigger,
    )
  }
  const node = createNode({
    id: 'node-1',
    width: 240,
    height: 120,
    data: {
      ...codeNodeDefault.defaultValue,
      code: 'def main():\n    return {"result": "ok"}',
      title: 'Code Node',
      desc: 'Node description',
      selected,
      ...data,
    },
  })
  const graph = createRef<ReactFlowInstance>()
  const onUrlUpdate = vi.fn()
  const syncDraft = vi.fn<HooksStoreShape['doSyncWorkflowDraft']>(
    async (_skipRefresh, callback) => {
      callback?.onSuccess?.()
      callback?.onSettled?.()
    },
  )
  const view = renderWorkflowComponent(
    <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
      <button>Before panel</button>
      <WorkflowWithDefaultContext nodes={[node, ...otherNodes]} edges={edges}>
        <Workflow nodes={[node, ...otherNodes]} edges={edges}>
          <SelectedPanel graphRef={graph} />
        </Workflow>
      </WorkflowWithDefaultContext>
    </NuqsTestingAdapter>,
    {
      queryClient,
      resource,
      initialStoreState: {
        workflowCanvasWidth: 1200,
        nodePanelWidth: 480,
        otherPanelWidth: 200,
        ...initialStoreState,
      },
      hooksStoreProps: {
        accessControl: accessControl ?? fullWorkflowAccessControl,
        doSyncWorkflowDraft: syncDraft,
      },
    },
  )
  return { ...view, graph, onUrlUpdate, syncDraft }
}

const panel = () => within(screen.getByRole('region', { name: /workflow.panel.nodePanel/ }))

const toolData: ToolNodeType = {
  type: BlockEnum.Tool,
  title: 'Search tool',
  desc: '',
  provider_id: 'provider/tool',
  provider_type: CollectionType.builtIn,
  provider_name: 'Tool',
  tool_name: 'search',
  tool_label: 'Search',
  tool_parameters: {},
  tool_configurations: {},
}
const appUserDraft: AppUserAuthDraft = {
  oauthEnabled: false,
  apiKeyEnabled: true,
  description: 'Connect app users',
  testConnection: { connections: [] },
}
const toolProvider = (isAuthorized = false) =>
  createToolProviderFixture({
    id: 'provider/tool',
    name: 'Tool',
    allow_delete: true,
    is_team_authorization: isAuthorized,
  })

it('keeps Authorization in Settings before tool configuration and preserves navigation without Workspace authorization', async () => {
  const user = userEvent.setup()
  renderPanel({ data: toolData, tools: [toolProvider()] })
  const settings = panel().getByRole('tabpanel', { name: 'WORKFLOWDEBUG.DEBUG.SETTINGSTAB' })
  expect(
    within(settings)
      .getAllByRole('heading')
      .map((heading) => heading.textContent),
  ).toEqual(['plugin.auth.authorization', 'Node settings'])

  await user.click(panel().getByRole('tab', { name: 'WORKFLOWDEBUG.DEBUG.LASTRUNTAB' }))
  expect(
    panel().queryByRole('heading', { name: 'plugin.auth.authorization' }),
  ).not.toBeInTheDocument()
  expect(panel().getByRole('tabpanel', { name: 'WORKFLOWDEBUG.DEBUG.LASTRUNTAB' })).toBeVisible()
  await user.click(panel().getByRole('tab', { name: 'WORKFLOWDEBUG.DEBUG.SETTINGSTAB' }))
  expect(panel().getByRole('heading', { name: 'plugin.auth.authorization' })).toBeVisible()
  expect(panel().getByRole('tab', { name: 'plugin.auth.workspaceAuth' })).toBeEnabled()
})

it.each([
  { mode: 'workspace-auth' as const, reason: 'workflow.panel.configureWorkspaceAuthorization' },
  { mode: 'app-user-auth' as const, reason: 'workflow.panel.configureTestRunConnection' },
  { mode: 'reuse-from-node' as const, reason: 'workflow.panel.selectReuseNode' },
])(
  'explains a blocked $mode run and consumes queued attempts without syncing or running',
  async ({ mode, reason }) => {
    const user = userEvent.setup()
    const { store, syncDraft } = renderPanel({
      data: toolData,
      tools: [toolProvider()],
      initialStoreState: {
        nodeAuthDrafts: {
          'node-1': {
            provider: 'Tool',
            providerId: 'provider/tool',
            authorizationTab: mode,
            draft: appUserDraft,
          },
        },
      },
    })
    const run = panel().getByRole('button', { name: 'workflow.panel.runThisStep' })
    expect(run).toHaveAttribute('aria-disabled', 'true')
    await user.hover(run)
    expect(await screen.findByText(reason)).toBeVisible()
    await user.click(run)
    act(() => store.getState().setPendingSingleRun({ nodeId: 'node-1', action: 'run' }))
    await waitFor(() => expect(store.getState().pendingSingleRun).toBeUndefined())
    expect(api.run).not.toHaveBeenCalled()
    expect(syncDraft).not.toHaveBeenCalled()
  },
)

it.each([
  { kind: 'default mock', testConnection: undefined },
  {
    kind: 'explicit connection with stale selection',
    testConnection: {
      connections: [
        {
          id: 'test-key',
          name: 'Test key',
          method: CredentialTypeEnum.API_KEY,
          subtitle: '•••• 7A2F',
        },
      ],
      selectedId: 'missing-id',
    },
  },
])(
  'runs App user auth with its $kind despite missing Workspace authorization',
  async ({ testConnection }) => {
    const user = userEvent.setup()
    renderPanel({
      data: toolData,
      tools: [toolProvider()],
      initialStoreState: {
        nodeAuthDrafts: {
          'node-1': {
            provider: 'Tool',
            providerId: 'provider/tool',
            authorizationTab: 'app-user-auth',
            draft: { ...appUserDraft, testConnection },
          },
        },
      },
    })
    const run = panel().getByRole('button', { name: 'workflow.panel.runThisStep' })
    expect(run).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(run)
    await waitFor(() => expect(api.run).toHaveBeenCalledOnce())
  },
)

it('preserves required tool parameter validation with an App user test connection', async () => {
  const user = userEvent.setup()
  const showError = vi.spyOn(toast, 'error')
  const provider = toolProvider()
  provider.tools = [
    {
      author: 'Dify',
      name: 'search',
      label: { en_US: 'Search' },
      description: { en_US: 'Search documents' },
      parameters: [
        {
          name: 'query',
          label: { en_US: 'Query' },
          type: 'string',
          form: 'llm',
          required: true,
          multiple: false,
        },
      ],
    },
  ]
  const { syncDraft } = renderPanel({
    data: toolData,
    tools: [provider],
    initialStoreState: {
      nodeAuthDrafts: {
        'node-1': {
          provider: 'Tool',
          providerId: 'provider/tool',
          authorizationTab: 'app-user-auth',
          draft: { ...appUserDraft, testConnection: undefined },
        },
      },
    },
  })
  await user.click(panel().getByRole('button', { name: 'workflow.panel.runThisStep' }))
  expect(api.run).not.toHaveBeenCalled()
  expect(syncDraft).not.toHaveBeenCalled()
  expect(showError).toHaveBeenCalledWith(expect.stringContaining('workflow.errorMsg.fieldRequired'))
  expect(showError).not.toHaveBeenCalledWith('workflow.errorMsg.authRequired')
})

it('rechecks test connection availability before submitting an already open single-run form', async () => {
  const user = userEvent.setup()
  const draft = { ...appUserDraft, testConnection: undefined }
  const { store, syncDraft } = renderPanel({
    data: {
      ...toolData,
      tool_parameters: {
        query: { type: VarKindType.variable, value: ['source-node', 'result'] },
      },
    },
    tools: [toolProvider()],
    otherNodes: [
      createNode({
        id: 'source-node',
        data: {
          ...codeNodeDefault.defaultValue,
          type: BlockEnum.Code,
          title: 'Source node',
          code: 'def main():\n    return {"result": "ok"}',
          outputs: { result: { type: VarType.string } },
        },
      }),
    ],
    edges: [createEdge({ source: 'source-node', target: 'node-1' })],
    initialStoreState: {
      nodeAuthDrafts: {
        'node-1': {
          provider: 'Tool',
          providerId: 'provider/tool',
          authorizationTab: 'app-user-auth',
          draft,
        },
      },
    },
  })
  await user.click(panel().getByRole('button', { name: 'workflow.panel.runThisStep' }))
  await user.type(await panel().findByRole('textbox', { name: /result/ }), 'Test input')
  expect(syncDraft).toHaveBeenCalledOnce()
  act(() =>
    store.getState().setNodeAppUserAuthDraft('node-1', 'Tool', 'provider/tool', appUserDraft),
  )
  await user.click(panel().getByRole('button', { name: 'workflow.singleRun.startRun' }))
  expect(api.run).not.toHaveBeenCalled()
  expect(syncDraft).toHaveBeenCalledOnce()

  act(() => store.getState().setNodeAppUserAuthDraft('node-1', 'Tool', 'provider/tool', draft))
  await user.click(panel().getByRole('button', { name: 'workflow.singleRun.startRun' }))
  await waitFor(() => expect(api.run).toHaveBeenCalledOnce())
})

it('persists title and description edits on the selected graph node and closes the panel', async () => {
  const user = userEvent.setup()
  const { graph } = renderPanel()
  const title = screen.getByRole('textbox', { name: 'workflow.common.nodeTitle' })
  await user.click(title)
  await user.keyboard('{Control>}a{/Control}Updated title{Enter}')
  const description = screen.getByRole('textbox', { name: 'workflow.common.nodeDescription' })
  await user.clear(description)
  await user.type(description, 'Updated description')
  await waitFor(() =>
    expect(graph.current!.getNode('node-1')!.data).toMatchObject({
      title: 'Updated title',
      desc: 'Updated description',
    }),
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(screen.queryByRole('region', { name: /workflow.panel.nodePanel/ })).not.toBeInTheDocument()
})

it.each([
  { canEdit: true, canRun: true, canvasReadOnly: false, visible: true },
  { canEdit: true, canRun: true, canvasReadOnly: true, visible: false },
  { canEdit: true, canRun: false, canvasReadOnly: false, visible: false },
  { canEdit: false, canRun: true, canvasReadOnly: false, visible: false },
])('respects run access and canvas state: %j', ({ canEdit, canRun, canvasReadOnly, visible }) => {
  renderPanel({
    initialStoreState: { canvasReadOnly },
    accessControl: { ...fullWorkflowAccessControl, canEdit, canRun },
  })
  const run = panel().queryByRole('button', { name: 'workflow.panel.runThisStep' })
  if (visible) expect(run).toBeEnabled()
  else expect(run).not.toBeInTheDocument()
})

it('runs a configured node and displays its actual service result', async () => {
  const user = userEvent.setup()
  renderPanel()
  await user.click(panel().getByRole('button', { name: 'workflow.panel.runThisStep' }))
  await waitFor(() =>
    expect(api.run).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'app-1', node_id: 'node-1' },
      body: { inputs: {} },
    }),
  )
  expect(await screen.findByText(/Finished transformation/)).toBeInTheDocument()
})

it('consumes a queued run once and leaves other nodes’ queued actions untouched', async () => {
  const { store } = renderPanel({
    initialStoreState: { pendingSingleRun: { nodeId: 'node-1', action: 'run' } },
  })
  await waitFor(() => expect(api.run).toHaveBeenCalledTimes(1))
  expect(store.getState().pendingSingleRun).toBeUndefined()
  act(() => store.getState().setPendingSingleRun({ nodeId: 'other-node', action: 'run' }))
  expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'other-node', action: 'run' })
  expect(api.run).toHaveBeenCalledTimes(1)
})

it.each(['button', 'queued action'])(
  'stops an outstanding single run through %s',
  async (source) => {
    const user = userEvent.setup()
    const pending = createDeferred<ReturnType<typeof result>>()
    api.run.mockReturnValue(pending.promise)
    const { store } = renderPanel()
    await user.click(panel().getByRole('button', { name: 'workflow.panel.runThisStep' }))
    const stop = await panel().findByRole('button', {
      name: 'workflowDebug.debug.variableInspect.trigger.stop',
    })
    if (source === 'button') await user.click(stop)
    else act(() => store.getState().setPendingSingleRun({ nodeId: 'node-1', action: 'stop' }))
    expect(store.getState().pendingSingleRun).toBeUndefined()
    expect((await panel().findAllByText('appLog.status.stopped')).length).toBeGreaterThan(0)
    await act(async () => pending.resolve(result()))
  },
)

it('resizes through the keyboard and persists the chosen width', async () => {
  const user = userEvent.setup()
  renderPanel()
  const handle = screen.getByRole('separator', { name: 'workflow.panel.nodePanel' })
  act(() => handle.focus())
  await user.keyboard('{ArrowLeft}')
  expect(handle).toHaveAttribute('aria-valuenow', '488')
  await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
  expect(handle).toHaveAttribute('aria-valuenow', '520')
  await user.keyboard('{Shift>}{ArrowRight}{/Shift}{ArrowRight}')
  expect(handle).toHaveAttribute('aria-valuenow', '480')
  await waitFor(() => expect(localStorage.getItem('workflow-node-panel-width')).toBe('480'))
  await user.tab()
  expect(handle).not.toHaveFocus()
})

it('clamps keyboard resizing to the available width and preserves unrelated keys', async () => {
  const user = userEvent.setup()
  const { store } = renderPanel()
  const handle = screen.getByRole('separator', { name: 'workflow.panel.nodePanel' })
  act(() => handle.focus())
  const onKeyDown = vi.fn()
  document.addEventListener('keydown', onKeyDown)
  try {
    await user.keyboard('{Home}{ArrowRight}')
    expect(handle).toHaveAttribute('aria-valuenow', '400')
    await user.keyboard('{End}{ArrowLeft}')
    expect(handle).toHaveAttribute('aria-valuenow', '600')
    expect(onKeyDown).not.toHaveBeenCalled()
    act(() => store.getState().setOtherPanelWidth(300))
    await waitFor(() => expect(handle).toHaveAttribute('aria-valuemax', '500'))
    expect(handle).toHaveAttribute('aria-valuenow', '500')
    await user.keyboard('{ArrowDown}')
    expect(onKeyDown).toHaveBeenCalledOnce()
    expect(handle).toHaveAttribute('aria-valuenow', '500')
  } finally {
    document.removeEventListener('keydown', onKeyDown)
  }
})

it('compresses the panel when preview space grows without overwriting the preferred width', async () => {
  localStorage.setItem('workflow-node-panel-width', '600')
  const { store } = renderPanel({
    initialStoreState: { workflowCanvasWidth: 1400, nodePanelWidth: 600, otherPanelWidth: 400 },
  })
  const handle = screen.getByRole('separator', { name: 'workflow.panel.nodePanel' })
  expect(handle).toHaveAttribute('aria-valuenow', '600')
  act(() => store.getState().setOtherPanelWidth(600))
  await waitFor(() => expect(handle).toHaveAttribute('aria-valuenow', '400'))
  expect(localStorage.getItem('workflow-node-panel-width')).toBe('600')
})

it.each([true, false])(
  'opens data-source settings through the actual authorization control: %s',
  async (isAuthorized) => {
    const user = userEvent.setup()
    const provider = createDatasourceProvider({
      plugin_id: 'source-1',
      is_authorized: isAuthorized,
    })
    const { onUrlUpdate } = renderPanel({
      data: {
        type: BlockEnum.DataSource,
        title: 'Data source',
        plugin_id: 'source-1',
        provider_type: 'online_document',
        provider_name: 'file',
        datasource_name: 'local-file',
        datasource_parameters: {},
        datasource_configurations: {},
      },
      initialStoreState: { dataSourceList: [provider] },
    })
    await user.click(
      panel().getByRole('button', {
        name: isAuthorized ? 'plugin.auth.authorizations' : 'common.integrations.connect',
      }),
    )
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('data-source'),
    )
  },
)

it.each([BlockEnum.Code, BlockEnum.Start, BlockEnum.End])(
  'opens a %s panel from the keyboard and returns focus to its canvas node on Escape',
  async (type) => {
    const user = userEvent.setup()
    renderPanel({ selected: false, data: { type, variables: [], outputs: [] } })
    const node = screen.getByRole('button', { name: /Code Node/ })
    act(() => node.focus())
    await user.keyboard('{Enter}')
    expect(
      await screen.findByRole('textbox', { name: 'workflow.common.nodeDescription' }),
    ).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('region', { name: /workflow.panel.nodePanel/ }),
    ).not.toBeInTheDocument()
    expect(node).toHaveFocus()
  },
)

it('selects a real tool credential and stores it on the graph node', async () => {
  const user = userEvent.setup()
  const provider = createToolProviderFixture({
    id: 'provider/tool',
    name: 'Tool',
    allow_delete: true,
  })
  const { graph } = renderPanel({
    tools: [provider],
    data: {
      type: BlockEnum.Tool,
      title: 'Search tool',
      provider_id: 'provider/tool',
      provider_type: 'builtin',
      provider_name: 'Tool',
      tool_name: 'search',
      tool_label: 'Search',
      tool_parameters: {},
      tool_configurations: {},
    },
  })
  await user.click(await panel().findByRole('button', { name: /Production key/ }))
  await user.click(
    within(screen.getByRole('dialog', { name: 'plugin.auth.authorization' })).getByRole('button', {
      name: /^Production key/,
    }),
  )
  await waitFor(() =>
    expect(graph.current!.getNode('node-1')!.data.credential_id).toBe('credential-1'),
  )
  expect(panel().getByRole('button', { name: /Production key/ })).toBeInTheDocument()
})

it('loads the selected trigger provider and persists a subscription picked from its real list', async () => {
  const user = userEvent.setup()
  const { graph } = renderPanel({
    triggers: [
      {
        author: 'Dify',
        name: 'trigger-provider',
        label: { en_US: 'Trigger provider', zh_Hans: '触发器' },
        description: { en_US: 'Trigger events', zh_Hans: '触发事件' },
        tags: [],
        plugin_id: 'plugin-id',
        plugin_unique_identifier: 'plugin-id:1',
        supported_creation_methods: [],
        subscription_schema: [],
        events: [],
      },
    ],
    data: {
      type: BlockEnum.TriggerPlugin,
      title: 'Trigger',
      plugin_id: 'plugin-id',
      provider_id: 'plugin-id',
      provider_name: 'trigger-provider',
      provider_type: 'trigger',
      event_name: 'new-event',
      event_label: 'New event',
      event_parameters: {},
      event_configurations: {},
      output_schema: {},
    },
  })
  await user.click(
    await panel().findByRole('button', {
      name: 'pluginTrigger.subscription.noSubscriptionSelected',
    }),
  )
  await user.click(await screen.findByRole('button', { name: 'Subscription One' }))
  await waitFor(() =>
    expect(graph.current!.getNode('node-1')!.data.subscription_id).toBe('subscription-1'),
  )
  expect(panel().getByRole('button', { name: 'Subscription One' })).toBeInTheDocument()
})

it('does not carry a stopped run into another selected node', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<ReturnType<typeof result>>()
  api.run.mockReturnValue(pending.promise)
  renderPanel({
    otherNodes: [
      createNode({
        id: 'node-2',
        width: 240,
        height: 120,
        position: { x: 300, y: 0 },
        data: { ...codeNodeDefault.defaultValue, title: 'Other node' },
      }),
    ],
  })
  await user.click(panel().getByRole('button', { name: 'workflow.panel.runThisStep' }))
  await user.click(
    await panel().findByRole('button', {
      name: 'workflowDebug.debug.variableInspect.trigger.stop',
    }),
  )
  expect((await panel().findAllByText('appLog.status.stopped')).length).toBeGreaterThan(0)
  act(() => screen.getByRole('button', { name: /Other node/ }).focus())
  await user.keyboard('{Enter}')
  await user.click(panel().getByRole('tab', { name: 'WORKFLOWDEBUG.DEBUG.LASTRUNTAB' }))
  await waitFor(() => expect(panel().queryAllByText('appLog.status.stopped')).toHaveLength(0))
  expect(await panel().findByText(/Finished transformation/)).toBeInTheDocument()
  await act(async () => pending.resolve(result()))
})

it.each(['cancel', 'Escape'])(
  'saves the draft, opens datasource preparation without running, and closes through %s',
  async (action) => {
    const user = userEvent.setup()
    const { syncDraft } = renderPanel({
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
      data: {
        type: BlockEnum.DataSource,
        title: 'Local files',
        plugin_id: 'langgenius/file',
        provider_type: 'local_file',
        provider_name: 'file',
        datasource_name: 'local-file',
        datasource_parameters: {},
        datasource_configurations: {},
        fileExtensions: ['txt'],
      },
      initialStoreState: { dataSourceList: [createDatasourceProvider()] },
    })
    await user.click(panel().getByRole('button', { name: 'workflow.panel.runThisStep' }))
    expect(
      await panel().findByRole('button', { name: 'datasetCreation.stepOne.uploader.browse' }),
    ).toBeEnabled()
    expect(panel().getByRole('button', { name: 'workflow.singleRun.startRun' })).toBeDisabled()
    expect(syncDraft).toHaveBeenCalledOnce()
    if (action === 'Escape') {
      act(() => panel().getByRole('button', { name: 'common.operation.cancel' }).focus())
      await user.keyboard('{Escape}')
      expect(
        screen.queryByRole('region', { name: /workflow.panel.nodePanel/ }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Local files/ })).toHaveFocus()
    } else {
      await user.click(panel().getByRole('button', { name: 'common.operation.cancel' }))
      expect(
        panel().getByRole('textbox', { name: 'workflow.common.nodeDescription' }),
      ).toBeInTheDocument()
      expect(
        panel().queryByRole('button', { name: 'datasetCreation.stepOne.uploader.browse' }),
      ).not.toBeInTheDocument()
    }
    expect(api.run).not.toHaveBeenCalled()
  },
)

it('closes nested tool execution details with Escape and restores canvas focus', async () => {
  const user = userEvent.setup()
  api.lastRun.mockResolvedValue(
    createNodeTracing({
      node_type: BlockEnum.Tool,
      status: NodeRunningStatus.Succeeded,
      agentLog: [
        {
          node_execution_id: 'execution-1',
          message_id: 'log-1',
          node_id: 'node-1',
          label: 'Tool result',
          status: 'success',
          data: {},
          children: [],
        },
      ],
    }),
  )
  renderPanel({
    data: {
      type: BlockEnum.Tool,
      title: 'Search tool',
      provider_id: 'provider/tool',
      provider_type: 'builtin',
      provider_name: 'Tool',
      tool_name: 'search',
      tool_label: 'Search',
      tool_parameters: {},
      tool_configurations: {},
    },
    initialStoreState: { initShowLastRunTab: true },
  })
  await user.click(
    await panel().findByRole('button', { name: /workflowAgent.nodes.agent.strategy.label/ }),
  )
  expect(
    panel().getByRole('navigation', { name: 'workflowAgent.nodes.agent.strategy.label' }),
  ).toBeInTheDocument()
  expect(panel().getByText('Tool result')).toBeInTheDocument()
  act(() => panel().getByRole('button', { name: 'AGENT' }).focus())
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('region', { name: /workflow.panel.nodePanel/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Search tool/ })).toHaveFocus()
})

it('uses the terminal Reuse source for test-connection gating and executes without Workspace authorization', async () => {
  const user = userEvent.setup()
  const source = createNode({ id: 'auth-source', data: { ...toolData, tool_name: 'another-tool' } })
  const middle = createNode({ id: 'middle', data: { ...toolData, tool_name: 'third-tool' } })
  const { store } = renderPanel({
    data: toolData,
    tools: [toolProvider()],
    otherNodes: [source, middle],
    edges: [
      createEdge({ source: 'auth-source', target: 'middle' }),
      createEdge({ source: 'middle', target: 'node-1' }),
    ],
    initialStoreState: {
      nodeAuthDrafts: {
        'node-1': {
          provider: 'Tool',
          providerId: 'provider/tool',
          authorizationTab: 'reuse-from-node',
          reuseFromNode: { source: { id: 'middle', title: 'Middle' } },
        },
        middle: {
          provider: 'Tool',
          providerId: 'provider/tool',
          authorizationTab: 'reuse-from-node',
          reuseFromNode: { source: { id: 'auth-source', title: 'Source' } },
        },
        'auth-source': {
          provider: 'Tool',
          providerId: 'provider/tool',
          authorizationTab: 'app-user-auth',
          draft: appUserDraft,
        },
      },
    },
  })
  const run = panel().getByRole('button', { name: 'workflow.panel.runThisStep' })
  expect(run).toHaveAttribute('aria-disabled', 'true')
  await user.hover(run)
  expect(await screen.findByText('workflow.panel.configureTestRunConnection')).toBeVisible()
  act(() =>
    store.getState().setNodeAppUserAuthDraft('auth-source', 'Tool', 'provider/tool', {
      ...appUserDraft,
      testConnection: undefined,
    }),
  )
  await waitFor(() =>
    expect(panel().getByRole('button', { name: 'workflow.panel.runThisStep' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  )
  await user.click(panel().getByRole('button', { name: 'workflow.panel.runThisStep' }))
  await waitFor(() => expect(api.run).toHaveBeenCalledOnce())
})

it('blocks an already removed Reuse source and keeps its saved display reference visible', async () => {
  const user = userEvent.setup()
  const { store, syncDraft } = renderPanel({
    data: toolData,
    tools: [toolProvider(true)],
    initialStoreState: {
      nodeAuthDrafts: {
        'node-1': {
          provider: 'Tool',
          providerId: 'provider/tool',
          authorizationTab: 'reuse-from-node',
          reuseFromNode: { source: { id: 'auth-source', title: 'Source tool' } },
        },
      },
    },
  })
  const run = () => panel().getByRole('button', { name: 'workflow.panel.runThisStep' })
  expect(run()).toHaveAttribute('aria-disabled', 'true')
  expect(panel().getByText('Source tool')).toBeVisible()
  await user.hover(run())
  expect(await screen.findByText('workflow.panel.selectReuseNode')).toBeVisible()
  await user.click(run())
  act(() => store.getState().setPendingSingleRun({ nodeId: 'node-1', action: 'run' }))
  await waitFor(() => expect(store.getState().pendingSingleRun).toBeUndefined())
  expect(api.run).not.toHaveBeenCalled()
  expect(syncDraft).not.toHaveBeenCalled()
})

it('updates single-run authorization when a Reuse source is removed from and restored to the live graph', async () => {
  const user = userEvent.setup()
  const source = createNode({ id: 'auth-source', data: { ...toolData, title: 'Source tool' } })
  const current = createNode({ id: 'node-1', data: toolData })
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [toolProvider(true)],
    customTools: [],
    workflowTools: [],
  })
  function LiveAuthorization() {
    const { disabledReason } = useSingleRunAuthorization(current.id, toolData)
    const graph = useReactFlow()
    return (
      <>
        <output aria-label="Run authorization">{disabledReason ?? 'Ready'}</output>
        <button
          onClick={() => {
            void graph.deleteElements({ nodes: [{ id: source.id }] })
          }}
        >
          Delete source
        </button>
        <button onClick={() => graph.addNodes(source)}>Restore source</button>
      </>
    )
  }
  renderWorkflowComponent(
    <ReactFlowProvider>
      <ReactFlow defaultNodes={[current, source]} />
      <LiveAuthorization />
    </ReactFlowProvider>,
    {
      queryClient,
      initialStoreState: {
        nodeAuthDrafts: {
          'node-1': {
            provider: 'Tool',
            providerId: 'provider/tool',
            authorizationTab: 'reuse-from-node',
            reuseFromNode: { source: { id: 'auth-source', title: 'Source tool' } },
          },
        },
      },
    },
  )
  const authorization = screen.getByRole('status', { name: 'Run authorization' })
  expect(authorization).toHaveTextContent('Ready')
  await user.click(screen.getByRole('button', { name: 'Delete source' }))
  await waitFor(() => expect(authorization).toHaveTextContent('workflow.panel.selectReuseNode'))
  await user.click(screen.getByRole('button', { name: 'Restore source' }))
  await waitFor(() => expect(authorization).toHaveTextContent('Ready'))
})
