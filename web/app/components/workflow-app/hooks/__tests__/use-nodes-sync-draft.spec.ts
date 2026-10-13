import type { WorkflowSliceShape } from '@/app/components/workflow/store/workflow/workflow-slice'
import type { EnvironmentVariablePatch } from '@/service/workflow'
import { noop } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { markAppDeletionFailed, markAppDeletionStarted } from '@/service/app-deletion'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryClient, renderHookWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'

const mockGetNodes = vi.fn()
const mockPostWithKeepalive = vi.fn()
const mockSetSyncWorkflowDraftHash = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()
const mockGetNodesReadOnly = vi.fn()
const mockCollaborationIsConnected = vi.fn()
const mockCollaborationGetIsLeader = vi.fn()
const mockCollaborationRequestWorkflowSync = vi.fn()
const mockCollaborationCanPersistLocalGraph = vi.fn()
const mockCollaborationCanFlushGraphOnPageClose = vi.fn()
const mockCollaborationCanUseLocalDraftFallback = vi.fn()
const mockSetShowConfirm = vi.fn<(confirmation: WorkflowSliceShape['showConfirm']) => void>()
let isCollaborationEnabled = false
let appMode: AppModeEnum | undefined

let reactFlowState: {
  getNodes: typeof mockGetNodes
  edges: Array<Record<string, unknown>>
  transform: [number, number, number]
}

let workflowStoreState: {
  appId: string
  isWorkflowDataLoaded: boolean
  isSyncingWorkflowDraft: boolean
  workflowDraftGeneration: number
  syncWorkflowDraftHash: string | null
  conversationVariables: Array<Record<string, unknown>>
  setSyncWorkflowDraftHash: typeof mockSetSyncWorkflowDraftHash
  setDraftUpdatedAt: typeof mockSetDraftUpdatedAt
  showConfirm: WorkflowSliceShape['showConfirm']
  setShowConfirm: typeof mockSetShowConfirm
}
let draftStore: ReturnType<typeof createWorkflowStore>

let featuresState: {
  features: {
    opening: { enabled: boolean; opening_statement: string; suggested_questions: string[] }
    suggested: Record<string, unknown>
    text2speech: Record<string, unknown>
    speech2text: Record<string, unknown>
    citation: Record<string, unknown>
    moderation: Record<string, unknown>
    file: Record<string, unknown>
  }
}

vi.mock('reactflow', () => ({
  useStoreApi: () => ({ getState: () => reactFlowState }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: typeof workflowStoreState) => unknown) =>
    selector(workflowStoreState),
  useWorkflowStore: () => ({
    getState: () => ({
      ...draftStore.getState(),
      ...workflowStoreState,
      invalidateWorkflowDraftSync: () => {
        draftStore.getState().invalidateWorkflowDraftSync()
        return ++workflowStoreState.workflowDraftGeneration
      },
      hasWorkflowDraftConflict: draftStore.getState().hasWorkflowDraftConflict,
      setWorkflowDraftConflict: (conflicted: boolean) => {
        draftStore.getState().setWorkflowDraftConflict(conflicted)
        workflowStoreState.workflowDraftGeneration += 1
      },
    }),
  }),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({
    getState: () => featuresState,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ getNodesReadOnly: mockGetNodesReadOnly }),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    isConnected: (...args: unknown[]) => mockCollaborationIsConnected(...args),
    getIsLeader: (...args: unknown[]) => mockCollaborationGetIsLeader(...args),
    requestWorkflowSync: (...args: unknown[]) => mockCollaborationRequestWorkflowSync(...args),
    canPersistLocalGraph: (...args: unknown[]) => mockCollaborationCanPersistLocalGraph(...args),
    canFlushGraphOnPageClose: (...args: unknown[]) =>
      mockCollaborationCanFlushGraphOnPageClose(...args),
    canUseLocalDraftFallback: (...args: unknown[]) =>
      mockCollaborationCanUseLocalDraftFallback(...args),
  },
}))

const mockSyncWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  syncWorkflowDraft: (p: unknown) => mockSyncWorkflowDraft(p),
}))

vi.mock('@/service/fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/fetch')>()
  return {
    ...actual,
    postWithKeepalive: (...args: unknown[]) => mockPostWithKeepalive(...args),
  }
})
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return { ...actual, API_PREFIX: '/api' }
})

const mockHandleRefreshWorkflowDraft = vi.fn()
vi.mock('../use-workflow-refresh-draft', () => ({
  useWorkflowRefreshDraft: () => ({ handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft }),
}))

const renderUseNodesSyncDraft = () => {
  const queryClient = createConsoleQueryClient()
  const appId = workflowStoreState.appId
  const appQueryKey = consoleQuery.apps.byAppId.get.queryKey({
    input: { params: { app_id: appId } },
  })
  if (appMode)
    queryClient.setQueryData(appQueryKey, createAppDetailFixture({ id: appId, mode: appMode }))
  else
    void queryClient
      .query({
        queryKey: appQueryKey,
        queryFn: () => new Promise<ReturnType<typeof createAppDetailFixture>>(() => {}),
      })
      .catch(noop)

  return renderHookWithConsoleQuery(() => useNodesSyncDraft(), {
    queryClient,
    systemFeatures: { enable_collaboration_mode: isCollaborationEnabled },
  })
}

describe('useNodesSyncDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    draftStore = createWorkflowStore({})
    mockSetShowConfirm.mockImplementation((confirmation) => {
      workflowStoreState.showConfirm = confirmation
    })
    reactFlowState = {
      getNodes: mockGetNodes,
      edges: [],
      transform: [0, 0, 1],
    }
    workflowStoreState = {
      appId: 'app-1',
      isWorkflowDataLoaded: true,
      isSyncingWorkflowDraft: false,
      workflowDraftGeneration: 0,
      syncWorkflowDraftHash: 'hash-123',
      conversationVariables: [],
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setDraftUpdatedAt: mockSetDraftUpdatedAt,
      showConfirm: undefined,
      setShowConfirm: mockSetShowConfirm,
    }
    featuresState = {
      features: {
        opening: { enabled: false, opening_statement: '', suggested_questions: [] },
        suggested: {},
        text2speech: {},
        speech2text: {},
        citation: {},
        moderation: {},
        file: {},
      },
    }
    mockGetNodesReadOnly.mockReturnValue(false)
    mockGetNodes.mockReturnValue([
      { id: 'n1', position: { x: 0, y: 0 }, data: { type: BlockEnum.Start } },
    ])
    mockSyncWorkflowDraft.mockResolvedValue({ hash: 'new', updated_at: 1 })
    mockCollaborationIsConnected.mockReturnValue(false)
    mockCollaborationGetIsLeader.mockReturnValue(true)
    mockCollaborationCanPersistLocalGraph.mockReturnValue(true)
    mockCollaborationCanFlushGraphOnPageClose.mockReturnValue(true)
    mockCollaborationCanUseLocalDraftFallback.mockReturnValue(false)
    mockCollaborationRequestWorkflowSync.mockResolvedValue({
      hash: 'remote-hash',
      updatedAt: 2,
    })
    isCollaborationEnabled = false
    appMode = AppModeEnum.WORKFLOW
  })

  it.each(['draft sync', 'page close'] as const)(
    'should remove Workflow LLM memory from %s without changing the canvas nodes',
    async (savePath) => {
      const memory = {
        enabled: false,
        role_prefix: { user: '', assistant: '' },
        window: { enabled: false, size: 10 },
      }
      const canvasNodes = [
        {
          id: 'llm',
          position: { x: 0, y: 0 },
          data: { type: BlockEnum.LLM, title: 'LLM', memory },
        },
        {
          id: 'iteration-llm',
          parentId: 'iteration',
          position: { x: 0, y: 0 },
          data: { type: BlockEnum.LLM, title: 'Iteration LLM', memory },
        },
        {
          id: 'loop-llm',
          parentId: 'loop',
          position: { x: 0, y: 0 },
          data: { type: BlockEnum.LLM, title: 'Loop LLM', memory },
        },
      ]
      mockGetNodes.mockReturnValue(canvasNodes)
      const { result } = renderUseNodesSyncDraft()

      await act(async () => {
        if (savePath === 'draft sync') await result.current.doSyncWorkflowDraft()
        else result.current.syncWorkflowDraftWhenPageClose()
      })

      const expectedPayload = expect.objectContaining({
        graph: expect.objectContaining({
          nodes: canvasNodes.map((node) => ({
            ...node,
            data: { type: BlockEnum.LLM, title: node.data.title },
          })),
        }),
      })
      if (savePath === 'draft sync')
        expect(mockSyncWorkflowDraft).toHaveBeenCalledWith({
          url: '/apps/app-1/workflows/draft',
          params: expectedPayload,
        })
      else
        expect(mockPostWithKeepalive).toHaveBeenCalledWith(
          '/api/apps/app-1/workflows/draft',
          expectedPayload,
        )
      canvasNodes.forEach((node) => expect(node.data.memory).toEqual(memory))
    },
  )

  it.each([AppModeEnum.ADVANCED_CHAT, undefined])(
    'should preserve LLM memory when app mode is %s',
    async (mode) => {
      appMode = mode
      const canvasNodes = [
        {
          id: 'llm',
          position: { x: 0, y: 0 },
          data: {
            type: BlockEnum.LLM,
            memory: {
              role_prefix: { user: 'Human', assistant: 'Assistant' },
              window: { enabled: true, size: 10 },
            },
          },
        },
      ]
      mockGetNodes.mockReturnValue(canvasNodes)
      const { result } = renderUseNodesSyncDraft()

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
        result.current.syncWorkflowDraftWhenPageClose()
      })

      const expectedPayload = expect.objectContaining({
        graph: expect.objectContaining({ nodes: canvasNodes }),
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith({
        url: '/apps/app-1/workflows/draft',
        params: expectedPayload,
      })
      expect(mockPostWithKeepalive).toHaveBeenCalledWith(
        '/api/apps/app-1/workflows/draft',
        expectedPayload,
      )
    },
  )

  it('should wait for confirmation before saving an empty graph with force', async () => {
    mockGetNodes.mockReturnValue([])
    const callbacks = {
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onSettled: vi.fn(),
    }
    const { result } = renderUseNodesSyncDraft()
    let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      syncPromise = result.current.doSyncWorkflowDraft(false, callbacks)
    })

    expect(workflowStoreState.showConfirm).toEqual(
      expect.objectContaining({
        title: 'workflow.common.clearCanvasConfirmTitle',
        desc: 'workflow.common.clearCanvasConfirmDescription',
      }),
    )
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(callbacks.onSettled).not.toHaveBeenCalled()

    await act(async () => {
      workflowStoreState.showConfirm?.onConfirm()
      await expect(syncPromise).resolves.toEqual({ hash: 'new', updatedAt: 1 })
    })

    expect(workflowStoreState.showConfirm).toBeUndefined()
    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          graph: expect.objectContaining({ nodes: [], edges: [] }),
          force: true,
        }),
      }),
    )
    expect(callbacks.onSuccess).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalledOnce()
  })

  it('should settle a canceled empty save without posting or reporting an error', async () => {
    mockGetNodes.mockReturnValue([])
    const callbacks = {
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onSettled: vi.fn(),
    }
    const { result } = renderUseNodesSyncDraft()
    let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      syncPromise = result.current.doSyncWorkflowDraft(false, callbacks)
    })

    expect(workflowStoreState.showConfirm?.onCancel).toBeDefined()
    await act(async () => {
      workflowStoreState.showConfirm?.onCancel?.()
      await expect(syncPromise).resolves.toBeNull()
    })

    expect(workflowStoreState.showConfirm).toBeUndefined()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(callbacks.onSuccess).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalledOnce()
  })

  it('should save a nonempty graph without confirmation or force', async () => {
    const { result } = renderUseNodesSyncDraft()

    await act(async () => {
      await result.current.doSyncWorkflowDraft()
    })

    expect(mockSetShowConfirm).not.toHaveBeenCalled()
    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.not.objectContaining({ force: expect.anything() }),
      }),
    )
  })

  it('should confirm a graph that is empty after filtering placeholders and temporary entities', async () => {
    mockGetNodes.mockReturnValue([
      {
        id: 'start-placeholder',
        position: { x: 0, y: 0 },
        data: { type: BlockEnum.StartPlaceholder },
      },
      {
        id: 'temp-node',
        position: { x: 1, y: 1 },
        data: { type: BlockEnum.Answer, _isTempNode: true },
      },
    ])
    reactFlowState.edges = [
      {
        id: 'temp-edge',
        source: 'start-placeholder',
        target: 'temp-node',
        data: { _isTemp: true },
      },
    ]
    const { result } = renderUseNodesSyncDraft()
    let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      syncPromise = result.current.doSyncWorkflowDraft()
    })

    expect(workflowStoreState.showConfirm).toBeDefined()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()

    await act(async () => {
      workflowStoreState.showConfirm?.onConfirm()
      await syncPromise
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          graph: expect.objectContaining({ nodes: [], edges: [] }),
          force: true,
        }),
      }),
    )
  })

  it('should skip an empty page-close save without opening confirmation', () => {
    mockGetNodes.mockReturnValue([])
    const { result } = renderUseNodesSyncDraft()

    act(() => {
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockPostWithKeepalive).not.toHaveBeenCalled()
    expect(mockSetShowConfirm).not.toHaveBeenCalled()
  })

  it('should keep one confirmation when another hook instance tries to save the empty graph', async () => {
    mockGetNodes.mockReturnValue([])
    const first = renderUseNodesSyncDraft()
    const second = renderUseNodesSyncDraft()
    const secondCallbacks = { onError: vi.fn(), onSettled: vi.fn() }
    let firstSave!: ReturnType<typeof first.result.current.doSyncWorkflowDraft>

    act(() => {
      firstSave = first.result.current.doSyncWorkflowDraft()
    })
    const confirmation = workflowStoreState.showConfirm

    await act(async () => {
      await expect(
        second.result.current.doSyncWorkflowDraft(false, secondCallbacks),
      ).resolves.toBeNull()
    })

    expect(mockSetShowConfirm).toHaveBeenCalledOnce()
    expect(workflowStoreState.showConfirm).toBe(confirmation)
    expect(secondCallbacks.onError).not.toHaveBeenCalled()
    expect(secondCallbacks.onSettled).toHaveBeenCalledOnce()

    await act(async () => {
      confirmation?.onConfirm()
      await firstSave
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
  })

  it('should not save the old empty graph when a node is added before confirmation', async () => {
    mockGetNodes.mockReturnValue([])
    const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
    const { result } = renderUseNodesSyncDraft()
    let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      syncPromise = result.current.doSyncWorkflowDraft(false, callbacks)
    })

    mockGetNodes.mockReturnValue([
      { id: 'new-node', position: { x: 0, y: 0 }, data: { type: BlockEnum.Start } },
    ])

    await act(async () => {
      workflowStoreState.showConfirm?.onConfirm()
      await expect(syncPromise).resolves.toBeNull()
    })

    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalledOnce()
  })

  it('should recheck a confirmed empty graph after an earlier save finishes', async () => {
    let finishEarlierSave!: (response: { hash: string; updated_at: number }) => void
    let notifySaveStarted!: () => void
    const saveStarted = new Promise<void>((resolve) => {
      notifySaveStarted = resolve
    })
    mockSyncWorkflowDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishEarlierSave = resolve
          notifySaveStarted()
        }),
    )
    const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
    const { result } = renderUseNodesSyncDraft()
    let earlierSave!: ReturnType<typeof result.current.doSyncWorkflowDraft>
    let emptySave!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      earlierSave = result.current.doSyncWorkflowDraft()
    })
    await saveStarted
    mockGetNodes.mockReturnValue([])

    act(() => {
      emptySave = result.current.doSyncWorkflowDraft(false, callbacks)
    })

    await act(async () => {
      workflowStoreState.showConfirm?.onConfirm()
    })

    mockGetNodes.mockReturnValue([
      { id: 'restored-node', position: { x: 0, y: 0 }, data: { type: BlockEnum.Start } },
    ])

    await act(async () => {
      finishEarlierSave({ hash: 'earlier-save', updated_at: 1 })
      await earlierSave
      await expect(emptySave).resolves.toBeNull()
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalledOnce()
  })

  it('should not apply empty-canvas consent to another app', async () => {
    mockGetNodes.mockReturnValue([])
    const { result } = renderUseNodesSyncDraft()
    let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      syncPromise = result.current.doSyncWorkflowDraft()
    })

    workflowStoreState.appId = 'app-2'
    await act(async () => {
      workflowStoreState.showConfirm?.onConfirm()
      await expect(syncPromise).resolves.toBeNull()
    })

    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should cancel a pending empty save when its owning hook unmounts', async () => {
    mockGetNodes.mockReturnValue([])
    const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
    const { result, unmount } = renderUseNodesSyncDraft()
    let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      syncPromise = result.current.doSyncWorkflowDraft(false, callbacks)
    })
    expect(workflowStoreState.showConfirm).toBeDefined()

    unmount()
    await expect(syncPromise).resolves.toBeNull()

    expect(workflowStoreState.showConfirm).toBeUndefined()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalledOnce()
  })

  it('should confirm and save an empty collaborative follower graph in the initiating tab', async () => {
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(true)
    mockCollaborationGetIsLeader.mockReturnValue(false)
    mockGetNodes.mockReturnValue([])
    const { result } = renderUseNodesSyncDraft()
    let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      syncPromise = result.current.doSyncWorkflowDraft()
    })

    expect(workflowStoreState.showConfirm).toBeDefined()
    expect(mockCollaborationRequestWorkflowSync).not.toHaveBeenCalled()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()

    await act(async () => {
      workflowStoreState.showConfirm?.onConfirm()
      await syncPromise
    })

    expect(mockCollaborationRequestWorkflowSync).not.toHaveBeenCalled()
    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ force: true, _is_collaborative: true }),
      }),
    )
  })

  it('pauses all save entry points after a draft conflict without refreshing the canvas', async () => {
    const error = createHttpError(new Response(null, { status: 409 }), {
      code: 'draft_workflow_not_sync',
    })
    mockSyncWorkflowDraft.mockRejectedValue(error)

    const { result } = renderUseNodesSyncDraft()
    const other = renderUseNodesSyncDraft()
    await act(async () => {
      await result.current.doSyncWorkflowDraft(false)
      await other.result.current.doSyncWorkflowDraft()
      await result.current.doSyncWorkflowDraft(false, undefined, { forceLocal: true })
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
    expect(mockPostWithKeepalive).not.toHaveBeenCalled()
    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
  })

  it('pauses saves even when the caller disabled automatic refresh', async () => {
    const error = createHttpError(new Response(null, { status: 409 }), {
      code: 'draft_workflow_not_sync',
    })
    mockSyncWorkflowDraft.mockRejectedValue(error)

    const { result } = renderUseNodesSyncDraft()
    await act(async () => {
      await result.current.doSyncWorkflowDraft(true)
      await result.current.doSyncWorkflowDraft()
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
  })

  it('drops queued saves after a conflict and settles both callers', async () => {
    mockSyncWorkflowDraft.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 409 }), { code: 'draft_workflow_not_sync' }),
    )
    const first = { onError: vi.fn(), onSettled: vi.fn() }
    const second = { onError: vi.fn(), onSettled: vi.fn() }
    const { result } = renderUseNodesSyncDraft()

    await act(async () => {
      const pending = result.current.doSyncWorkflowDraft(false, first)
      const queued = result.current.doSyncWorkflowDraft(false, second)
      expect(await pending).toBeNull()
      expect(await queued).toBeNull()
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
    expect(first.onError).toHaveBeenCalledOnce()
    expect(first.onSettled).toHaveBeenCalledOnce()
    expect(second.onError).not.toHaveBeenCalled()
    expect(second.onSettled).toHaveBeenCalledOnce()
  })

  it.each([
    { status: 400, code: 'other_error' },
    { status: 409, code: 'other_error' },
    { status: 500, code: 'draft_workflow_not_sync' },
  ])('does not lock the editor for $status $code', async ({ status, code }) => {
    mockSyncWorkflowDraft.mockRejectedValueOnce(
      createHttpError(new Response(null, { status }), { code }),
    )

    const { result } = renderUseNodesSyncDraft()
    await act(async () => {
      await result.current.doSyncWorkflowDraft(false)
      await result.current.doSyncWorkflowDraft()
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
  })

  it('ignores a conflict response from before the latest draft reload', async () => {
    let rejectSync!: (error: ReturnType<typeof createHttpError>) => void
    mockSyncWorkflowDraft.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectSync = reject
      }),
    )
    const { result } = renderUseNodesSyncDraft()
    const pending = result.current.doSyncWorkflowDraft()
    await vi.waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
    workflowStoreState.workflowDraftGeneration += 1
    workflowStoreState.syncWorkflowDraftHash = 'reloaded-hash'
    rejectSync(
      createHttpError(new Response(null, { status: 409 }), { code: 'draft_workflow_not_sync' }),
    )

    expect(await pending).toBeNull()
    await result.current.doSyncWorkflowDraft()

    expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
    expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ hash: 'reloaded-hash' }),
      }),
    )
  })

  it('should ignore non-JSON sync errors without throwing an unhandled rejection', async () => {
    const error = createHttpError(new Response(null, { status: 502 }))
    const callbacks = {
      onError: vi.fn(),
      onSettled: vi.fn(),
    }
    mockSyncWorkflowDraft.mockRejectedValue(error)

    const { result } = renderUseNodesSyncDraft()
    await act(async () => {
      await expect(result.current.doSyncWorkflowDraft(false, callbacks)).resolves.toBeNull()
    })

    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalled()
  })

  it('should treat unavailable workflow data as a skipped sync instead of an error', async () => {
    workflowStoreState = {
      ...workflowStoreState,
      isWorkflowDataLoaded: false,
    }
    const callbacks = {
      onError: vi.fn(),
      onSettled: vi.fn(),
    }

    const { result } = renderUseNodesSyncDraft()
    await act(async () => {
      await expect(result.current.doSyncWorkflowDraft(false, callbacks)).resolves.toBeNull()
    })

    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalled()
  })

  it('should capture the graph before a queued sync runs after the canvas is torn down', async () => {
    const draftNode = {
      id: 'n1',
      position: { x: 0, y: 0 },
      data: { type: BlockEnum.Start, label: 'Start' },
    }
    const draftEdge = {
      id: 'edge-1',
      source: 'n1',
      target: 'n2',
      data: { stable: 'keep' },
    }
    mockGetNodes.mockReturnValue([draftNode])
    reactFlowState = {
      ...reactFlowState,
      edges: [draftEdge],
      transform: [10, 20, 1.5],
    }

    const { result } = renderUseNodesSyncDraft()
    let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      syncPromise = result.current.doSyncWorkflowDraft(false)

      // Simulate ReactFlow clearing its store immediately after the page starts unmounting.
      mockGetNodes.mockReturnValue([])
      reactFlowState = {
        ...reactFlowState,
        edges: [],
        transform: [0, 0, 1],
      }
    })

    await act(async () => {
      await syncPromise
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          graph: {
            nodes: [draftNode],
            edges: [draftEdge],
            viewport: { x: 10, y: 20, zoom: 1.5 },
          },
        }),
      }),
    )
  })

  it('should not include source_workflow_id in draft sync payloads', async () => {
    const { result } = renderUseNodesSyncDraft()

    await act(async () => {
      await result.current.doSyncWorkflowDraft(false)
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.not.objectContaining({
          source_workflow_id: expect.anything(),
        }),
      }),
    )
  })

  it('drops a queued old graph when a server refresh changes the draft generation', async () => {
    const { result } = renderUseNodesSyncDraft()
    const pending = result.current.doSyncWorkflowDraft()
    workflowStoreState.workflowDraftGeneration += 1
    workflowStoreState.syncWorkflowDraftHash = 'generated-hash'
    mockGetNodes.mockReturnValue([{ id: 'generated', data: { type: BlockEnum.End } }])

    expect(await pending).toBeNull()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
  })

  it('never borrows an externally updated hash for a queued graph', async () => {
    const { result } = renderUseNodesSyncDraft()
    const pending = result.current.doSyncWorkflowDraft()
    workflowStoreState.syncWorkflowDraftHash = 'external-hash'

    expect(await pending).toBeNull()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('advances the hash between its own successful serial saves', async () => {
    mockSetSyncWorkflowDraftHash.mockImplementation((hash: string) => {
      workflowStoreState.syncWorkflowDraftHash = hash
    })
    mockSyncWorkflowDraft
      .mockResolvedValueOnce({ hash: 'saved-1', updated_at: 1 })
      .mockResolvedValueOnce({ hash: 'saved-2', updated_at: 2 })
    const { result } = renderUseNodesSyncDraft()
    const first = result.current.doSyncWorkflowDraft()
    mockGetNodes.mockReturnValue([{ id: 'next-edit', data: { type: BlockEnum.End } }])
    const second = result.current.doSyncWorkflowDraft()
    await first
    await second

    expect(mockSyncWorkflowDraft).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        params: expect.objectContaining({
          hash: 'saved-1',
          graph: expect.objectContaining({
            nodes: [expect.objectContaining({ id: 'next-edit' })],
          }),
        }),
      }),
    )
    expect(workflowStoreState.syncWorkflowDraftHash).toBe('saved-2')
  })

  it('shares successful saves and their hashes across hook instances', async () => {
    mockSetSyncWorkflowDraftHash.mockImplementation((hash: string) => {
      workflowStoreState.syncWorkflowDraftHash = hash
    })
    mockSyncWorkflowDraft
      .mockResolvedValueOnce({ hash: 'saved-1', updated_at: 1 })
      .mockResolvedValueOnce({ hash: 'saved-2', updated_at: 2 })
    const first = renderUseNodesSyncDraft()
    const second = renderUseNodesSyncDraft()
    const saving = first.result.current.doSyncWorkflowDraft()
    mockGetNodes.mockReturnValue([{ id: 'latest-edit', data: { type: BlockEnum.End } }])
    const queued = second.result.current.doSyncWorkflowDraft()
    await saving
    await queued

    expect(mockSyncWorkflowDraft).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        params: expect.objectContaining({
          hash: 'saved-1',
          graph: expect.objectContaining({
            nodes: [expect.objectContaining({ id: 'latest-edit' })],
          }),
        }),
      }),
    )
    expect(workflowStoreState.syncWorkflowDraftHash).toBe('saved-2')
  })

  it('drains an in-flight save, saves the latest edits, and blocks stale saves throughout Builder execution', async () => {
    let finishSaving!: (value: { hash: string; updated_at: number }) => void
    mockSyncWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSaving = resolve
      }),
    )
    mockSetSyncWorkflowDraftHash.mockImplementation((hash: string) => {
      workflowStoreState.syncWorkflowDraftHash = hash
    })
    const cancel = vi.spyOn(draftStore.getState().debouncedSyncWorkflowDraft, 'cancel')
    const autosave = renderUseNodesSyncDraft()
    const builder = renderUseNodesSyncDraft()
    const saving = autosave.result.current.doSyncWorkflowDraft()
    await vi.waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
    mockGetNodes.mockReturnValue([{ id: 'queued-edit', data: { type: BlockEnum.End } }])
    mockSyncWorkflowDraft.mockResolvedValueOnce({ hash: 'saved-2', updated_at: 2 })
    const queued = autosave.result.current.doSyncWorkflowDraft(false, undefined, {
      environmentVariablePatch: {
        environmentVariables: [],
        deletedEnvironmentVariableIds: ['old-variable'],
      },
    })
    mockGetNodes.mockReturnValue([{ id: 'latest-edit', data: { type: BlockEnum.End } }])
    draftStore.getState().setBuilderViewportManuallyChanged(true)
    const preparing = builder.result.current.prepareWorkflowDraftForBuilder(
      true,
      new AbortController().signal,
    )
    expect(draftStore.getState().workflowDraftSyncPhase).toBe('preparing')
    expect(draftStore.getState().builderViewportManuallyChanged).toBe(false)
    draftStore.getState().setBuilderViewportManuallyChanged(true)
    expect(cancel).toHaveBeenCalled()
    expect(workflowStoreState.workflowDraftGeneration).toBe(0)
    // Builder's busy projection may lock the canvas while preparation is waiting.
    mockGetNodesReadOnly.mockReturnValue(true)
    expect(await autosave.result.current.doSyncWorkflowDraft()).toBeNull()
    autosave.result.current.syncWorkflowDraftWhenPageClose()
    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
    expect(mockPostWithKeepalive).not.toHaveBeenCalled()

    finishSaving({ hash: 'saved-1', updated_at: 1 })
    expect(await saving).toEqual({ hash: 'saved-1', updatedAt: 1 })
    expect(await queued).toEqual({ hash: 'saved-2', updatedAt: 2 })
    await preparing
    expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(3)
    expect(mockSyncWorkflowDraft).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        params: expect.objectContaining({
          hash: 'saved-1',
          environment_variable_patch: {
            environment_variables: [],
            deleted_environment_variable_ids: ['old-variable'],
          },
        }),
      }),
    )
    expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          hash: 'saved-2',
          graph: expect.objectContaining({
            nodes: [expect.objectContaining({ id: 'latest-edit' })],
          }),
        }),
      }),
    )
    expect(draftStore.getState().workflowDraftSyncPhase).toBe('builder')
    expect(draftStore.getState().builderViewportManuallyChanged).toBe(true)
    expect(workflowStoreState.workflowDraftGeneration).toBe(1)
    mockGetNodesReadOnly.mockReturnValue(false)
    expect(
      await autosave.result.current.doSyncWorkflowDraft(false, undefined, { forceLocal: true }),
    ).toBeNull()
    autosave.result.current.syncWorkflowDraftWhenPageClose()
    expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(3)
    expect(mockPostWithKeepalive).not.toHaveBeenCalled()
  })

  it('releases the barrier without reloading local edits when preparation cannot save', async () => {
    mockSyncWorkflowDraft.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderUseNodesSyncDraft()

    await expect(
      result.current.prepareWorkflowDraftForBuilder(true, new AbortController().signal),
    ).rejects.toThrow('workflow.common.draftSaveFailed')
    expect(draftStore.getState().workflowDraftSyncPhase).toBe('idle')
    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
    expect(workflowStoreState.workflowDraftGeneration).toBe(0)
    expect(await result.current.doSyncWorkflowDraft()).toEqual({ hash: 'new', updatedAt: 1 })
  })

  it('does not authorize clearing an empty canvas when preparing Builder', async () => {
    mockGetNodes.mockReturnValue([])
    mockSyncWorkflowDraft.mockImplementationOnce(({ params }) => {
      if (!params.force)
        return Promise.reject(
          createHttpError(new Response(null, { status: 400 }), {
            message: 'Saving an empty workflow requires force=true.',
          }),
        )
      return Promise.resolve({ hash: 'cleared', updated_at: 1 })
    })
    const { result } = renderUseNodesSyncDraft()

    await expect(
      result.current.prepareWorkflowDraftForBuilder(true, new AbortController().signal),
    ).rejects.toThrow('workflow.common.draftSaveFailed')

    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.not.objectContaining({ force: true }),
      }),
    )
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
    expect(draftStore.getState().workflowDraftSyncPhase).toBe('idle')
  })

  it.each([true, false])(
    'preserves local edits when a drained save conflicts before Builder preparation with saveDraft=%s',
    async (saveDraft) => {
      let rejectSave!: (error: ReturnType<typeof createHttpError>) => void
      mockSyncWorkflowDraft.mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectSave = reject
        }),
      )
      const { result } = renderUseNodesSyncDraft()
      const saving = result.current.doSyncWorkflowDraft()
      await vi.waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      const preparing = expect(
        result.current.prepareWorkflowDraftForBuilder(saveDraft, new AbortController().signal),
      ).rejects.toThrow('workflow.draftConflict.message')

      rejectSave(
        createHttpError(new Response(null, { status: 409 }), { code: 'draft_workflow_not_sync' }),
      )
      await saving
      await preparing
      expect(draftStore.getState().hasWorkflowDraftConflict).toBe(true)
      expect(draftStore.getState().workflowDraftSyncPhase).toBe('idle')
      expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
    },
  )

  it('can serve a directed save while Builder preparation waits for the collaborator acknowledgment', async () => {
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(true)
    mockCollaborationGetIsLeader.mockReturnValue(false)
    let acknowledge!: (value: { hash: string; updatedAt: number }) => void
    mockCollaborationRequestWorkflowSync.mockReturnValueOnce(
      new Promise((resolve) => {
        acknowledge = resolve
      }),
    )
    const { result } = renderUseNodesSyncDraft()
    const preparing = result.current.prepareWorkflowDraftForBuilder(
      true,
      new AbortController().signal,
    )
    await vi.waitFor(() => expect(mockCollaborationRequestWorkflowSync).toHaveBeenCalledOnce())
    mockGetNodesReadOnly.mockReturnValue(true)

    const saved = await result.current.doSyncWorkflowDraft(false, undefined, { forceLocal: true })
    expect(saved).toEqual({ hash: 'new', updatedAt: 1 })
    expect(draftStore.getState().workflowDraftSyncPhase).toBe('preparing')
    acknowledge(saved!)
    await preparing
    expect(draftStore.getState().workflowDraftSyncPhase).toBe('builder')
  })

  it('drains saves without writing an old local graph when restoring Builder', async () => {
    let finishSaving!: (value: { hash: string; updated_at: number }) => void
    mockSyncWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSaving = resolve
      }),
    )
    const { result } = renderUseNodesSyncDraft()
    const saving = result.current.doSyncWorkflowDraft()
    await vi.waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
    const preparing = result.current.prepareWorkflowDraftForBuilder(
      false,
      new AbortController().signal,
    )
    expect(workflowStoreState.workflowDraftGeneration).toBe(0)
    finishSaving({ hash: 'saved', updated_at: 1 })
    await saving
    await preparing
    expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
    expect(draftStore.getState().workflowDraftSyncPhase).toBe('builder')
  })

  it('allows a replacement restore to take over a canceled preparation without saving the old graph', async () => {
    const { result } = renderUseNodesSyncDraft()
    const first = new AbortController()
    const canceled = expect(
      result.current.prepareWorkflowDraftForBuilder(false, first.signal),
    ).rejects.toThrow()
    first.abort()
    const restored = result.current.prepareWorkflowDraftForBuilder(
      false,
      new AbortController().signal,
    )

    await canceled
    await restored
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(draftStore.getState().workflowDraftSyncPhase).toBe('builder')
  })

  it('retains the accepted Builder save snapshot if the editor unmounts before the queue runs', async () => {
    const { result } = renderUseNodesSyncDraft()
    const controller = new AbortController()
    const preparing = expect(
      result.current.prepareWorkflowDraftForBuilder(true, controller.signal),
    ).rejects.toThrow()
    controller.abort()
    mockGetNodes.mockReturnValue([])

    await preparing
    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          graph: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'n1' })] }),
        }),
      }),
    )
  })

  it('ignores a save response that arrives after a newer draft was loaded', async () => {
    let resolveResponse!: (value: { hash: string; updated_at: number }) => void
    mockSyncWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve
      }),
    )
    const onSuccess = vi.fn()
    const { result } = renderUseNodesSyncDraft()
    const pending = result.current.doSyncWorkflowDraft(false, { onSuccess })
    await vi.waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
    workflowStoreState.workflowDraftGeneration += 1
    workflowStoreState.syncWorkflowDraftHash = 'generated-hash'
    resolveResponse({ hash: 'outdated-save', updated_at: 1 })

    expect(await pending).toBeNull()
    expect(workflowStoreState.syncWorkflowDraftHash).toBe('generated-hash')
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('blocks normal and keepalive saves while a draft is being applied', async () => {
    workflowStoreState.isSyncingWorkflowDraft = true
    const { result } = renderUseNodesSyncDraft()
    expect(await result.current.doSyncWorkflowDraft()).toBeNull()
    result.current.syncWorkflowDraftWhenPageClose()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockPostWithKeepalive).not.toHaveBeenCalled()
  })

  it('should strip temp entities and private data, use the latest hash, and invoke success callbacks', async () => {
    reactFlowState = {
      ...reactFlowState,
      edges: [
        {
          id: 'edge-1',
          source: 'n1',
          target: 'n2',
          data: { _isTemp: false, _private: 'drop', stable: 'keep' },
        },
        {
          id: 'placeholder-edge',
          source: 'start-placeholder',
          target: 'n1',
          data: { stable: 'drop' },
        },
        { id: 'temp-edge', source: 'n2', target: 'n3', data: { _isTemp: true } },
      ],
      transform: [10, 20, 1.5],
    }
    mockGetNodes.mockReturnValue([
      {
        id: 'n1',
        position: { x: 0, y: 0 },
        data: { type: BlockEnum.Start, _tempField: 'drop', label: 'Start' },
      },
      {
        id: 'start-placeholder',
        position: { x: 1, y: 1 },
        data: { type: BlockEnum.StartPlaceholder },
      },
      {
        id: 'temp-node',
        position: { x: 2, y: 2 },
        data: { type: BlockEnum.Answer, _isTempNode: true },
      },
    ])
    workflowStoreState = {
      ...workflowStoreState,
      syncWorkflowDraftHash: 'latest-hash',
      conversationVariables: [{ id: 'conversation-1', value: 'conversation' }],
    }
    featuresState = {
      features: {
        opening: { enabled: true, opening_statement: 'Hello', suggested_questions: ['Q1'] },
        suggested: { enabled: true },
        text2speech: { enabled: true },
        speech2text: { enabled: true },
        citation: { enabled: true },
        moderation: { enabled: false },
        file: { enabled: true },
      },
    }

    const callbacks = {
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onSettled: vi.fn(),
    }

    const { result } = renderUseNodesSyncDraft()

    await act(async () => {
      await result.current.doSyncWorkflowDraft(false, callbacks)
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith({
      url: '/apps/app-1/workflows/draft',
      params: {
        graph: {
          nodes: [
            { id: 'n1', position: { x: 0, y: 0 }, data: { type: BlockEnum.Start, label: 'Start' } },
          ],
          edges: [{ id: 'edge-1', source: 'n1', target: 'n2', data: { stable: 'keep' } }],
          viewport: { x: 10, y: 20, zoom: 1.5 },
        },
        features: {
          opening_statement: 'Hello',
          suggested_questions: ['Q1'],
          suggested_questions_after_answer: { enabled: true },
          text_to_speech: { enabled: true },
          speech_to_text: { enabled: true },
          retriever_resource: { enabled: true },
          sensitive_word_avoidance: { enabled: false },
          file_upload: { enabled: true },
        },
        conversation_variables: [{ id: 'conversation-1', value: 'conversation' }],
        hash: 'latest-hash',
      },
    })
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new')
    expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith(1)
    expect(callbacks.onSuccess).toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalled()
  })

  it('should include an environment variable patch in a full draft sync', async () => {
    const environmentVariablePatch: EnvironmentVariablePatch = {
      environmentVariables: [
        {
          id: 'env-1',
          name: 'for_summarize',
          description: '',
          value_type: 'llm',
          value: {
            provider: 'langgenius/openai/openai',
            name: 'gpt-4.1',
            mode: 'chat',
          },
        },
      ],
      deletedEnvironmentVariableIds: ['env-2'],
    }
    const { result } = renderUseNodesSyncDraft()

    await act(async () => {
      await result.current.doSyncWorkflowDraft(false, undefined, { environmentVariablePatch })
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          environment_variable_patch: {
            environment_variables: environmentVariablePatch.environmentVariables,
            deleted_environment_variable_ids:
              environmentVariablePatch.deletedEnvironmentVariableIds,
          },
        }),
      }),
    )
  })

  it('should keep pending inline Agent v2 nodes in draft without incomplete bindings', async () => {
    reactFlowState = {
      ...reactFlowState,
      edges: [
        {
          id: 'edge-1',
          source: 'n1',
          target: 'pending-agent',
          data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Agent },
        },
        { id: 'temp-edge', source: 'temp-node', target: 'pending-agent', data: {} },
      ],
    }
    mockGetNodes.mockReturnValue([
      { id: 'n1', position: { x: 0, y: 0 }, data: { type: BlockEnum.Start } },
      {
        id: 'pending-agent',
        position: { x: 1, y: 1 },
        data: {
          type: BlockEnum.Agent,
          title: 'Agent',
          desc: '',
          agent_node_kind: 'dify_agent',
          version: '2',
          agent_binding: {
            binding_type: 'inline_agent',
          },
          _isTempNode: true,
          _openInlineAgentPanel: true,
          selected: true,
        },
      },
      {
        id: 'temp-node',
        position: { x: 2, y: 2 },
        data: { type: BlockEnum.Answer, _isTempNode: true },
      },
    ])

    const { result } = renderUseNodesSyncDraft()

    await act(async () => {
      await result.current.doSyncWorkflowDraft(false)
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          graph: expect.objectContaining({
            nodes: [
              { id: 'n1', position: { x: 0, y: 0 }, data: { type: BlockEnum.Start } },
              {
                id: 'pending-agent',
                position: { x: 1, y: 1 },
                data: {
                  type: BlockEnum.Agent,
                  title: 'Agent',
                  desc: '',
                  agent_node_kind: 'dify_agent',
                  version: '2',
                  agent_binding: {
                    binding_type: 'inline_agent',
                  },
                  selected: true,
                },
              },
            ],
            edges: [
              {
                id: 'edge-1',
                source: 'n1',
                target: 'pending-agent',
                data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Agent },
              },
            ],
          }),
        }),
      }),
    )
  })

  it('should post workflow draft with keepalive when the page closes', () => {
    reactFlowState = {
      ...reactFlowState,
      transform: [1, 2, 3],
    }
    workflowStoreState = {
      ...workflowStoreState,
      conversationVariables: [{ id: 'conversation-1' }],
    }

    const { result } = renderUseNodesSyncDraft()

    act(() => {
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockPostWithKeepalive).toHaveBeenCalledWith(
      '/api/apps/app-1/workflows/draft',
      expect.objectContaining({
        graph: expect.objectContaining({
          viewport: { x: 1, y: 2, zoom: 3 },
        }),
        hash: 'hash-123',
      }),
    )
  })

  it('should skip draft persistence without reporting an error while the app is being deleted', async () => {
    const callbacks = {
      onError: vi.fn(),
      onSettled: vi.fn(),
    }
    markAppDeletionStarted('app-1')

    try {
      const { result } = renderUseNodesSyncDraft()

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, callbacks)
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(mockPostWithKeepalive).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    } finally {
      markAppDeletionFailed('app-1')
    }
  })

  it('should not report an in-flight draft failure after app deletion starts', async () => {
    let rejectSync!: (reason?: unknown) => void
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    mockSyncWorkflowDraft.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSync = reject
          resolveStarted()
        }),
    )
    const callbacks = {
      onError: vi.fn(),
      onSettled: vi.fn(),
    }
    const { result } = renderUseNodesSyncDraft()
    let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      syncPromise = result.current.doSyncWorkflowDraft(false, callbacks)
    })
    await started
    markAppDeletionStarted('app-1')

    try {
      await act(async () => {
        rejectSync(new Error('App not found'))
        await syncPromise
      })

      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    } finally {
      markAppDeletionFailed('app-1')
    }
  })

  it('should not post the local start placeholder when the page closes', () => {
    reactFlowState = {
      ...reactFlowState,
      edges: [{ id: 'placeholder-edge', source: 'start-placeholder', target: 'n1', data: {} }],
    }
    mockGetNodes.mockReturnValue([
      {
        id: 'start-placeholder',
        position: { x: 0, y: 0 },
        data: { type: BlockEnum.StartPlaceholder },
      },
      { id: 'n1', position: { x: 1, y: 1 }, data: { type: BlockEnum.Start } },
    ])

    const { result } = renderUseNodesSyncDraft()

    act(() => {
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockPostWithKeepalive).toHaveBeenCalledWith(
      '/api/apps/app-1/workflows/draft',
      expect.objectContaining({
        graph: expect.objectContaining({
          nodes: [{ id: 'n1', position: { x: 1, y: 1 }, data: { type: BlockEnum.Start } }],
          edges: [],
        }),
      }),
    )
  })

  it('should wait for the leader save result when current user is collaboration follower', async () => {
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(true)
    mockCollaborationGetIsLeader.mockReturnValue(false)
    const callbacks = {
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onSettled: vi.fn(),
    }

    const { result } = renderUseNodesSyncDraft()

    await act(async () => {
      await result.current.doSyncWorkflowDraft(false, callbacks)
    })

    expect(mockCollaborationRequestWorkflowSync).toHaveBeenCalled()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('remote-hash')
    expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith(2)
    expect(callbacks.onSuccess).toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalled()
  })

  it('should report a failed leader save to the follower caller', async () => {
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(true)
    mockCollaborationGetIsLeader.mockReturnValue(false)
    mockCollaborationRequestWorkflowSync.mockRejectedValue(new Error('sync timeout'))
    const callbacks = {
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onSettled: vi.fn(),
    }

    const { result } = renderUseNodesSyncDraft()

    let syncResult: unknown
    await act(async () => {
      syncResult = await result.current.doSyncWorkflowDraft(false, callbacks)
    })

    expect(syncResult).toBeNull()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(callbacks.onSuccess).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalled()
  })

  it('pauses follower saves when the selected saver reports a draft conflict', async () => {
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(true)
    mockCollaborationGetIsLeader.mockReturnValue(false)
    mockCollaborationRequestWorkflowSync.mockRejectedValueOnce(new Error('draft_workflow_not_sync'))
    const { result } = renderUseNodesSyncDraft()

    await act(async () => {
      await result.current.doSyncWorkflowDraft()
      await result.current.doSyncWorkflowDraft()
      await result.current.doSyncWorkflowDraft(false, undefined, { forceLocal: true })
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockCollaborationRequestWorkflowSync).toHaveBeenCalledOnce()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockPostWithKeepalive).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
  })

  it('should force a directed sync request to save locally even before leader status arrives', async () => {
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(true)
    mockCollaborationGetIsLeader.mockReturnValue(false)

    const { result } = renderUseNodesSyncDraft()

    await act(async () => {
      await result.current.doSyncWorkflowDraft(false, undefined, { forceLocal: true })
    })

    expect(mockCollaborationRequestWorkflowSync).not.toHaveBeenCalled()
    expect(mockSyncWorkflowDraft).toHaveBeenCalled()
  })

  it('should not queue a directed local save behind the requester waiting for its ack', async () => {
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(true)
    mockCollaborationGetIsLeader.mockReturnValue(false)
    let resolveRemoteSync: ((result: { hash: string; updatedAt: number }) => void) | undefined
    mockCollaborationRequestWorkflowSync.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRemoteSync = resolve
      }),
    )
    const { result } = renderUseNodesSyncDraft()

    let requesterSync: Promise<unknown> | undefined
    await act(async () => {
      requesterSync = result.current.doSyncWorkflowDraft()
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.doSyncWorkflowDraft(false, undefined, { forceLocal: true })
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(1)

    resolveRemoteSync?.({ hash: 'remote-hash', updatedAt: 2 })
    await act(async () => {
      await requesterSync
    })
  })

  it('should not persist an untrusted collaborative graph', async () => {
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(true)
    mockCollaborationGetIsLeader.mockReturnValue(true)
    mockCollaborationCanPersistLocalGraph.mockReturnValue(false)
    const callbacks = {
      onError: vi.fn(),
      onSettled: vi.fn(),
    }

    const { result } = renderUseNodesSyncDraft()

    let syncResult: unknown
    await act(async () => {
      syncResult = await result.current.doSyncWorkflowDraft(false, callbacks)
    })

    expect(syncResult).toBeNull()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalled()
  })

  it('should skip keepalive sync on page close when current user is collaboration follower', () => {
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(true)
    mockCollaborationGetIsLeader.mockReturnValue(false)
    mockCollaborationCanFlushGraphOnPageClose.mockReturnValue(false)

    const { result } = renderUseNodesSyncDraft()

    act(() => {
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockPostWithKeepalive).not.toHaveBeenCalled()
  })

  it('should allow the trusted sole leader to flush with keepalive while hidden', () => {
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(true)
    mockCollaborationGetIsLeader.mockReturnValue(true)
    mockCollaborationCanFlushGraphOnPageClose.mockReturnValue(true)

    const { result } = renderUseNodesSyncDraft()

    act(() => {
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockPostWithKeepalive).toHaveBeenCalledTimes(1)
  })

  it('should still flush with keepalive on page close when collaboration is enabled but never connected', () => {
    // Without a connection there is no leader election, so the collaborative flush guard can never
    // be satisfied. Skipping the save here would silently drop the edits made before leaving.
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(false)
    mockCollaborationGetIsLeader.mockReturnValue(false)
    mockCollaborationCanFlushGraphOnPageClose.mockReturnValue(false)
    mockCollaborationCanUseLocalDraftFallback.mockReturnValue(true)

    const { result } = renderUseNodesSyncDraft()

    act(() => {
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockPostWithKeepalive).toHaveBeenCalledTimes(1)
  })

  it('should not flush an untrusted graph after an established collaboration disconnects', () => {
    isCollaborationEnabled = true
    mockCollaborationIsConnected.mockReturnValue(false)
    mockCollaborationCanFlushGraphOnPageClose.mockReturnValue(false)
    mockCollaborationCanUseLocalDraftFallback.mockReturnValue(false)

    const { result } = renderUseNodesSyncDraft()

    act(() => {
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockPostWithKeepalive).not.toHaveBeenCalled()
  })
})
