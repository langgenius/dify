import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import { useWorkflowRefreshDraft } from '../use-workflow-refresh-draft'

const mockHandleUpdateWorkflowCanvas = vi.fn()
const mockSetSyncWorkflowDraftHash = vi.fn()
const mockSetIsSyncingWorkflowDraft = vi.fn()
const mockSetEnvironmentVariables = vi.fn()
const mockSetEnvSecrets = vi.fn()
const mockSetConversationVariables = vi.fn()
const mockSetIsWorkflowDataLoaded = vi.fn()
const mockCancel = vi.fn()
let draftStore: ReturnType<typeof createWorkflowStore>
let appStoreState: {
  appDetail: {
    mode: string
  }
}

let workflowStoreState: {
  appId: string
  isWorkflowDataLoaded: boolean
  isSyncingWorkflowDraft: boolean
  debouncedSyncWorkflowDraft?: { cancel: () => void }
  setSyncWorkflowDraftHash: typeof mockSetSyncWorkflowDraftHash
  setIsSyncingWorkflowDraft: typeof mockSetIsSyncingWorkflowDraft
  setEnvironmentVariables: typeof mockSetEnvironmentVariables
  setEnvSecrets: typeof mockSetEnvSecrets
  setConversationVariables: typeof mockSetConversationVariables
  setIsWorkflowDataLoaded: typeof mockSetIsWorkflowDataLoaded
}

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      ...workflowStoreState,
      workflowDraftGeneration: draftStore.getState().workflowDraftGeneration,
      invalidateWorkflowDraftSync: draftStore.getState().invalidateWorkflowDraftSync,
    }),
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: <T>(selector: (state: typeof appStoreState) => T): T => selector(appStoreState),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({ handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas }),
}))

const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

const draftResponse = {
  hash: 'server-hash',
  graph: { nodes: [{ id: 'n1' }], edges: [], viewport: { x: 1, y: 2, zoom: 1 } },
  environment_variables: [],
  conversation_variables: [],
}

describe('useWorkflowRefreshDraft — notUpdateCanvas parameter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    draftStore = createWorkflowStore({})
    vi.spyOn(draftStore.getState().debouncedSyncWorkflowDraft, 'cancel').mockImplementation(
      mockCancel,
    )
    mockHandleUpdateWorkflowCanvas.mockReturnValue(true)
    workflowStoreState = {
      appId: 'app-1',
      isWorkflowDataLoaded: true,
      isSyncingWorkflowDraft: false,
      debouncedSyncWorkflowDraft: undefined,
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft: mockSetIsSyncingWorkflowDraft,
      setEnvironmentVariables: mockSetEnvironmentVariables,
      setEnvSecrets: mockSetEnvSecrets,
      setConversationVariables: mockSetConversationVariables,
      setIsWorkflowDataLoaded: mockSetIsWorkflowDataLoaded,
    }
    appStoreState = {
      appDetail: { mode: AppModeEnum.ADVANCED_CHAT },
    }
    mockFetchWorkflowDraft.mockResolvedValue(draftResponse)
    mockSetIsSyncingWorkflowDraft.mockImplementation((value: boolean) => {
      workflowStoreState.isSyncingWorkflowDraft = value
    })
  })

  it('should update canvas by default (notUpdateCanvas omitted)', async () => {
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    let refreshed = false
    await act(async () => {
      refreshed = await result.current.handleRefreshWorkflowDraft()
    })
    expect(refreshed).toBe(true)
    expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledTimes(1)
  })

  it('should update canvas when notUpdateCanvas=false', async () => {
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    await act(async () => {
      result.current.handleRefreshWorkflowDraft(false)
    })
    expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledTimes(1)
  })

  it('should NOT update canvas when notUpdateCanvas=true', async () => {
    // This is the key change: when called from a 409 error during editing,
    // canvas must not be overwritten with server state.
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    await act(async () => {
      result.current.handleRefreshWorkflowDraft(true)
    })
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
  })

  it('should discard a stale guarded response before it mutates the canvas or draft metadata', async () => {
    let resolveFetch: ((value: typeof draftResponse) => void) | undefined
    mockFetchWorkflowDraft.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    let isCurrent = true
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    let refreshPromise: Promise<boolean> | undefined

    act(() => {
      refreshPromise = result.current.handleRefreshWorkflowDraft(false, {
        shouldApply: () => isCurrent,
      })
    })
    isCurrent = false
    await act(async () => {
      resolveFetch?.(draftResponse)
      await refreshPromise
    })

    await expect(refreshPromise).resolves.toBe(false)
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
    expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
    expect(mockSetConversationVariables).not.toHaveBeenCalled()
  })

  it('keeps the syncing guard active until the newest overlapping refresh completes', async () => {
    let resolveFirst: ((value: typeof draftResponse) => void) | undefined
    let resolveSecond: ((value: typeof draftResponse) => void) | undefined
    mockFetchWorkflowDraft
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve
        }),
      )
    let firstIsCurrent = true
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    let firstRefresh: Promise<boolean> | undefined
    let secondRefresh: Promise<boolean> | undefined

    act(() => {
      firstRefresh = result.current.handleRefreshWorkflowDraft(false, {
        shouldApply: () => firstIsCurrent,
      })
      secondRefresh = result.current.handleRefreshWorkflowDraft(false, {
        shouldApply: () => true,
      })
    })
    firstIsCurrent = false
    mockSetIsSyncingWorkflowDraft.mockClear()

    await act(async () => {
      resolveFirst?.(draftResponse)
      await firstRefresh
    })
    expect(mockSetIsSyncingWorkflowDraft).not.toHaveBeenCalledWith(false)

    await act(async () => {
      resolveSecond?.(draftResponse)
      await secondRefresh
    })
    expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)
  })

  it('keeps the old graph baseline during a metadata-only conflict refresh', async () => {
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    await act(async () => {
      result.current.handleRefreshWorkflowDraft(true)
    })
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
    expect(mockSetEnvironmentVariables).toHaveBeenCalled()
  })

  it('should cancel pending draft sync, use fallback viewport, and persist masked secrets', async () => {
    workflowStoreState = {
      ...workflowStoreState,
      debouncedSyncWorkflowDraft: { cancel: mockCancel },
    }
    mockFetchWorkflowDraft.mockResolvedValue({
      hash: 'server-hash',
      graph: {
        nodes: [{ id: 'n1' }],
        edges: [],
      },
      environment_variables: [
        { id: 'env-secret', value_type: 'secret', value: 'top-secret', name: 'SECRET' },
        { id: 'env-plain', value_type: 'text', value: 'visible', name: 'PLAIN' },
      ],
      conversation_variables: [{ id: 'conversation-1' }],
    })

    const { result } = renderHook(() => useWorkflowRefreshDraft())

    act(() => {
      result.current.handleRefreshWorkflowDraft()
    })

    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalled()
      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith(
        {
          nodes: [{ id: 'n1' }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        expect.objectContaining({ syncToCollaboration: true }),
      )
      expect(mockSetEnvSecrets).toHaveBeenCalledWith({
        'env-secret': 'top-secret',
      })
      expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([
        { id: 'env-secret', value_type: 'secret', value: '[__HIDDEN__]', name: 'SECRET' },
        { id: 'env-plain', value_type: 'text', value: 'visible', name: 'PLAIN' },
      ])
      expect(mockSetConversationVariables).toHaveBeenCalledWith([{ id: 'conversation-1' }])
    })
  })

  it('should restore a local start placeholder for workflow drafts without an entry node', async () => {
    appStoreState = {
      appDetail: { mode: AppModeEnum.WORKFLOW },
    }
    mockFetchWorkflowDraft.mockResolvedValue({
      hash: 'server-hash',
      graph: {
        nodes: [],
        edges: [],
      },
      environment_variables: [],
      conversation_variables: [],
    })

    const { result } = renderHook(() => useWorkflowRefreshDraft())

    act(() => {
      result.current.handleRefreshWorkflowDraft()
    })

    await waitFor(() => {
      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith(
        {
          nodes: [
            expect.objectContaining({
              data: expect.objectContaining({
                type: BlockEnum.StartPlaceholder,
                title: 'workflow.blocks.start-placeholder',
                desc: '',
                selected: true,
              }),
            }),
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        expect.objectContaining({ syncToCollaboration: true }),
      )
    })
  })

  it('should not restore a local start placeholder for non-workflow app modes', async () => {
    mockFetchWorkflowDraft.mockResolvedValue({
      hash: 'server-hash',
      graph: {
        nodes: [],
        edges: [],
      },
      environment_variables: [],
      conversation_variables: [],
    })

    const { result } = renderHook(() => useWorkflowRefreshDraft())

    act(() => {
      result.current.handleRefreshWorkflowDraft()
    })

    await waitFor(() => {
      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith(
        {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        expect.objectContaining({ syncToCollaboration: true }),
      )
    })
  })

  it('should restore loaded state when refresh fails after workflow data was already loaded', async () => {
    mockFetchWorkflowDraft.mockRejectedValue(new Error('refresh failed'))

    const { result } = renderHook(() => useWorkflowRefreshDraft())

    let refreshed = true
    await act(async () => {
      refreshed = await result.current.handleRefreshWorkflowDraft()
    })

    expect(refreshed).toBe(false)

    await waitFor(() => {
      expect(mockSetIsWorkflowDataLoaded).not.toHaveBeenCalled()
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenCalledWith(true)
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)
    })
  })

  it('does not adopt the server hash when the canvas cannot apply the graph', async () => {
    mockHandleUpdateWorkflowCanvas.mockReturnValue(false)
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    expect(await result.current.handleRefreshWorkflowDraft()).toBe(false)
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
  })

  it('ignores an older refresh from another hook instance', async () => {
    let resolveOldResponse!: (value: typeof draftResponse) => void
    mockFetchWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOldResponse = resolve
      }),
    )
    const first = renderHook(() => useWorkflowRefreshDraft())
    const second = renderHook(() => useWorkflowRefreshDraft())
    const oldRefresh = first.result.current.handleRefreshWorkflowDraft()
    expect(await second.result.current.handleRefreshWorkflowDraft()).toBe(true)
    resolveOldResponse({ ...draftResponse, hash: 'outdated' })
    expect(await oldRefresh).toBe(false)
    expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledOnce()
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledExactlyOnceWith('server-hash')
  })

  it('does not let a visibility metadata refresh cancel the generated graph reload', async () => {
    let resolveResponse!: (value: typeof draftResponse) => void
    mockFetchWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve
      }),
    )
    const full = renderHook(() => useWorkflowRefreshDraft())
    const metadata = renderHook(() => useWorkflowRefreshDraft())
    const refreshing = full.result.current.handleRefreshWorkflowDraft()
    expect(await metadata.result.current.handleRefreshWorkflowDraft(true)).toBe(false)
    expect(mockFetchWorkflowDraft).toHaveBeenCalledOnce()
    resolveResponse(draftResponse)
    expect(await refreshing).toBe(true)
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('server-hash')
  })
})
