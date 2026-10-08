import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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
let appStoreState: {
  appDetail: {
    mode: string
  }
}

let workflowStoreState: {
  appId: string
  isWorkflowDataLoaded: boolean
  syncWorkflowDraftHash: string
  debouncedSyncWorkflowDraft?: { cancel: () => void }
  setSyncWorkflowDraftHash: typeof mockSetSyncWorkflowDraftHash
  setIsSyncingWorkflowDraft: typeof mockSetIsSyncingWorkflowDraft
  setEnvironmentVariables: typeof mockSetEnvironmentVariables
  setEnvSecrets: typeof mockSetEnvSecrets
  setConversationVariables: typeof mockSetConversationVariables
  setIsWorkflowDataLoaded: typeof mockSetIsWorkflowDataLoaded
}
let workflowStore: { getState: () => typeof workflowStoreState }

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => workflowStore,
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

const createPendingDraft = () => {
  let resolve!: (value: typeof draftResponse) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<typeof draftResponse>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useWorkflowRefreshDraft — notUpdateCanvas parameter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowStoreState = {
      appId: 'app-1',
      isWorkflowDataLoaded: true,
      syncWorkflowDraftHash: 'initial-hash',
      debouncedSyncWorkflowDraft: undefined,
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft: mockSetIsSyncingWorkflowDraft,
      setEnvironmentVariables: mockSetEnvironmentVariables,
      setEnvSecrets: mockSetEnvSecrets,
      setConversationVariables: mockSetConversationVariables,
      setIsWorkflowDataLoaded: mockSetIsWorkflowDataLoaded,
    }
    workflowStore = { getState: () => workflowStoreState }
    mockSetIsWorkflowDataLoaded.mockImplementation((loaded: boolean) => {
      workflowStoreState.isWorkflowDataLoaded = loaded
    })
    mockSetSyncWorkflowDraftHash.mockImplementation((hash: string) => {
      workflowStoreState.syncWorkflowDraftHash = hash
    })
    appStoreState = {
      appDetail: { mode: AppModeEnum.ADVANCED_CHAT },
    }
    mockFetchWorkflowDraft.mockResolvedValue(draftResponse)
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

  it('updates metadata without replacing the canvas when notUpdateCanvas is true', async () => {
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    let refreshed = false
    await act(async () => {
      refreshed = await result.current.handleRefreshWorkflowDraft(true)
    })
    expect(refreshed).toBe(true)
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledExactlyOnceWith('server-hash')
  })

  it('should discard a stale guarded response before it mutates the canvas or draft metadata', async () => {
    let resolveFetch: ((value: typeof draftResponse) => void) | undefined
    mockFetchWorkflowDraft.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    let isCurrent = true
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    let refreshPromise: Promise<boolean> | undefined

    act(() => {
      refreshPromise = result.current.handleRefreshWorkflowDraft(false, {
        shouldApply: () => isCurrent,
        onSuccess,
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
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('applies additional draft data only after the response passes its guard', async () => {
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useWorkflowRefreshDraft())

    await act(async () => {
      await result.current.handleRefreshWorkflowDraft(false, { shouldApply: () => true, onSuccess })
    })

    expect(onSuccess).toHaveBeenCalledExactlyOnceWith(draftResponse)
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

  it('should still update hash even when notUpdateCanvas=true', async () => {
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    await act(async () => {
      result.current.handleRefreshWorkflowDraft(true)
    })
    await waitFor(() => {
      expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('server-hash')
    })
  })

  it('does not change the hash for a rejected metadata-only refresh', async () => {
    const pending = createPendingDraft()
    mockFetchWorkflowDraft.mockReturnValue(pending.promise)
    let shouldApply = true
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    const refresh = result.current.handleRefreshWorkflowDraft(true, {
      shouldApply: () => shouldApply,
    })
    shouldApply = false

    await act(async () => {
      pending.resolve(draftResponse)
      await refresh
    })

    await expect(refresh).resolves.toBe(false)
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
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
      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
        nodes: [{ id: 'n1' }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      })
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
      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
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
      })
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
      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      })
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
      expect(mockSetIsWorkflowDataLoaded).toHaveBeenNthCalledWith(1, false)
      expect(mockSetIsWorkflowDataLoaded).toHaveBeenNthCalledWith(2, true)
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenCalledWith(true)
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)
    })
  })

  it('keeps the newer graph and hash when an older empty response arrives from another hook', async () => {
    const first = createPendingDraft()
    const second = createPendingDraft()
    mockFetchWorkflowDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const firstHook = renderHook(() => useWorkflowRefreshDraft())
    const secondHook = renderHook(() => useWorkflowRefreshDraft())
    const firstRefresh = firstHook.result.current.handleRefreshWorkflowDraft()
    const secondRefresh = secondHook.result.current.handleRefreshWorkflowDraft()

    await act(async () => {
      second.resolve(draftResponse)
      await secondRefresh
    })
    vi.clearAllMocks()
    await act(async () => {
      first.resolve({
        ...draftResponse,
        hash: 'old-empty-hash',
        graph: { ...draftResponse.graph, nodes: [] },
      })
      await firstRefresh
    })

    await expect(firstRefresh).resolves.toBe(false)
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
    expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
    expect(mockSetEnvSecrets).not.toHaveBeenCalled()
    expect(mockSetConversationVariables).not.toHaveBeenCalled()
    expect(mockSetIsWorkflowDataLoaded).not.toHaveBeenCalled()
    expect(mockSetIsSyncingWorkflowDraft).not.toHaveBeenCalled()
  })

  it('keeps saving paused after an older failure and restores it if the newest request also fails', async () => {
    const first = createPendingDraft()
    const second = createPendingDraft()
    mockFetchWorkflowDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const firstHook = renderHook(() => useWorkflowRefreshDraft())
    const secondHook = renderHook(() => useWorkflowRefreshDraft())
    const firstRefresh = firstHook.result.current.handleRefreshWorkflowDraft()
    const secondRefresh = secondHook.result.current.handleRefreshWorkflowDraft()
    vi.clearAllMocks()

    await act(async () => {
      first.reject(new Error('older request failed'))
      await firstRefresh
    })
    expect(workflowStoreState.isWorkflowDataLoaded).toBe(false)
    expect(mockSetIsWorkflowDataLoaded).not.toHaveBeenCalled()
    expect(mockSetIsSyncingWorkflowDraft).not.toHaveBeenCalled()

    await act(async () => {
      second.reject(new Error('newest request failed'))
      await secondRefresh
    })
    expect(workflowStoreState.isWorkflowDataLoaded).toBe(true)
    expect(mockSetIsWorkflowDataLoaded).toHaveBeenCalledExactlyOnceWith(true)
    expect(mockSetIsSyncingWorkflowDraft).toHaveBeenCalledExactlyOnceWith(false)
  })

  it.each(['resolve', 'reject'] as const)(
    'ignores a request that %s after its owner unmounts',
    async (settlement) => {
      const pending = createPendingDraft()
      mockFetchWorkflowDraft.mockReturnValue(pending.promise)
      const { result, unmount } = renderHook(() => useWorkflowRefreshDraft())
      const refresh = result.current.handleRefreshWorkflowDraft()
      unmount()
      vi.clearAllMocks()

      await act(async () => {
        if (settlement === 'resolve') pending.resolve(draftResponse)
        else pending.reject(new Error('late failure'))
        await refresh
      })

      await expect(refresh).resolves.toBe(false)
      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
      expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
      expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
      expect(mockSetEnvSecrets).not.toHaveBeenCalled()
      expect(mockSetConversationVariables).not.toHaveBeenCalled()
      expect(mockSetIsWorkflowDataLoaded).not.toHaveBeenCalled()
      expect(mockSetIsSyncingWorkflowDraft).not.toHaveBeenCalled()
    },
  )

  it.each(['resolve', 'reject'] as const)(
    'ignores a request that %s after the store switches to another app',
    async (settlement) => {
      const pending = createPendingDraft()
      mockFetchWorkflowDraft.mockReturnValue(pending.promise)
      const { result } = renderHook(() => useWorkflowRefreshDraft())
      const refresh = result.current.handleRefreshWorkflowDraft()
      workflowStoreState.appId = 'app-2'
      vi.clearAllMocks()

      await act(async () => {
        if (settlement === 'resolve') pending.resolve(draftResponse)
        else pending.reject(new Error('late failure'))
        await refresh
      })

      await expect(refresh).resolves.toBe(false)
      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
      expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
      expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
      expect(mockSetIsWorkflowDataLoaded).not.toHaveBeenCalled()
      expect(mockSetIsSyncingWorkflowDraft).not.toHaveBeenCalled()
    },
  )

  it('does not release the newer hook’s saving guard when the older owner unmounts', async () => {
    const first = createPendingDraft()
    const second = createPendingDraft()
    mockFetchWorkflowDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const firstHook = renderHook(() => useWorkflowRefreshDraft())
    const secondHook = renderHook(() => useWorkflowRefreshDraft())
    const firstRefresh = firstHook.result.current.handleRefreshWorkflowDraft()
    const secondRefresh = secondHook.result.current.handleRefreshWorkflowDraft()
    vi.clearAllMocks()

    firstHook.unmount()
    expect(mockSetIsWorkflowDataLoaded).not.toHaveBeenCalled()
    expect(mockSetIsSyncingWorkflowDraft).not.toHaveBeenCalled()
    await act(async () => {
      first.resolve(draftResponse)
      second.resolve(draftResponse)
      await Promise.all([firstRefresh, secondRefresh])
    })
    expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledTimes(1)
  })

  it('keeps a successful local save when an older empty GET completes afterward', async () => {
    const pending = createPendingDraft()
    mockFetchWorkflowDraft.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    const refresh = result.current.handleRefreshWorkflowDraft()
    workflowStoreState.setSyncWorkflowDraftHash('saved-nonempty-hash')
    vi.clearAllMocks()

    await act(async () => {
      pending.resolve({
        ...draftResponse,
        hash: 'initial-hash',
        graph: { ...draftResponse.graph, nodes: [] },
      })
      await refresh
    })

    await expect(refresh).resolves.toBe(false)
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
    expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
    expect(mockSetConversationVariables).not.toHaveBeenCalled()
    expect(workflowStoreState.syncWorkflowDraftHash).toBe('saved-nonempty-hash')
    expect(workflowStoreState.isWorkflowDataLoaded).toBe(true)
    expect(mockSetIsSyncingWorkflowDraft).toHaveBeenCalledExactlyOnceWith(false)
  })
})
