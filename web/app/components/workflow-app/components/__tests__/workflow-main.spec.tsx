import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { InjectWorkflowStoreSliceFn, Shape } from '@/app/components/workflow/store'
import type { Node } from '@/app/components/workflow/types'
import type { EventEmitterValue } from '@/context/event-emitter'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventEmitter } from 'ahooks/lib/useEventEmitter'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { CollectionType } from '@/app/components/tools/types'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { BlockEnum } from '@/app/components/workflow/types'
import { EventEmitterContext } from '@/context/event-emitter'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import {
  createConsoleQueryWrapper,
  seedAppDetail,
  seedAppDslVersion,
} from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { captureDownloads } from '@/test/download'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { AppACLPermission } from '@/utils/permission'
import { createWorkflowSlice } from '../../store/workflow/workflow-slice'
import WorkflowMain from '../workflow-main'

const api = vi.hoisted(() => ({
  exportDSL: vi.fn(),
  importDSL: vi.fn(),
  webhook: vi.fn(),
  fetchDraft: vi.fn<typeof import('@/service/workflow').fetchWorkflowDraft>(),
  saveDraft:
    vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.post>(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/app-1/workflow',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchWorkflowDraft: api.fetchDraft,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.imports.post': api.importDSL,
      'apps.imports.byAppId.checkDependencies.get': async () => ({ leaked_dependencies: [] }),
      'apps.byAppId.export.get': api.exportDSL,
      'apps.byAppId.workflows.triggers.webhook.get': api.webhook,
      'apps.byAppId.workflows.draft.environmentVariables.get': async () => ({ items: [] }),
      'apps.byAppId.workflows.draft.conversationVariables.get': async () => ({ items: [] }),
      'apps.byAppId.workflows.draft.systemVariables.get': async () => ({ items: [] }),
      'apps.byAppId.workflows.publish.get': async () => createWorkflowResponseFixture(),
      'enterprise.appDeploy.deploymentService.listAppEnvironments': async () => ({ data: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggerProvider.byProvider.subscriptions.list.get': async () => [],
      'apps.byAppId.workflows.draft.post': api.saveDraft,
      'apps.byAppId.workflows.draft.variables.get': async () => ({ items: [], total: 0 }),
      'apps.byAppId.workflow.comments.get': async () => ({ data: [] }),
    }),
  }
})

type Manager = typeof collaborationManager
const events = {
  vars: new Set<Parameters<Manager['onVarsAndFeaturesUpdate']>[0]>(),
  workflow: new Set<Parameters<Manager['onWorkflowUpdate']>[0]>(),
  sync: new Set<Parameters<Manager['onSyncRequest']>[0]>(),
  reload: new Set<Parameters<Manager['onGraphReloadRequired']>[0]>(),
  users: new Set<Parameters<Manager['onOnlineUsersUpdate']>[0]>(),
  cursors: new Set<Parameters<Manager['onCursorUpdate']>[0]>(),
  ready: new Set<Parameters<Manager['onGraphReadyChange']>[0]>(),
}
const initialNodes = [
  createStartNode({ id: 'start', data: { title: 'Workflow entry', variables: [] } }),
]
const draft = (
  overrides: Partial<FetchWorkflowDraftResponse> = {},
): FetchWorkflowDraftResponse => ({
  ...createWorkflowResponseFixture(),
  conversation_variables: [],
  environment_variables: [],
  rag_pipeline_variables: [],
  created_by: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
  updated_by: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
  graph: { nodes: initialNodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  ...overrides,
})

beforeEach(() => {
  for (const listeners of Object.values(events)) listeners.clear()
  vi.spyOn(collaborationManager, 'connect').mockResolvedValue('connection-1')
  vi.spyOn(collaborationManager, 'disconnect').mockImplementation(() => {})
  vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(true)
  vi.spyOn(collaborationManager, 'getIsLeader').mockReturnValue(true)
  vi.spyOn(collaborationManager, 'canPersistLocalGraph').mockReturnValue(true)
  vi.spyOn(collaborationManager, 'refreshGraphSynchronously').mockImplementation(() => {})
  vi.spyOn(collaborationManager, 'replaceGraphFromReactFlow').mockReturnValue(true)
  vi.spyOn(collaborationManager, 'isGraphReloadCurrent').mockReturnValue(true)
  vi.spyOn(collaborationManager, 'retryGraphReload').mockImplementation(() => {})
  vi.spyOn(collaborationManager, 'onVarsAndFeaturesUpdate').mockImplementation((handler) => {
    events.vars.add(handler)
    return () => {
      events.vars.delete(handler)
    }
  })
  vi.spyOn(collaborationManager, 'onWorkflowUpdate').mockImplementation((handler) => {
    events.workflow.add(handler)
    return () => {
      events.workflow.delete(handler)
    }
  })
  vi.spyOn(collaborationManager, 'onSyncRequest').mockImplementation((handler) => {
    events.sync.add(handler)
    return () => {
      events.sync.delete(handler)
    }
  })
  vi.spyOn(collaborationManager, 'onGraphReloadRequired').mockImplementation((handler) => {
    events.reload.add(handler)
    return () => {
      events.reload.delete(handler)
    }
  })
  vi.spyOn(collaborationManager, 'onOnlineUsersUpdate').mockImplementation((handler) => {
    events.users.add(handler)
    return () => {
      events.users.delete(handler)
    }
  })
  vi.spyOn(collaborationManager, 'onCursorUpdate').mockImplementation((handler) => {
    events.cursors.add(handler)
    return () => {
      events.cursors.delete(handler)
    }
  })
  vi.spyOn(collaborationManager, 'onGraphReadyChange').mockImplementation((handler) => {
    events.ready.add(handler)
    handler(true)
    return () => {
      events.ready.delete(handler)
    }
  })
  api.fetchDraft.mockReset().mockResolvedValue(draft())
  api.exportDSL.mockReset().mockResolvedValue({ data: 'kind: app' })
  api.importDSL
    .mockReset()
    .mockResolvedValue({ id: 'import-1', status: 'completed', app_id: 'app-1' })
  api.webhook.mockReset().mockResolvedValue({
    webhook_url: 'https://example.com/live',
    webhook_debug_url: 'https://example.com/debug',
  })
  api.saveDraft
    .mockReset()
    .mockResolvedValue({ result: 'success', hash: 'saved-hash', updated_at: 2 })
})
afterEach(async () => {
  // Unmount while the collaboration transport spies still represent this session.
  await act(async () => cleanup())
  vi.restoreAllMocks()
})

const WorkflowEventProvider = EventEmitterContext.Provider

async function renderMain({
  collaboration = true,
  permission_keys,
  nodes = initialNodes,
  initialStoreState,
  triggers = [],
}: {
  collaboration?: boolean
  permission_keys?: AppDetailWithSite['permission_keys']
  nodes?: Node[]
  initialStoreState?: Partial<Shape>
  triggers?: TriggerWithProvider[]
} = {}) {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_collaboration_mode: collaboration, enable_marketplace: false },
  })
  seedAppDslVersion(queryClient)
  seedAppDetail(
    queryClient,
    createAppDetailFixture({
      id: 'app-1',
      name: 'Workflow app',
      mode: 'workflow',
      permission_keys: permission_keys ?? Object.values(AppACLPermission),
    }),
  )
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(
    [...consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} })],
    triggers,
  )
  for (const trigger of triggers) {
    queryClient.setQueryData(
      [
        ...consoleQuery.workspaces.current.triggerProvider.byProvider.info.get.queryKey({
          input: { params: { provider: trigger.name } },
        }),
      ],
      {
        author: trigger.author,
        name: trigger.name,
        label: trigger.label,
        description: trigger.description,
        tags: [],
        plugin_id: trigger.plugin_id,
        plugin_unique_identifier: trigger.plugin_unique_identifier,
        supported_creation_methods: [],
        subscription_schema: [],
        events: [],
      },
    )
  }
  const features = createFeaturesStore({})
  const eventEmitter = new EventEmitter<EventEmitterValue>()
  const view = await act(async () =>
    renderWorkflowComponent(
      <NuqsTestingAdapter>
        <WorkflowEventProvider value={{ eventEmitter }}>
          <FeaturesContext value={features}>
            <WorkflowWithDefaultContext nodes={nodes} edges={[]}>
              <WorkflowMain nodes={nodes} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />
            </WorkflowWithDefaultContext>
          </FeaturesContext>
        </WorkflowEventProvider>
      </NuqsTestingAdapter>,
      {
        queryClient,
        initialStoreState: { isWorkflowDataLoaded: true, ...initialStoreState },
        injectWorkflowStoreSliceFn: createWorkflowSlice as InjectWorkflowStoreSliceFn,
      },
    ),
  )
  return { ...view, queryClient, features, eventEmitter }
}

it('shows synchronization status until the collaborative graph is ready', async () => {
  await renderMain()
  expect(screen.queryByText('workflow.common.syncingData')).not.toBeInTheDocument()
  await act(async () => {
    events.ready.forEach((handler) => handler(false))
  })
  expect(screen.getByText('workflow.common.syncingData')).toBeVisible()
  await act(async () => {
    events.ready.forEach((handler) => handler(true))
  })
  expect(screen.queryByText('workflow.common.syncingData')).not.toBeInTheDocument()
})

// These are incoming collaboration-service events, not callbacks captured from UI components.
function updateVars(syncWorkflowDraft = false) {
  return Promise.all(
    [...events.vars].map((handler) =>
      handler({
        type: 'vars_and_features_update',
        userId: 'peer',
        timestamp: 1,
        data: { syncWorkflowDraft },
      }),
    ),
  )
}
function updateWorkflow() {
  return Promise.all(
    [...events.workflow].map((handler) => handler({ appId: 'app-1', timestamp: 1 })),
  )
}
const modelSnapshot = (name: string) =>
  draft({
    features: { opening_statement: name },
    environment_variables: [
      {
        id: 'model',
        name: 'shared_model',
        value_type: 'llm',
        value: { provider: 'openai', name, mode: 'chat' },
        description: '',
      },
    ],
  })
const graphRequest = { generation: 2, token: 1, attempt: 0 }
function reloadGraph() {
  return Promise.all([...events.reload].map((handler) => handler(graphRequest)))
}

it('does not connect collaboration for a view-only app', async () => {
  await renderMain({ permission_keys: [AppACLPermission.ViewLayout] })
  expect(collaborationManager.connect).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'workflow.env.envPanelTitle' })).toBeDisabled()
})

it('applies remote features and variables, retains omitted slices, and normalizes secret masks', async () => {
  const { store, features } = await renderMain()
  api.fetchDraft.mockResolvedValueOnce(
    draft({
      features: { file_upload: { enabled: true } },
      conversation_variables: [
        {
          id: 'conversation-1',
          name: 'topic',
          value_type: ChatVarType.String,
          value: 'Research',
          description: '',
        },
      ],
      environment_variables: [
        {
          id: 'secret-1',
          name: 'TOKEN',
          value: '********************',
          value_type: 'secret',
          description: '',
        },
      ],
    }),
  )
  await act(async () => {
    await updateVars()
  })
  expect(features.getState().features.file?.enabled).toBe(true)
  expect(store.getState().conversationVariables).toMatchObject([
    { id: 'conversation-1', value: 'Research' },
  ])
  expect(store.getState().environmentVariables).toMatchObject([
    { id: 'secret-1', value: '[__HIDDEN__]' },
  ])
  expect(store.getState().envSecrets).toEqual({ 'secret-1': '********************' })
  api.fetchDraft.mockResolvedValueOnce(
    draft({ features: undefined, environment_variables: undefined, conversation_variables: [] }),
  )
  await act(async () => {
    await updateVars()
  })
  expect(store.getState().conversationVariables).toEqual([])
  expect(features.getState().features.file?.enabled).toBe(true)
  expect(store.getState().environmentVariables).toMatchObject([
    { id: 'secret-1', value: '[__HIDDEN__]' },
  ])
})

it('saves the trusted graph on a directed request and acknowledges the persisted revision', async () => {
  await renderMain()
  const acknowledge = vi.fn()
  act(() => {
    events.sync.forEach((handler) => handler({ requestId: 'save-1', acknowledge }))
  })
  await waitFor(() =>
    expect(acknowledge).toHaveBeenCalledWith({ success: true, hash: 'saved-hash', updatedAt: 2 }),
  )
  expect(api.saveDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      params: { app_id: 'app-1' },
      body: expect.objectContaining({
        graph: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'start' })] }),
      }),
    }),
    expect.anything(),
  )
  expect(collaborationManager.refreshGraphSynchronously).toHaveBeenCalled()
})

it('replaces the canvas from a workflow update and records its revision', async () => {
  const { store } = await renderMain()
  api.fetchDraft.mockResolvedValue(
    draft({
      hash: 'remote-hash',
      graph: {
        nodes: [
          createStartNode({ id: 'remote-start', data: { title: 'Remote entry', variables: [] } }),
        ],
        edges: [],
        viewport: { x: 3, y: 4, zoom: 1.2 },
      },
    }),
  )
  await act(async () => {
    await updateWorkflow()
  })
  // happy-dom does not measure ReactFlow nodes; verify content in the real renderer.
  expect(await screen.findByText('Remote entry')).toBeInTheDocument()
  expect(store.getState().syncWorkflowDraftHash).toBe('remote-hash')
})

it('saves newly applied features when a follower requests synchronization', async () => {
  const { store } = await renderMain()
  api.fetchDraft.mockResolvedValue(modelSnapshot('latest-model'))
  await act(async () => {
    await updateVars(true)
  })
  expect(store.getState().environmentVariables).toMatchObject([{ value: { name: 'latest-model' } }])
  expect(api.saveDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        features: expect.objectContaining({ opening_statement: 'latest-model' }),
      }),
    }),
    expect.anything(),
  )
})

it('ignores an older environment refresh that resolves after the latest update', async () => {
  const first = createDeferred<FetchWorkflowDraftResponse>()
  const second = createDeferred<FetchWorkflowDraftResponse>()
  api.fetchDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const { store } = await renderMain()
  const older = updateVars(true)
  const newer = updateVars()
  await act(async () => {
    second.resolve(modelSnapshot('latest-model'))
    await newer
  })
  expect(store.getState().environmentVariables).toMatchObject([{ value: { name: 'latest-model' } }])
  expect(api.saveDraft).toHaveBeenCalledOnce()
  await act(async () => {
    first.resolve(modelSnapshot('stale-model'))
    await older
  })
  expect(store.getState().environmentVariables).toMatchObject([{ value: { name: 'latest-model' } }])
  expect(api.saveDraft).toHaveBeenCalledOnce()
})

it.each(['before', 'after'] as const)(
  'recovers the latest successful snapshot when it resolves %s a newer refresh fails',
  async (order) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = createDeferred<FetchWorkflowDraftResponse>()
    const second = createDeferred<FetchWorkflowDraftResponse>()
    api.fetchDraft
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockRejectedValueOnce(new Error('Retry failed'))
    const { store } = await renderMain()
    const older = updateVars(true)
    const newer = updateVars()
    if (order === 'before') {
      await act(async () => {
        first.resolve(modelSnapshot('recovered-model'))
        await older
      })
      expect(store.getState().environmentVariables).toEqual([])
    }
    await act(async () => {
      second.reject(new Error('Latest refresh failed'))
      await newer
    })
    if (order === 'after')
      await act(async () => {
        first.resolve(modelSnapshot('recovered-model'))
        await older
      })
    expect(store.getState().environmentVariables).toMatchObject([
      { value: { name: 'recovered-model' } },
    ])
    expect(api.saveDraft).toHaveBeenCalledOnce()
  },
)

it('applies an older slow retry after newer refresh attempts fail', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { store } = await renderMain()
  await act(async () => {
    await updateVars()
  })
  const retry = createDeferred<FetchWorkflowDraftResponse>()
  api.fetchDraft
    .mockReset()
    .mockRejectedValueOnce(new Error('Older refresh failed'))
    .mockReturnValueOnce(retry.promise)
    .mockRejectedValueOnce(new Error('Newer refresh failed'))
    .mockRejectedValueOnce(new Error('Newer retry failed'))
  const older = updateVars(true)
  await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledTimes(2))
  await act(async () => {
    await updateVars()
  })
  expect(store.getState().environmentVariables).toEqual([])
  await act(async () => {
    retry.resolve(modelSnapshot('slow-retry'))
    await older
  })
  expect(store.getState().environmentVariables).toMatchObject([{ value: { name: 'slow-retry' } }])
  expect(api.saveDraft).toHaveBeenCalledOnce()
})

it('retries an outstanding follower save on the next update after persistence fails', async () => {
  await renderMain()
  api.fetchDraft.mockResolvedValue(modelSnapshot('latest-model'))
  api.saveDraft.mockRejectedValueOnce(new Error('Save failed'))
  await act(async () => {
    await updateVars(true)
  })
  expect(api.saveDraft).toHaveBeenCalledOnce()
  await act(async () => {
    await updateVars()
  })
  expect(api.saveDraft).toHaveBeenCalledTimes(2)
})

it('reloads the authoritative HTTP graph before replacing the reconnected document', async () => {
  await renderMain()
  const response = createDeferred<FetchWorkflowDraftResponse>()
  api.fetchDraft.mockReturnValueOnce(response.promise)
  let reload: ReturnType<typeof reloadGraph>
  act(() => {
    reload = reloadGraph()
  })
  expect(collaborationManager.replaceGraphFromReactFlow).not.toHaveBeenCalled()
  await act(async () => {
    response.resolve(
      draft({
        graph: {
          nodes: [createStartNode({ data: { title: 'Reloaded entry', variables: [] } })],
          edges: [],
        },
      }),
    )
    await reload
  })
  expect(await screen.findByText('Reloaded entry')).toBeInTheDocument()
  expect(collaborationManager.replaceGraphFromReactFlow).toHaveBeenCalledExactlyOnceWith(
    graphRequest,
  )
})

it('rejects a directed save while the collaborative graph is untrusted', async () => {
  vi.mocked(collaborationManager.canPersistLocalGraph).mockReturnValue(false)
  await renderMain()
  const acknowledge = vi.fn()
  act(() => {
    events.sync.forEach((handler) => handler({ requestId: 'untrusted', acknowledge }))
  })
  expect(acknowledge).toHaveBeenCalledWith({
    success: false,
    error: 'Collaborative graph is not ready to save.',
  })
  expect(collaborationManager.refreshGraphSynchronously).not.toHaveBeenCalled()
  expect(api.saveDraft).not.toHaveBeenCalled()
})

it('retries a graph reload after a transient HTTP failure', async () => {
  await renderMain()
  api.fetchDraft.mockRejectedValueOnce(new Error('Fetch failed'))
  vi.useFakeTimers()
  try {
    await act(async () => {
      await reloadGraph()
    })
    expect(collaborationManager.retryGraphReload).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(collaborationManager.retryGraphReload).toHaveBeenCalledExactlyOnceWith(graphRequest)
  } finally {
    vi.useRealTimers()
  }
})

it('restores a local start placeholder when a remote workflow graph is empty', async () => {
  const { store } = await renderMain()
  api.fetchDraft.mockResolvedValue(draft({ graph: { nodes: [], edges: [] } }))
  await act(async () => {
    await updateWorkflow()
  })
  await waitFor(() =>
    expect(store.getState().nodes).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ type: BlockEnum.StartPlaceholder }),
      }),
    ]),
  )
  expect(await screen.findByText('workflow.blocks.start-placeholder')).toBeInTheDocument()
})

it('renders the collaborator roster and remote cursor, then disconnects on unmount', async () => {
  const { unmount } = await renderMain()
  await waitFor(() => expect(collaborationManager.connect).toHaveBeenCalled())
  act(() => {
    events.users.forEach((handler) =>
      handler([
        { user_id: 'current-user', username: 'My cursor', avatar: '', sid: 'self' },
        { user_id: 'peer', username: 'Alice', avatar: '', sid: 'other' },
      ]),
    )
    events.cursors.forEach((handler) =>
      handler({
        'current-user': { x: 1, y: 2, userId: 'current-user', timestamp: 1 },
        peer: { x: 20, y: 30, userId: 'peer', timestamp: 2 },
      }),
    )
  })
  expect(await screen.findByRole('button', { name: 'Alice' })).toBeVisible()
  expect(screen.getByText('Alice')).toBeInTheDocument()
  expect(screen.queryByText('My cursor')).not.toBeInTheDocument()
  unmount()
  expect(collaborationManager.disconnect).toHaveBeenCalledWith('connection-1')
})

it('dismisses onboarding without creating a start node', async () => {
  const user = userEvent.setup()
  const { store } = await renderMain({
    collaboration: false,
    nodes: [],
    initialStoreState: { showOnboarding: true },
  })
  const dialog = await screen.findByRole('dialog', { name: 'workflow.onboarding.title' })
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'workflow.onboarding.title' }),
    ).not.toBeInTheDocument(),
  )
  expect(store.getState()).toMatchObject({
    showOnboarding: false,
    hasShownOnboarding: true,
    shouldAutoOpenStartNodeSelector: false,
  })
  expect(api.saveDraft).not.toHaveBeenCalled()
})

it('keeps onboarding and import actions unavailable to a view-only user', async () => {
  await renderMain({
    collaboration: false,
    permission_keys: [AppACLPermission.ViewLayout],
    initialStoreState: { showOnboarding: true, showImportDSLModal: true },
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.saveDraft).not.toHaveBeenCalled()
})

it('creates and saves the user-input entry selected in onboarding', async () => {
  const user = userEvent.setup()
  await renderMain({ collaboration: false, nodes: [], initialStoreState: { showOnboarding: true } })
  const dialog = await screen.findByRole('dialog', { name: 'workflow.onboarding.title' })
  await user.click(
    within(dialog).getByRole('button', { name: /workflow.onboarding.userInputFull/ }),
  )
  await waitFor(() => expect(api.saveDraft).toHaveBeenCalled())
  expect(api.saveDraft.mock.lastCall?.[0].body.graph).toMatchObject({
    nodes: [{ data: { type: BlockEnum.Start, variables: [] } }],
    edges: [],
  })
  expect(
    screen.queryByRole('dialog', { name: 'workflow.onboarding.title' }),
  ).not.toBeInTheDocument()
  expect(screen.getByText('workflow.blocks.start')).toBeInTheDocument()
  expect(api.webhook).not.toHaveBeenCalled()
})

it('generates webhook URLs only after saving the trigger chosen in onboarding', async () => {
  const user = userEvent.setup()
  const save = createDeferred<Awaited<ReturnType<typeof api.saveDraft>>>()
  api.saveDraft.mockReturnValueOnce(save.promise)
  await renderMain({ collaboration: false, nodes: [], initialStoreState: { showOnboarding: true } })
  const dialog = await screen.findByRole('dialog', { name: 'workflow.onboarding.title' })
  await user.click(
    within(dialog).getByRole('button', {
      name: /workflow.onboarding.trigger workflow.onboarding.triggerDescription/,
    }),
  )
  await user.click(await screen.findByRole('button', { name: /workflow.blocks.trigger-webhook/ }))
  await waitFor(() => expect(api.saveDraft).toHaveBeenCalled())
  expect(api.saveDraft.mock.lastCall?.[0].body.graph).toMatchObject({
    nodes: [{ data: { type: BlockEnum.TriggerWebhook } }],
    edges: [],
  })
  expect(api.webhook).not.toHaveBeenCalled()
  await act(async () => save.resolve({ result: 'success', hash: 'saved-hash', updated_at: 2 }))
  await waitFor(() => expect(api.webhook).toHaveBeenCalled())
})

it('backs up the current draft from the import dialog and closes it', async () => {
  const user = userEvent.setup()
  const downloads = captureDownloads()
  await renderMain({ collaboration: false, initialStoreState: { showImportDSLModal: true } })
  const dialog = await screen.findByRole('dialog', { name: 'app.importApp' })
  await user.click(
    within(dialog).getByRole('button', { name: /workflow.common.backupCurrentDraft/ }),
  )
  await waitFor(() => expect(downloads).toHaveLength(1))
  expect(await downloads[0]!.blob.text()).toBe('kind: app')
  expect(downloads[0]!.filename).toBe('Workflow app.yml')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('exports secrets only after confirmation through the real export dialog', async () => {
  const user = userEvent.setup()
  const downloads = captureDownloads()
  const { eventEmitter } = await renderMain({ collaboration: false })
  act(() =>
    eventEmitter.emit({
      type: 'UNRELATED_EVENT',
      payload: { data: [{ name: 'IGNORED', value: 'secret' }] },
    }),
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  act(() =>
    eventEmitter.emit({
      type: DSL_EXPORT_CHECK,
      payload: { data: [{ name: 'API_KEY', value: 'masked' }] },
    }),
  )
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('API_KEY')
  expect(api.exportDSL).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('checkbox'))
  await user.click(within(dialog).getByRole('button', { name: 'app.exportSecret.title' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(api.exportDSL).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-1' },
    query: { include_secret: true },
  })
  expect(downloads).toHaveLength(1)
})

it('creates a plugin trigger from the real provider event and saves its schema and parameters', async () => {
  const user = userEvent.setup()
  const trigger: TriggerWithProvider = {
    id: 'plugin-1',
    name: 'event-provider',
    author: 'Dify',
    label: { en_US: 'Event provider', zh_Hans: '事件提供商' },
    description: { en_US: 'Events', zh_Hans: '事件' },
    icon: '',
    type: CollectionType.trigger,
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: [],
    plugin_id: 'plugin-1',
    plugin_unique_identifier: 'plugin-1:1.0',
    meta: { version: '1.0' },
    supported_creation_methods: [],
    subscription_schema: [],
    events: [
      {
        name: 'created',
        author: 'Dify',
        label: { en_US: 'Item created', zh_Hans: '项目已创建' },
        description: { en_US: 'When an item is created', zh_Hans: '创建项目时' },
        parameters: [
          {
            name: 'source',
            label: { en_US: 'Source', zh_Hans: '来源' },
            human_description: { en_US: 'Event source', zh_Hans: '事件来源' },
            type: 'string',
            form: 'form',
            llm_description: '',
            required: false,
            multiple: false,
            default: '',
          },
        ],
        labels: [],
        output_schema: { type: 'object', properties: { item_id: { type: 'string' } } },
      },
    ],
  }
  await renderMain({
    collaboration: false,
    nodes: [],
    initialStoreState: { showOnboarding: true },
    triggers: [trigger],
  })
  const dialog = await screen.findByRole('dialog', { name: 'workflow.onboarding.title' })
  await user.click(
    within(dialog).getByRole('button', {
      name: /workflow.onboarding.trigger workflow.onboarding.triggerDescription/,
    }),
  )
  await user.click(await screen.findByRole('button', { name: /Event provider/ }))
  await user.click(await screen.findByRole('button', { name: 'Item created' }))
  await waitFor(() => expect(api.saveDraft).toHaveBeenCalled())
  expect(api.saveDraft.mock.lastCall?.[0].body.graph).toMatchObject({
    nodes: [
      {
        data: {
          type: BlockEnum.TriggerPlugin,
          title: 'Item created',
          desc: 'When an item is created',
          provider_id: 'event-provider',
          provider_type: CollectionType.trigger,
          provider_name: 'event-provider',
          plugin_id: 'plugin-1',
          plugin_unique_identifier: 'plugin-1:1.0',
          event_name: 'created',
          parameters_schema: trigger.events[0]!.parameters,
          config: { source: '' },
          output_schema: trigger.events[0]!.output_schema,
        },
      },
    ],
    edges: [],
  })
  expect(
    screen.queryByRole('dialog', { name: 'workflow.onboarding.title' }),
  ).not.toBeInTheDocument()
})

it('imports a DSL file and replaces the graph through the real update event', async () => {
  const user = userEvent.setup()
  vi.mocked(collaborationManager.isConnected).mockReturnValue(false)
  api.fetchDraft.mockResolvedValue(
    draft({
      graph: {
        nodes: [createStartNode({ data: { title: 'Imported entry', variables: [] } })],
        edges: [],
      },
      hash: 'imported-hash',
    }),
  )
  const { store } = await renderMain({
    collaboration: false,
    initialStoreState: { showImportDSLModal: true },
  })
  const dialog = await screen.findByRole('dialog', { name: 'app.importApp' })
  // The native file picker is hidden behind the uploader's Browse action.
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!
  const yaml = 'workflow: { graph: { nodes: [] } }'
  await user.upload(input, new File([yaml], 'workflow.yml', { type: 'text/yaml' }))
  await user.click(
    within(dialog).getByRole('button', { name: 'workflow.common.overwriteAndImport' }),
  )
  expect(await screen.findByText('Imported entry')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(store.getState().syncWorkflowDraftHash).toBe('imported-hash')
  expect(api.importDSL).toHaveBeenCalledExactlyOnceWith({
    body: { mode: 'yaml-content', yaml_content: yaml, app_id: 'app-1' },
  })
})
