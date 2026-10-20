import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactNode } from 'react'
import { act } from '@testing-library/react'
import { createElement } from 'react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { createTestWorkflowStore } from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowContext } from '@/app/components/workflow/context'
import { renderEditorHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { BlockEnum } from '@/app/components/workflow/types'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { useWorkflowRefreshDraft } from '../use-workflow-refresh-draft'

const { updateCanvas, fetchDraft } = vi.hoisted(() => ({
  updateCanvas: vi.fn(),
  fetchDraft: vi.fn(),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({ handleUpdateWorkflowCanvas: updateCanvas }),
}))
vi.mock('@/service/workflow', () => ({ fetchWorkflowDraft: fetchDraft }))

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

describe('useWorkflowRefreshDraft', () => {
  beforeEach(() => {
    updateCanvas.mockReset()
    fetchDraft.mockReset().mockResolvedValue(draftResponse)
  })

  it.each([undefined, false, true])(
    'refreshes draft metadata and respects notUpdateCanvas=%s',
    async (notUpdateCanvas) => {
      const { result, store } = setup()
      await act(async () => {
        expect(await result.current.handleRefreshWorkflowDraft(notUpdateCanvas)).toBe(true)
      })
      expect(fetchDraft).toHaveBeenCalledWith('/apps/app-1/workflows/draft')
      if (notUpdateCanvas) expect(updateCanvas).not.toHaveBeenCalled()
      else expect(updateCanvas).toHaveBeenCalledExactlyOnceWith(draftResponse.graph)
      expect(store.getState()).toMatchObject({
        syncWorkflowDraftHash: 'server-hash',
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
    let refresh!: Promise<boolean>
    act(() => {
      refresh = result.current.handleRefreshWorkflowDraft(false, { shouldApply: () => isCurrent })
    })
    isCurrent = false
    await act(async () => {
      deferred.resolve(draftResponse)
      expect(await refresh).toBe(false)
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
    let firstRefresh!: Promise<boolean>
    let secondRefresh!: Promise<boolean>
    act(() => {
      firstRefresh = result.current.handleRefreshWorkflowDraft(false, {
        shouldApply: () => firstIsCurrent,
      })
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
    expect(updateCanvas).toHaveBeenCalledWith({
      nodes: draftResponse.graph.nodes,
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    })
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
      expect(updateCanvas).toHaveBeenCalledWith({
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
      })
    },
  )

  it('restores the previously loaded state and releases the sync guard after a failed refresh', async () => {
    const deferred = createDeferred<typeof draftResponse>()
    fetchDraft.mockReturnValue(deferred.promise)
    const { result, store } = setup()
    let refresh!: Promise<boolean>
    act(() => {
      refresh = result.current.handleRefreshWorkflowDraft()
    })
    expect(store.getState()).toMatchObject({
      isWorkflowDataLoaded: false,
      isSyncingWorkflowDraft: true,
    })
    await act(async () => {
      deferred.reject(new Error('refresh failed'))
      expect(await refresh).toBe(false)
    })
    expect(store.getState()).toMatchObject({
      isWorkflowDataLoaded: true,
      isSyncingWorkflowDraft: false,
      syncWorkflowDraftHash: 'local-hash',
    })
    expect(updateCanvas).not.toHaveBeenCalled()
  })
})
