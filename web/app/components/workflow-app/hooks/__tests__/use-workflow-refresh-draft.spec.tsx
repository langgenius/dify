import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactFlowInstance } from 'reactflow'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRef, useImperativeHandle } from 'react'
import { useReactFlow } from 'reactflow'
import WorkflowWithDefaultContext, { Workflow } from '@/app/components/workflow'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { useWorkflowRefreshDraft } from '../use-workflow-refresh-draft'

const { fetchDraft } = vi.hoisted(() => ({
  fetchDraft: vi.fn<(url: string) => Promise<FetchWorkflowDraftResponse>>(),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/app-1/workflow',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchWorkflowDraft: fetchDraft,
  fetchAllInspectVars: async () => [],
}))

const localNodes = [
  createStartNode({
    id: 'local-start',
    width: 240,
    height: 100,
    data: { title: 'Local start', variables: [] },
  }),
  createNode({
    id: 'local-code',
    width: 240,
    height: 100,
    position: { x: 320, y: 0 },
    data: { type: BlockEnum.Code, title: 'Local code' },
  }),
]
const localEdges = [createEdge({ id: 'local-edge', source: 'local-start', target: 'local-code' })]
const localViewport = { x: 80, y: 60, zoom: 0.8 }

const savedNodes = [
  createStartNode({
    id: 'saved-start',
    width: 240,
    height: 100,
    data: { title: 'Saved start', variables: [] },
  }),
  createNode({
    id: 'saved-code',
    width: 240,
    height: 100,
    position: { x: 360, y: 20 },
    data: { type: BlockEnum.Code, title: 'Saved code' },
  }),
]
const savedEdges = [createEdge({ id: 'saved-edge', source: 'saved-start', target: 'saved-code' })]
const savedViewport = { x: 10, y: 20, zoom: 1.2 }
const draftResponse: FetchWorkflowDraftResponse = {
  id: 'draft-1',
  hash: 'server-hash',
  graph: { nodes: savedNodes, edges: savedEdges, viewport: savedViewport },
  created_at: 1,
  created_by: { id: 'user-1', name: 'User', email: 'user@example.com' },
  updated_at: 2,
  updated_by: { id: 'user-1', name: 'User', email: 'user@example.com' },
  tool_published: false,
  environment_variables: [],
  conversation_variables: [],
  version: 'draft',
  marked_name: '',
  marked_comment: '',
}

function setup(mode: AppMode = 'advanced-chat') {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_collaboration_mode: false },
    appDslVersion: '0.6.0',
  })
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

  const refresh = createRef<ReturnType<typeof useWorkflowRefreshDraft>>()
  const flow = createRef<ReactFlowInstance>()
  function RefreshProbe() {
    const hook = useWorkflowRefreshDraft()
    const canvas = useReactFlow()
    useImperativeHandle(refresh, () => hook, [hook])
    useImperativeHandle(flow, () => canvas, [canvas])
    return null
  }

  const rendered = renderWorkflowComponent(
    <NuqsTestingAdapter>
      <EventEmitterContextProvider>
        <WorkflowWithDefaultContext nodes={localNodes} edges={localEdges}>
          <Workflow nodes={localNodes} edges={localEdges} viewport={localViewport}>
            <RefreshProbe />
          </Workflow>
        </WorkflowWithDefaultContext>
      </EventEmitterContextProvider>
    </NuqsTestingAdapter>,
    {
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode: mode === 'advanced-chat' ? mode : 'workflow' },
      initialStoreState: {
        nodes: localNodes,
        isWorkflowDataLoaded: true,
        syncWorkflowDraftHash: 'local-hash',
      },
    },
  )

  return { ...rendered, flow, refresh }
}

async function expectGraph(
  flow: React.RefObject<ReactFlowInstance | null>,
  nodeIds: string[],
  edgeIds: string[],
  viewport: { x: number; y: number; zoom: number },
) {
  await waitFor(() => {
    expect(flow.current!.getNodes().map((node) => node.id)).toEqual(nodeIds)
    expect(flow.current!.getEdges().map((edge) => edge.id)).toEqual(edgeIds)
    expect(flow.current!.getViewport()).toEqual(viewport)
  })
}

describe('useWorkflowRefreshDraft', () => {
  beforeEach(() => {
    fetchDraft.mockReset().mockResolvedValue(draftResponse)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected network request')
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each([undefined, false, true])(
    'refreshes draft metadata and respects notUpdateCanvas=%s',
    async (notUpdateCanvas) => {
      const { flow, refresh, store } = setup()
      await expectGraph(flow, ['local-start', 'local-code'], ['local-edge'], localViewport)

      await act(async () => {
        expect(await refresh.current!.handleRefreshWorkflowDraft(notUpdateCanvas)).toBe(true)
      })

      expect(fetchDraft).toHaveBeenCalledWith('/apps/app-1/workflows/draft')
      await expectGraph(
        flow,
        notUpdateCanvas ? ['local-start', 'local-code'] : ['saved-start', 'saved-code'],
        notUpdateCanvas ? ['local-edge'] : ['saved-edge'],
        notUpdateCanvas ? localViewport : savedViewport,
      )
      expect(store.getState()).toMatchObject({
        syncWorkflowDraftHash: 'server-hash',
        isSyncingWorkflowDraft: false,
        isWorkflowDataLoaded: true,
      })
    },
  )

  it('discards a stale guarded response before it mutates the graph or draft metadata', async () => {
    const deferred = createDeferred<FetchWorkflowDraftResponse>()
    fetchDraft.mockReturnValue(deferred.promise)
    let isCurrent = true
    const { flow, refresh, store } = setup()
    let request!: Promise<boolean>
    act(() => {
      request = refresh.current!.handleRefreshWorkflowDraft(false, {
        shouldApply: () => isCurrent,
      })
    })
    isCurrent = false

    await act(async () => {
      deferred.resolve(draftResponse)
      expect(await request).toBe(false)
    })

    await expectGraph(flow, ['local-start', 'local-code'], ['local-edge'], localViewport)
    expect(store.getState()).toMatchObject({
      syncWorkflowDraftHash: 'local-hash',
      environmentVariables: [],
      conversationVariables: [],
    })
  })

  it('keeps the syncing guard active until the newest overlapping refresh completes', async () => {
    const first = createDeferred<FetchWorkflowDraftResponse>()
    const second = createDeferred<FetchWorkflowDraftResponse>()
    fetchDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    let firstIsCurrent = true
    const { flow, refresh, store } = setup()
    let firstRequest!: Promise<boolean>
    let secondRequest!: Promise<boolean>
    act(() => {
      firstRequest = refresh.current!.handleRefreshWorkflowDraft(false, {
        shouldApply: () => firstIsCurrent,
      })
      secondRequest = refresh.current!.handleRefreshWorkflowDraft(false, {
        shouldApply: () => true,
      })
    })
    firstIsCurrent = false

    await act(async () => {
      first.resolve(draftResponse)
      await firstRequest
    })
    expect(store.getState().isSyncingWorkflowDraft).toBe(true)
    await expectGraph(flow, ['local-start', 'local-code'], ['local-edge'], localViewport)

    await act(async () => {
      second.resolve(draftResponse)
      await secondRequest
    })
    expect(store.getState().isSyncingWorkflowDraft).toBe(false)
    await expectGraph(flow, ['saved-start', 'saved-code'], ['saved-edge'], savedViewport)
  })

  it('cancels pending sync, restores the default viewport, and separates secret values', async () => {
    const { flow, refresh, store } = setup()
    const pendingSyncEffect = vi.fn()
    vi.useFakeTimers()
    store.getState().debouncedSyncWorkflowDraft(pendingSyncEffect)
    const conversationVariables = [
      { id: 'conversation-1', name: 'name', value_type: 'string', value: 'Alice', description: '' },
    ] satisfies NonNullable<FetchWorkflowDraftResponse['conversation_variables']>
    fetchDraft.mockResolvedValue({
      ...draftResponse,
      graph: { nodes: savedNodes, edges: savedEdges },
      environment_variables: [
        {
          id: 'env-secret',
          value_type: 'secret',
          value: 'top-secret',
          name: 'SECRET',
          description: '',
        },
        {
          id: 'env-plain',
          value_type: 'string',
          value: 'visible',
          name: 'PLAIN',
          description: '',
        },
      ],
      conversation_variables: conversationVariables,
    })

    await act(async () => {
      await refresh.current!.handleRefreshWorkflowDraft()
    })
    act(() => vi.advanceTimersByTime(5000))
    vi.useRealTimers()

    expect(pendingSyncEffect).not.toHaveBeenCalled()
    await expectGraph(flow, ['saved-start', 'saved-code'], ['saved-edge'], {
      x: 0,
      y: 0,
      zoom: 1,
    })
    expect(store.getState()).toMatchObject({
      envSecrets: { 'env-secret': 'top-secret' },
      environmentVariables: [
        {
          id: 'env-secret',
          value_type: 'secret',
          value: '[__HIDDEN__]',
          name: 'SECRET',
          description: '',
        },
        {
          id: 'env-plain',
          value_type: 'string',
          value: 'visible',
          name: 'PLAIN',
          description: '',
        },
      ],
      conversationVariables,
    })
  })

  it.each(['workflow', 'advanced-chat'] as const)(
    'restores the appropriate empty canvas for %s',
    async (mode) => {
      fetchDraft.mockResolvedValue({ ...draftResponse, graph: { nodes: [], edges: [] } })
      const { flow, refresh } = setup(mode)

      await act(async () => {
        await refresh.current!.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        const nodes = flow.current!.getNodes()
        if (mode === 'workflow') {
          expect(nodes).toEqual([
            expect.objectContaining({
              data: expect.objectContaining({
                type: BlockEnum.StartPlaceholder,
                selected: true,
              }),
            }),
          ])
        } else {
          expect(nodes).toEqual([])
        }
        expect(flow.current!.getEdges()).toEqual([])
        expect(flow.current!.getViewport()).toEqual({ x: 0, y: 0, zoom: 1 })
      })
    },
  )

  it('restores the previously loaded state and releases the sync guard after failure', async () => {
    const deferred = createDeferred<FetchWorkflowDraftResponse>()
    fetchDraft.mockReturnValue(deferred.promise)
    const { flow, refresh, store } = setup()
    let request!: Promise<boolean>
    act(() => {
      request = refresh.current!.handleRefreshWorkflowDraft()
    })
    expect(store.getState()).toMatchObject({
      isWorkflowDataLoaded: false,
      isSyncingWorkflowDraft: true,
    })

    await act(async () => {
      deferred.reject(new Error('refresh failed'))
      expect(await request).toBe(false)
    })

    expect(store.getState()).toMatchObject({
      isWorkflowDataLoaded: true,
      isSyncingWorkflowDraft: false,
      syncWorkflowDraftHash: 'local-hash',
    })
    await expectGraph(flow, ['local-start', 'local-code'], ['local-edge'], localViewport)
  })
})
