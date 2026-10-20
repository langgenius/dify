import type { ReactNode } from 'react'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import type { EventEmitterValue } from '@/context/event-emitter'
import type {
  FetchWorkflowDraftResponse,
  WorkflowFinishedResponse,
  WorkflowPausedResponse,
  WorkflowStartedResponse,
} from '@/types/workflow'
import { ORPCError } from '@orpc/client'
import { act, renderHook, waitFor } from '@testing-library/react'
import ReactFlow, { ReactFlowProvider, useReactFlow } from 'reactflow'
import { assert } from 'vite-plus/test'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { createNode, createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { createTestWorkflowStore } from '@/app/components/workflow/__tests__/workflow-test-env'
import { CUSTOM_NODE, WORKFLOW_DATA_UPDATE } from '@/app/components/workflow/constants'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { TriggerType } from '@/app/components/workflow/header/test-run-menu'
import { HooksStoreContextProvider } from '@/app/components/workflow/hooks-store/provider'
import CustomNode from '@/app/components/workflow/nodes'
import {
  BlockEnum,
  NodeRunningStatus,
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedAppDetail,
  seedAppDslVersion,
} from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { useWorkflowRun } from '../use-workflow-run'

const api = vi.hoisted(() => ({
  sync: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.post>(),
  ssePost: vi.fn<typeof import('@/service/base').ssePost>(),
  sseGet: vi.fn<typeof import('@/service/base').sseGet>(),
  post: vi.fn<typeof import('@/service/base').post>(),
  stop: vi.fn<typeof import('@/service/workflow').stopWorkflowRun>(),
  inspect: vi.fn<typeof import('@/service/workflow').fetchAllInspectVars>(),
  track: vi.fn<typeof import('@/app/components/base/amplitude').trackEvent>(),
  playAudio: vi.fn(),
  getAudioPlayer: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.systemVariables.get': async () => ({ items: [] }),
      'apps.byAppId.workflows.draft.conversationVariables.get': async () => ({ items: [] }),
      'apps.byAppId.workflows.draft.environmentVariables.get': async () => ({ items: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.post': api.sync,
    }),
  }
})
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost: api.ssePost,
  sseGet: api.sseGet,
  post: api.post,
}))
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  stopWorkflowRun: api.stop,
  fetchAllInspectVars: api.inspect,
}))
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: api.track }))
vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: () => ({ getAudioPlayer: api.getAudioPlayer, resetMsgId: vi.fn() }),
  },
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  usePathname: () => '/app/app-1/workflow',
}))

const environment: EnvironmentVariable = {
  id: 'env-1',
  name: 'region',
  value: 'ap-southeast-1',
  value_type: 'string',
  description: '',
}
const started: WorkflowStartedResponse = {
  task_id: 'task-1',
  workflow_run_id: 'run-1',
  event: 'workflow_started',
  data: { id: 'run-1', workflow_id: 'workflow-1', created_at: 1700000000 },
}
const finished: WorkflowFinishedResponse = {
  ...started,
  event: 'workflow_finished',
  data: {
    ...started.data,
    status: WorkflowRunningStatus.Succeeded,
    outputs: { answer: 'Result' },
    error: '',
    elapsed_time: 1,
    total_tokens: 10,
    total_steps: 1,
    created_by: { id: 'user-1', name: 'User', email: 'user@example.com' },
    finished_at: 1700000001,
  },
}

const streamResponse = (events: object[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
const paused: WorkflowPausedResponse = {
  ...started,
  event: 'workflow_paused',
  data: { outputs: {}, paused_nodes: ['node-1'], reasons: [], workflow_run_id: 'run-1' },
}

const nodeTypes = { [CUSTOM_NODE]: CustomNode }

async function setup() {
  const node = createNode({
    id: 'node-1',
    width: 240,
    height: 100,
    data: { type: BlockEnum.Start, title: 'Start', variables: [], selected: true },
  })
  const queryClient = createConsoleQueryClient()
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    queryClient,
    systemFeatures: { enable_collaboration_mode: false },
  })
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode: 'workflow' }))
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  seedAppDslVersion(queryClient)
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  for (const endpoint of [
    consoleQuery.apps.byAppId.workflows.draft.environmentVariables.get,
    consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get,
  ])
    queryClient.setQueryData(endpoint.queryKey({ input: { params: { app_id: 'app-1' } } }), {
      items: [],
    })
  const store = createTestWorkflowStore({
    isWorkflowDataLoaded: true,
    environmentVariables: [environment],
  })
  const features = createFeaturesStore()
  const canvasUpdate = vi.fn<(message: EventEmitterValue) => void>()
  function Providers({ children }: { children: ReactNode }) {
    return (
      <ConsoleProvider>
        <EditorResourceScope resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}>
          {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider API. */}
          <WorkflowContext.Provider value={store}>
            <FeaturesContext value={features}>
              <EventEmitterContextProvider>
                <ReactFlowProvider>
                  <HooksStoreContextProvider>
                    <div id="workflow-container" style={{ width: 960, height: 540 }}>
                      <ReactFlow defaultNodes={[node]} defaultEdges={[]} nodeTypes={nodeTypes} />
                      {children}
                    </div>
                  </HooksStoreContextProvider>
                </ReactFlowProvider>
              </EventEmitterContextProvider>
            </FeaturesContext>
          </WorkflowContext.Provider>
        </EditorResourceScope>
      </ConsoleProvider>
    )
  }
  const view = await act(async () =>
    renderHook(
      () => {
        const flow = useReactFlow()
        const { eventEmitter } = useEventEmitterContextContext()
        eventEmitter?.useSubscription(canvasUpdate)
        return { run: useWorkflowRun(), flow }
      },
      { wrapper: Providers },
    ),
  )
  await waitFor(() => expect(view.result.current.flow.getNodes()).toHaveLength(1))
  return { ...view, store, features, canvasUpdate, node }
}

beforeEach(() => {
  // Trigger polling writes these window handles; restore them after each run.
  for (const key of [
    '__webhookDebugAbortController',
    '__pluginDebugAbortController',
    '__scheduleDebugAbortController',
    '__allTriggersDebugAbortController',
  ])
    vi.stubGlobal(key, undefined)
  api.sync
    .mockReset()
    .mockResolvedValue({ result: 'success', hash: 'saved', updated_at: 1700000000 })
  api.ssePost.mockReset()
  api.sseGet.mockReset()
  api.post.mockReset()
  api.stop.mockReset().mockResolvedValue({ result: 'success' })
  api.inspect.mockReset().mockResolvedValue([])
  api.track.mockReset()
  api.playAudio.mockReset()
  api.getAudioPlayer.mockReset().mockReturnValue({ playAudioWithAudio: api.playAudio })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  act(() => toast.dismiss())
})

it('saves the graph before running and applies streamed results to the real workflow state', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof api.sync>>>()
  api.sync.mockReturnValueOnce(pending.promise)
  const { result, store } = await setup()
  let run: Promise<void>
  act(() => {
    run = result.current.run.handleRun({ inputs: { query: 'hello' } })
  })
  await waitFor(() => expect(api.sync).toHaveBeenCalledOnce())
  expect(api.ssePost).not.toHaveBeenCalled()
  expect(api.sync).toHaveBeenCalledWith(
    {
      params: { app_id: 'app-1' },
      body: expect.objectContaining({
        graph: expect.objectContaining({
          nodes: [
            expect.objectContaining({
              id: 'node-1',
              data: expect.objectContaining({ selected: false }),
            }),
          ],
        }),
      }),
    },
    { context: { silent: true } },
  )
  await act(async () => {
    pending.resolve({ result: 'success', hash: 'saved', updated_at: 1700000000 })
    await run
  })
  expect(api.ssePost).toHaveBeenCalledExactlyOnceWith(
    '/apps/app-1/workflows/draft/run',
    { body: { inputs: { query: 'hello' } } },
    expect.any(Object),
  )
  const callbacks = api.ssePost.mock.lastCall?.[2]
  assert(callbacks?.onWorkflowStarted && callbacks.onWorkflowFinished)
  act(() => callbacks.onWorkflowStarted?.(started))
  expect(store.getState().workflowRunningData).toMatchObject({
    task_id: 'task-1',
    result: { status: WorkflowRunningStatus.Running },
  })
  await act(async () => callbacks.onWorkflowFinished?.(finished))
  expect(store.getState().workflowRunningData).toMatchObject({
    result: { status: WorkflowRunningStatus.Succeeded, outputs: { answer: 'Result' } },
    resultText: 'Result',
  })
  expect(api.inspect).toHaveBeenCalledWith({ kind: 'app', appId: 'app-1', mode: 'workflow' })
})

it('marks the active node failed and reports the current trace in bounded analytics chunks', async () => {
  const { result, store } = await setup()
  await act(async () => result.current.run.handleRun({ inputs: {} }))
  const callbacks = api.ssePost.mock.lastCall?.[2]
  assert(callbacks?.onWorkflowStarted && callbacks.onNodeStarted && callbacks.onError)
  const trace = createNodeTracing({ node_id: 'node-1', inputs: { query: '🙂'.repeat(1100) } })
  act(() => {
    callbacks.onWorkflowStarted?.(started)
    callbacks.onNodeStarted?.({ ...started, event: 'node_started', data: trace })
    callbacks.onError?.('Server Error')
  })
  const data = store.getState().workflowRunningData
  expect(data).toMatchObject({
    result: { status: WorkflowRunningStatus.Failed, error: 'Server Error' },
    tracing: [expect.objectContaining({ status: NodeRunningStatus.Failed })],
  })
  expect(result.current.flow.getNode('node-1')?.data._runningStatus).toBe(NodeRunningStatus.Failed)
  const event = api.track.mock.lastCall?.[1]
  expect(event).toMatchObject({
    workflow_id: 'app-1',
    reason: 'Server Error',
    data: { workflow_status: WorkflowRunningStatus.Failed, workflow_tracing_count: 1 },
  })
  const eventData = event?.data
  assert(eventData && typeof eventData === 'object' && 'workflow_data_chunks' in eventData)
  const chunks = eventData.workflow_data_chunks
  assert(
    Array.isArray(chunks) && chunks.every((chunk): chunk is string => typeof chunk === 'string'),
  )
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks.every((chunk) => Array.from(chunk).length <= 900)).toBe(true)
  expect(chunks.join('')).toBe(JSON.stringify(data))
})

it.each([
  {
    mode: TriggerType.Schedule,
    options: { scheduleNodeId: 'schedule-1' },
    body: { node_id: 'schedule-1' },
    url: 'run',
  },
  {
    mode: TriggerType.Webhook,
    options: { webhookNodeId: 'webhook-1' },
    body: { node_id: 'webhook-1' },
    url: 'run',
  },
  {
    mode: TriggerType.Plugin,
    options: { pluginNodeId: 'plugin-1' },
    body: { node_id: 'plugin-1' },
    url: 'run',
  },
  {
    mode: TriggerType.All,
    options: { allNodeIds: ['trigger-1', 'trigger-2'] },
    body: { node_ids: ['trigger-1', 'trigger-2'] },
    url: 'run-all',
  },
])(
  'listens for $mode triggers and aborts the pending request when stopped',
  async ({ mode, options, body, url }) => {
    const pending = createDeferred<Response>()
    api.post.mockReturnValueOnce(pending.promise)
    const { result, store } = await setup()
    let run: Promise<void>
    act(() => {
      run = result.current.run.handleRun({}, undefined, { mode, ...options })
    })
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce())
    expect(api.post).toHaveBeenCalledWith(
      `/apps/app-1/workflows/draft/trigger/${url}`,
      expect.objectContaining({ body, signal: expect.any(AbortSignal) }),
      { needAllResponseContent: true },
    )
    expect(store.getState().isListening).toBe(true)
    const request = api.post.mock.lastCall?.[1]
    assert(request && 'signal' in request && request.signal instanceof AbortSignal)
    const signal = request.signal
    act(() => result.current.run.handleStopRun(''))
    expect(signal.aborted).toBe(true)
    expect(store.getState()).toMatchObject({
      isListening: false,
      workflowRunningData: { result: { status: WorkflowRunningStatus.Stopped } },
    })
    await act(async () => {
      pending.resolve(new Response())
      await run
    })
  },
)

it('stops an identified task through the stop endpoint', async () => {
  const { result, store } = await setup()
  await act(async () => result.current.run.handleRun({ inputs: {} }))
  const callbacks = api.ssePost.mock.lastCall?.[2]
  assert(callbacks?.onWorkflowStarted)
  act(() => callbacks.onWorkflowStarted?.(started))
  act(() => result.current.run.handleStopRun('task-1'))
  expect(api.stop).toHaveBeenCalledExactlyOnceWith('/apps/app-1/workflow-runs/tasks/task-1/stop')
  expect(store.getState().workflowRunningData?.result.status).toBe(WorkflowRunningStatus.Stopped)
})

it('keeps the first draft backup while inspecting another graph and restores its canvas and environment', async () => {
  const { result, store, features, canvasUpdate, node } = await setup()
  const originalFeatures = features.getState().features
  await act(async () => result.current.run.handleBackupDraft())
  await waitFor(() => expect(api.sync).toHaveBeenCalledOnce())
  await act(async () => {
    result.current.flow.setNodes([createNode({ id: 'history-node' })])
    store.getState().setEnvironmentVariables([])
    features.getState().setFeatures({ opening: { enabled: true, opening_statement: 'Published' } })
  })
  await act(async () => result.current.run.handleBackupDraft())
  expect(api.sync).toHaveBeenCalledOnce()
  act(() => result.current.run.handleLoadBackupDraft())
  expect(canvasUpdate).toHaveBeenCalledWith({
    type: WORKFLOW_DATA_UPDATE,
    payload: expect.objectContaining({ nodes: [expect.objectContaining({ id: node.id })] }),
  })
  expect(store.getState().environmentVariables).toEqual([environment])
  expect(features.getState().features).toEqual(originalFeatures)
})

it.each([
  { params: { token: 'public-token' }, url: '/text-to-audio', isPublic: true },
  { params: { appId: 'app-2' }, url: '/apps/app-2/text-to-audio', isPublic: false },
])(
  'creates the $url audio player only when streamed audio arrives',
  async ({ params, url, isPublic }) => {
    const pending = createDeferred<Response>()
    api.post.mockReturnValueOnce(pending.promise)
    const { result } = await setup()
    let run: Promise<void>
    act(() => {
      run = result.current.run.handleRun(params, undefined, {
        mode: TriggerType.Webhook,
        webhookNodeId: 'node-1',
      })
    })
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce())
    expect(api.getAudioPlayer).not.toHaveBeenCalled()
    const stream = [
      { ...started },
      { event: 'tts_message', message_id: 'message-1', audio: 'YXVkaW8=', audio_type: 'audio/wav' },
      { event: 'tts_message', message_id: 'message-1', audio: 'bW9yZQ==', audio_type: 'audio/wav' },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('')
    await act(async () => {
      pending.resolve(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
      await run
    })
    await waitFor(() => expect(api.playAudio).toHaveBeenCalledTimes(2))
    expect(api.getAudioPlayer).toHaveBeenCalledExactlyOnceWith(
      url,
      isPublic,
      expect.any(String),
      'none',
      'none',
      expect.any(Function),
    )
    expect(api.playAudio).toHaveBeenLastCalledWith('bW9yZQ==', true, 'audio/wav')
  },
)

it('aborts the run transport when stopped before a task identifier arrives', async () => {
  const { result, store } = await setup()
  await act(async () => result.current.run.handleRun({ inputs: {} }))
  const callbacks = api.ssePost.mock.lastCall?.[2]
  assert(callbacks?.getAbortController)
  const controller = new AbortController()
  callbacks.getAbortController(controller)
  act(() => result.current.run.handleStopRun(''))
  expect(controller.signal.aborted).toBe(true)
  expect(api.stop).not.toHaveBeenCalled()
  expect(store.getState().workflowRunningData?.result.status).toBe(WorkflowRunningStatus.Stopped)
})

it.each([
  { name: 'published variables', variables: [{ ...environment, value: 'eu-west-1' }] },
  { name: 'no published variables', variables: undefined },
])(
  'restores a published graph and replaces the draft environment with $name',
  async ({ variables }) => {
    const { result, store, features, canvasUpdate } = await setup()
    const published: FetchWorkflowDraftResponse = {
      id: 'published-1',
      version: '2026-10-18T00:00:00Z',
      hash: 'published-hash',
      created_at: 1700000000,
      updated_at: 1700000001,
      created_by: finished.data.created_by,
      updated_by: finished.data.created_by,
      marked_name: 'Release',
      marked_comment: '',
      tool_published: false,
      graph: {
        nodes: [
          createNode({
            id: 'published-node',
            selected: true,
            data: { type: BlockEnum.Start, title: 'Published', variables: [], selected: true },
          }),
        ],
        edges: [],
        viewport: { x: 10, y: 20, zoom: 0.8 },
      },
      features: {
        opening_statement: 'Welcome',
        suggested_questions: ['Help'],
        suggested_questions_after_answer: { enabled: true },
        text_to_speech: { enabled: false },
        speech_to_text: { enabled: false },
        retriever_resource: { enabled: true },
        sensitive_word_avoidance: { enabled: false },
        file_upload: features.getState().features.file,
      },
      environment_variables: variables,
    }
    act(() => result.current.run.handleRestoreFromPublishedWorkflow(published))
    expect(canvasUpdate).toHaveBeenCalledWith({
      type: WORKFLOW_DATA_UPDATE,
      payload: expect.objectContaining({
        nodes: [
          expect.objectContaining({
            id: 'published-node',
            selected: false,
            data: expect.objectContaining({ selected: false }),
          }),
        ],
        edges: [],
        viewport: { x: 10, y: 20, zoom: 0.8 },
      }),
    })
    expect(store.getState().environmentVariables).toEqual(variables ?? [])
    expect(features.getState().features).toMatchObject({
      opening: { enabled: true, opening_statement: 'Welcome', suggested_questions: ['Help'] },
      suggested: { enabled: true },
    })
  },
)

it.each([false, true])(
  'resumes a paused run once and applies completion (trigger: %s)',
  async (trigger) => {
    const { result, store } = await setup()
    const onFinished = vi.fn()
    if (trigger) api.post.mockResolvedValueOnce(streamResponse([started, paused, paused]))
    await act(async () =>
      result.current.run.handleRun(
        { inputs: {} },
        { onWorkflowFinished: onFinished },
        trigger ? { mode: TriggerType.Webhook, webhookNodeId: 'node-1' } : undefined,
      ),
    )
    if (!trigger) {
      const callbacks = api.ssePost.mock.lastCall?.[2]
      assert(callbacks?.onWorkflowStarted && callbacks.onWorkflowPaused)
      act(() => {
        callbacks.onWorkflowStarted?.(started)
        callbacks.onWorkflowPaused?.(paused)
        callbacks.onWorkflowPaused?.(paused)
      })
    }
    await waitFor(() => expect(api.sseGet).toHaveBeenCalledOnce())
    expect(api.sseGet).toHaveBeenCalledWith(
      '/workflow/run-1/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.any(Object),
    )
    expect(store.getState().workflowRunningData?.result.status).toBe(WorkflowRunningStatus.Paused)
    const resumed = api.sseGet.mock.lastCall?.[2]
    assert(resumed?.onWorkflowStarted && resumed.onWorkflowFinished)
    act(() => resumed.onWorkflowStarted?.(started))
    expect(store.getState().workflowRunningData?.result.status).toBe(WorkflowRunningStatus.Running)
    await act(async () => resumed.onWorkflowFinished?.(finished))
    expect(store.getState().workflowRunningData).toMatchObject({
      task_id: 'task-1',
      result: { status: WorkflowRunningStatus.Succeeded },
      resultText: 'Result',
    })
    expect(onFinished).toHaveBeenCalledExactlyOnceWith(finished)
  },
)

it('honors the trigger retry interval before consuming the eventual run stream', async () => {
  const { result, store } = await setup()
  api.post
    .mockResolvedValueOnce(Response.json({ status: 'waiting', retry_in: 2000 }))
    .mockResolvedValueOnce(streamResponse([started, finished]))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let run: Promise<void>
  await act(async () => {
    run = result.current.run.handleRun({}, undefined, {
      mode: TriggerType.Schedule,
      scheduleNodeId: 'node-1',
    })
  })
  expect(api.post).toHaveBeenCalledOnce()
  expect(store.getState().isListening).toBe(true)
  await act(async () => vi.advanceTimersByTimeAsync(1999))
  expect(api.post).toHaveBeenCalledOnce()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
    await run
  })
  expect(api.post).toHaveBeenCalledTimes(2)
  expect(store.getState()).toMatchObject({
    isListening: false,
    workflowRunningData: { result: { status: WorkflowRunningStatus.Succeeded } },
  })
})

it.each([
  { failure: 'server', message: 'Trigger unavailable' },
  { failure: 'network', message: 'Network failed' },
])(
  'leaves listening mode when a trigger request fails at the $failure boundary',
  async ({ failure, message }) => {
    const { result, store } = await setup()
    if (failure === 'server')
      api.post.mockResolvedValueOnce(Response.json({ status: 'failed', message }))
    else api.post.mockRejectedValueOnce(new Error(message))
    await act(async () =>
      result.current.run.handleRun({}, undefined, {
        mode: TriggerType.Webhook,
        webhookNodeId: 'node-1',
      }),
    )
    expect(store.getState()).toMatchObject({
      isListening: false,
      workflowRunningData: { result: { status: WorkflowRunningStatus.Failed, error: message } },
    })
  },
)

it('does not save or start a run while the draft has an unresolved conflict', async () => {
  const { result, store } = await setup()
  act(() => store.getState().setWorkflowDraftConflict(true))
  await act(async () => {
    await result.current.run.handleRun({ inputs: {} })
  })
  expect(api.sync).not.toHaveBeenCalled()
  expect(api.ssePost).not.toHaveBeenCalled()
  expect(store.getState().workflowRunningData).toBeUndefined()
})

it.each([
  TriggerType.UserInput,
  TriggerType.Schedule,
  TriggerType.Webhook,
  TriggerType.Plugin,
  TriggerType.All,
])('does not dispatch a %s run when saving discovers a conflict', async (mode) => {
  const { result, store } = await setup()
  api.sync.mockRejectedValueOnce(
    new ORPCError('draft_workflow_not_sync', {
      defined: true,
      message: 'Workflow not synced.',
      status: 409,
    }),
  )
  await act(async () => {
    await result.current.run.handleRun({}, undefined, {
      mode,
      scheduleNodeId: 'schedule',
      webhookNodeId: 'webhook',
      pluginNodeId: 'plugin',
      allNodeIds: ['schedule', 'webhook', 'plugin'],
    })
  })
  expect(store.getState().hasWorkflowDraftConflict).toBe(true)
  expect(api.ssePost).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
  expect(store.getState().workflowRunningData).toBeUndefined()
  expect(store.getState().isListening).toBe(false)
})
