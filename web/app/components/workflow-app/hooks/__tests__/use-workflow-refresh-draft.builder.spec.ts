import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactNode } from 'react'
import type { WorkflowDraftRefreshResult } from '../use-workflow-refresh-draft'
import type { ConversationVariable } from '@/app/components/workflow/types'
import { act, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { createElement, useCallback } from 'react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  createTestWorkflowStore,
  renderWorkflowComponent,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowContext } from '@/app/components/workflow/context'
import { renderEditorHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { BlockEnum } from '@/app/components/workflow/types'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { DifyBuilderCanvasRefreshSync } from '../../components/dify-builder/provider/canvas-sync'
import { createSessionView } from '../../components/dify-builder/session/__tests__/fixtures'
import { difyBuilderSessionViewAtom } from '../../components/dify-builder/session/state'
import {
  difyBuilderCanvasReadyAtom,
  difyBuilderCanvasRefreshFailedAtom,
} from '../../components/dify-builder/store'
import { useWorkflowRefreshDraft } from '../use-workflow-refresh-draft'

const { updateCanvas, fetchDraft } = vi.hoisted(() => ({
  updateCanvas: vi.fn(),
  fetchDraft: vi.fn(),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({ handleUpdateWorkflowCanvas: updateCanvas }),
}))
vi.mock('@/service/workflow', () => ({ fetchWorkflowDraft: fetchDraft }))
const collaboration = vi.hoisted(() => ({
  connected: vi.fn(() => false),
  sync: vi.fn(),
  nodes: vi.fn(),
  edges: vi.fn(() => []),
}))
vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    isConnected: collaboration.connected,
    canRestoreGraphFromCrdt: () => false,
    requestServerDraftSync: collaboration.sync,
    getNodes: collaboration.nodes,
    getEdges: collaboration.edges,
  },
}))

const draftResponse = {
  hash: 'server-hash',
  graph: {
    nodes: [createNode({ id: 'n1', data: { type: BlockEnum.Start } })],
    edges: [],
    viewport: { x: 1, y: 2, zoom: 1 },
  },
  environment_variables: [],
  conversation_variables: [],
}
const setup = (mode: AppMode = 'advanced-chat') => {
  const store = createTestWorkflowStore({
    isWorkflowDataLoaded: true,
    syncWorkflowDraftHash: 'local-hash',
  })
  const queryClient = createConsoleQueryClient()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode }))
  const hook = renderEditorHook(() => useWorkflowRefreshDraft(), {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: mode === 'advanced-chat' ? mode : 'workflow' },
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(WorkflowContext, { value: store }, children),
  })
  return { ...hook, store }
}

const BuilderRefreshHarness = ({ onRefreshed }: { onRefreshed: () => void }) => {
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const refresh = useCallback(
    (shouldApply: () => boolean) =>
      handleRefreshWorkflowDraft(false, {
        shouldApply,
        builderRefresh: true,
        resolveConflict: true,
        syncToCollaboration: true,
      }),
    [handleRefreshWorkflowDraft],
  )
  return createElement(DifyBuilderCanvasRefreshSync, {
    onRefreshCanvas: refresh,
    onCanvasRefreshed: onRefreshed,
  })
}

describe('useWorkflowRefreshDraft', () => {
  beforeEach(() => {
    updateCanvas.mockReset().mockReturnValue(true)
    collaboration.connected.mockReturnValue(false)
    fetchDraft.mockReset().mockResolvedValue(draftResponse)
  })

  it.each([undefined, false, true])(
    'refreshes draft metadata and respects notUpdateCanvas=%s',
    async (notUpdateCanvas) => {
      const { result, store } = setup()
      await act(async () => {
        expect(await result.current.handleRefreshWorkflowDraft(notUpdateCanvas)).toBe('refreshed')
      })
      expect(fetchDraft).toHaveBeenCalledWith('/apps/app-1/workflows/draft')
      if (notUpdateCanvas) expect(updateCanvas).not.toHaveBeenCalled()
      else
        expect(updateCanvas).toHaveBeenCalledExactlyOnceWith(
          draftResponse.graph,
          expect.objectContaining({ syncToCollaboration: true }),
        )
      expect(store.getState()).toMatchObject({
        syncWorkflowDraftHash: notUpdateCanvas ? 'local-hash' : 'server-hash',
        isSyncingWorkflowDraft: false,
        isWorkflowDataLoaded: true,
      })
    },
  )

  it('discards a stale guarded response before it mutates the canvas or draft metadata', async () => {
    const deferred = createDeferred<typeof draftResponse>()
    fetchDraft.mockReturnValue(deferred.promise)
    let isCurrent = true
    const { result, store } = setup()
    let refresh!: Promise<WorkflowDraftRefreshResult>
    act(() => {
      refresh = result.current.handleRefreshWorkflowDraft(false, { shouldApply: () => isCurrent })
    })
    isCurrent = false
    await act(async () => {
      deferred.resolve(draftResponse)
      expect(await refresh).toBe('superseded')
    })
    expect(updateCanvas).not.toHaveBeenCalled()
    expect(store.getState()).toMatchObject({
      syncWorkflowDraftHash: 'local-hash',
      environmentVariables: [],
      conversationVariables: [],
    })
  })

  it('keeps the syncing guard active until the newest overlapping refresh completes', async () => {
    const first = createDeferred<typeof draftResponse>()
    const second = createDeferred<typeof draftResponse>()
    fetchDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    let firstIsCurrent = true
    const { result, store } = setup()
    let firstRefresh!: Promise<WorkflowDraftRefreshResult>
    let secondRefresh!: Promise<WorkflowDraftRefreshResult>
    act(() => {
      firstRefresh = result.current.handleRefreshWorkflowDraft(false, {
        shouldApply: () => firstIsCurrent,
      })
    })
    await waitFor(() => expect(fetchDraft).toHaveBeenCalledOnce())
    act(() => {
      secondRefresh = result.current.handleRefreshWorkflowDraft(false, { shouldApply: () => true })
    })
    firstIsCurrent = false
    await act(async () => {
      first.resolve(draftResponse)
      await firstRefresh
    })
    expect(store.getState().isSyncingWorkflowDraft).toBe(true)
    await act(async () => {
      second.resolve(draftResponse)
      await secondRefresh
    })
    expect(store.getState().isSyncingWorkflowDraft).toBe(false)
    expect(updateCanvas).toHaveBeenCalledOnce()
  })

  it('cancels pending sync, restores the viewport, and separates secret values from displayed variables', async () => {
    const { result, store } = setup()
    const cancel = vi.spyOn(store.getState().debouncedSyncWorkflowDraft, 'cancel')
    const conversationVariables = [
      { id: 'conversation-1', name: 'name', value_type: 'string', value: 'Alice', description: '' },
    ]
    fetchDraft.mockResolvedValue({
      ...draftResponse,
      graph: { nodes: draftResponse.graph.nodes, edges: [] },
      environment_variables: [
        { id: 'env-secret', value_type: 'secret', value: 'top-secret', name: 'SECRET' },
        { id: 'env-plain', value_type: 'text', value: 'visible', name: 'PLAIN' },
      ],
      conversation_variables: conversationVariables,
    })
    await act(async () => {
      await result.current.handleRefreshWorkflowDraft()
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(updateCanvas).toHaveBeenCalledWith(
      {
        nodes: draftResponse.graph.nodes,
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      expect.objectContaining({ syncToCollaboration: true }),
    )
    expect(store.getState()).toMatchObject({
      envSecrets: { 'env-secret': 'top-secret' },
      environmentVariables: [
        { id: 'env-secret', value_type: 'secret', value: '[__HIDDEN__]', name: 'SECRET' },
        { id: 'env-plain', value_type: 'text', value: 'visible', name: 'PLAIN' },
      ],
      conversationVariables,
    })
    cancel.mockRestore()
  })

  it.each(['workflow', 'advanced-chat'] as const)(
    'restores the appropriate empty canvas for %s',
    async (mode) => {
      fetchDraft.mockResolvedValue({ ...draftResponse, graph: { nodes: [], edges: [] } })
      const { result } = setup(mode)
      await act(async () => {
        await result.current.handleRefreshWorkflowDraft()
      })
      expect(updateCanvas).toHaveBeenCalledWith(
        {
          nodes:
            mode === 'workflow'
              ? [
                  expect.objectContaining({
                    data: expect.objectContaining({
                      type: BlockEnum.StartPlaceholder,
                      selected: true,
                    }),
                  }),
                ]
              : [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        expect.objectContaining({ syncToCollaboration: true }),
      )
    },
  )

  it('restores the previously loaded state and releases the sync guard after a failed refresh', async () => {
    const deferred = createDeferred<typeof draftResponse>()
    fetchDraft.mockReturnValue(deferred.promise)
    const { result, store } = setup()
    let refresh!: Promise<WorkflowDraftRefreshResult>
    act(() => {
      refresh = result.current.handleRefreshWorkflowDraft()
    })
    expect(store.getState()).toMatchObject({
      isWorkflowDataLoaded: true,
      isSyncingWorkflowDraft: true,
    })
    await act(async () => {
      deferred.reject(new Error('refresh failed'))
      expect(await refresh).toBe('failed')
    })
    expect(store.getState()).toMatchObject({
      isWorkflowDataLoaded: true,
      isSyncingWorkflowDraft: false,
      syncWorkflowDraftHash: 'local-hash',
    })
    expect(updateCanvas).not.toHaveBeenCalled()
  })

  it('uses the accepted collaborative graph without rewriting the shared document', async () => {
    collaboration.connected.mockReturnValue(true)
    const accepted = [createNode({ id: 'accepted' })]
    collaboration.nodes.mockReturnValue(accepted)
    collaboration.sync.mockResolvedValue({ hash: 'server-hash' })
    const { result, store } = setup()
    await act(async () =>
      expect(await result.current.handleRefreshWorkflowDraft()).toBe('refreshed'),
    )
    expect(updateCanvas).toHaveBeenCalledWith(
      { ...draftResponse.graph, nodes: accepted },
      expect.objectContaining({ syncToCollaboration: false }),
    )
    expect(store.getState().syncWorkflowDraftHash).toBe('server-hash')
  })

  it('stops after three reads if the collaborative revision keeps advancing', async () => {
    collaboration.connected.mockReturnValue(true)
    collaboration.sync.mockResolvedValue({ hash: 'newer-hash' })
    const { result, store } = setup()
    await act(async () => expect(await result.current.handleRefreshWorkflowDraft()).toBe('failed'))
    expect(fetchDraft).toHaveBeenCalledTimes(3)
    expect(updateCanvas).not.toHaveBeenCalled()
    expect(store.getState().syncWorkflowDraftHash).toBe('local-hash')
  })

  it('refreshes Builder from HTTP and preserves navigation changed while the request is pending', async () => {
    const pending = createDeferred<typeof draftResponse>()
    fetchDraft.mockReturnValue(pending.promise)
    const { result, store } = setup()
    store.getState().setWorkflowDraftSyncPhase('builder')
    let refresh!: Promise<WorkflowDraftRefreshResult>
    act(() => {
      refresh = result.current.handleRefreshWorkflowDraft(false, {
        builderRefresh: true,
        syncToCollaboration: false,
      })
    })
    await waitFor(() => expect(fetchDraft).toHaveBeenCalledOnce())
    store.getState().setBuilderViewportManuallyChanged(true)
    expect(store.getState().workflowDraftSyncPhase).toBe('builder')
    await act(async () => {
      pending.resolve(draftResponse)
      expect(await refresh).toBe('refreshed')
    })
    expect(updateCanvas).toHaveBeenCalledWith(
      draftResponse.graph,
      expect.objectContaining({ preserveViewport: true, syncToCollaboration: false }),
    )
    expect(store.getState().workflowDraftSyncPhase).toBe('idle')
  })

  it('preserves local edits during background refreshes after a conflict', async () => {
    const { result, store } = setup()
    store.getState().setWorkflowDraftConflict(true)
    expect(await result.current.handleRefreshWorkflowDraft()).toBe('superseded')
    expect(fetchDraft).not.toHaveBeenCalled()
    expect(store.getState().hasWorkflowDraftConflict).toBe(true)
  })

  it('resolves a conflict only after a full graph reload is acknowledged while collaboration reconnects', async () => {
    const { result, store } = setup()
    store.getState().setWorkflowDraftConflict(true)
    updateCanvas.mockReturnValueOnce(false)
    await act(async () =>
      expect(
        await result.current.handleRefreshWorkflowDraft(false, { resolveConflict: true }),
      ).toBe('failed'),
    )
    expect(store.getState().hasWorkflowDraftConflict).toBe(true)
    expect(store.getState().syncWorkflowDraftHash).toBe('local-hash')
    await act(async () =>
      expect(
        await result.current.handleRefreshWorkflowDraft(false, { resolveConflict: true }),
      ).toBe('refreshed'),
    )
    expect(updateCanvas).toHaveBeenLastCalledWith(
      draftResponse.graph,
      expect.objectContaining({ syncToCollaboration: false }),
    )
    expect(store.getState().hasWorkflowDraftConflict).toBe(false)
    expect(store.getState().syncWorkflowDraftHash).toBe('server-hash')
  })

  it('does not let a visibility refresh cancel an in-flight full graph reload', async () => {
    const pending = createDeferred<typeof draftResponse>()
    fetchDraft.mockReturnValue(pending.promise)
    const { result, store } = setup()
    let refresh!: Promise<WorkflowDraftRefreshResult>
    act(() => {
      refresh = result.current.handleRefreshWorkflowDraft()
    })
    await waitFor(() => expect(fetchDraft).toHaveBeenCalledOnce())
    expect(await result.current.handleRefreshWorkflowDraft(true)).toBe('superseded')
    await act(async () => {
      pending.resolve(draftResponse)
      expect(await refresh).toBe('refreshed')
    })
    expect(store.getState().syncWorkflowDraftHash).toBe('server-hash')
    expect(fetchDraft).toHaveBeenCalledOnce()
  })

  it('blocks background reloads and retains the Builder barrier if the canvas cannot apply', async () => {
    const { result, store } = setup()
    store.getState().setWorkflowDraftSyncPhase('builder')
    expect(await result.current.handleRefreshWorkflowDraft()).toBe('superseded')
    expect(fetchDraft).not.toHaveBeenCalled()
    updateCanvas.mockReturnValueOnce(false)
    await act(async () =>
      expect(await result.current.handleRefreshWorkflowDraft(false, { builderRefresh: true })).toBe(
        'failed',
      ),
    )
    expect(store.getState().workflowDraftSyncPhase).toBe('builder')
    expect(store.getState().syncWorkflowDraftHash).toBe('local-hash')
  })
  it('reads matching metadata when collaboration has accepted a newer draft', async () => {
    collaboration.connected.mockReturnValue(true)
    collaboration.sync.mockResolvedValue({ hash: 'newer-hash' })
    const latest = { ...draftResponse, hash: 'newer-hash', conversation_variables: [] }
    fetchDraft.mockResolvedValueOnce(draftResponse).mockResolvedValueOnce(latest)
    const { result, store } = setup()
    await act(async () =>
      expect(await result.current.handleRefreshWorkflowDraft()).toBe('refreshed'),
    )
    expect(fetchDraft).toHaveBeenCalledTimes(2)
    expect(updateCanvas).toHaveBeenCalledOnce()
    expect(store.getState().syncWorkflowDraftHash).toBe('newer-hash')
  })

  it('finishes the Builder refresh without manual Retry when collaboration advances after the HTTP read', async () => {
    collaboration.connected.mockReturnValue(true)
    collaboration.sync.mockResolvedValue({ hash: 'newer-hash' })
    collaboration.nodes.mockReturnValue(draftResponse.graph.nodes)
    fetchDraft
      .mockResolvedValueOnce(draftResponse)
      .mockResolvedValueOnce({ ...draftResponse, hash: 'newer-hash' })
    const atoms = createStore()
    atoms.set(editorResourceAtom, { kind: 'app', appId: 'app-1', mode: 'workflow' })
    atoms.set(
      difyBuilderSessionViewAtom,
      createSessionView({ phase: 'modify', run_status: 'waiting_input', canvas_read_only: false }),
    )
    const refreshed = vi.fn()
    const { store } = renderWorkflowComponent(
      createElement(
        Provider,
        { store: atoms },
        createElement(BuilderRefreshHarness, { onRefreshed: refreshed }),
      ),
      {
        initialStoreState: { workflowDraftSyncPhase: 'builder', isWorkflowDataLoaded: true },
      },
    )
    await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
    expect(fetchDraft).toHaveBeenCalledTimes(2)
    expect(updateCanvas).toHaveBeenCalledOnce()
    expect(atoms.get(difyBuilderCanvasReadyAtom)).toBe(true)
    expect(atoms.get(difyBuilderCanvasRefreshFailedAtom)).toBe(false)
    expect(store.getState().hasWorkflowDraftConflict).toBe(false)
    expect(store.getState().syncWorkflowDraftHash).toBe('newer-hash')
  })

  it.each([true, false])(
    'preserves pending edits instead of applying a background refresh (metadata: %s)',
    async (metadata) => {
      const { result, store } = setup()
      const save = vi.fn()
      const localVariables: ConversationVariable[] = [
        {
          id: 'local-variable',
          name: 'topic',
          value_type: ChatVarType.String,
          value: 'Local edit',
          description: '',
        },
      ]
      store.getState().setConversationVariables(localVariables)
      store.getState().markWorkflowDraftDirty()
      store.getState().debouncedSyncWorkflowDraft(save)
      await act(async () =>
        expect(
          await result.current.handleRefreshWorkflowDraft(metadata, { background: true }),
        ).toBe('superseded'),
      )
      expect(fetchDraft).not.toHaveBeenCalled()
      expect(updateCanvas).not.toHaveBeenCalled()
      expect(store.getState().conversationVariables).toEqual(localVariables)
      expect(store.getState().workflowDraftSavedRevision).toBe(0)
      store.getState().flushPendingSync()
      expect(save).toHaveBeenCalledOnce()
    },
  )

  it('does not overwrite variables edited while a metadata read is pending', async () => {
    const pending = createDeferred<typeof draftResponse>()
    fetchDraft.mockReturnValue(pending.promise)
    const { result, store } = setup()
    const reading = result.current.handleRefreshWorkflowDraft(true)
    await waitFor(() => expect(fetchDraft).toHaveBeenCalledOnce())
    const localVariables: ConversationVariable[] = [
      {
        id: 'local-variable',
        name: 'topic',
        value_type: ChatVarType.String,
        value: 'Local edit',
        description: '',
      },
    ]
    store.getState().setConversationVariables(localVariables)
    store.getState().markWorkflowDraftDirty()
    await act(async () => {
      pending.resolve(draftResponse)
      expect(await reading).toBe('superseded')
    })
    expect(store.getState().conversationVariables).toEqual(localVariables)
    expect(store.getState().workflowDraftSavedRevision).toBe(0)
  })
})
