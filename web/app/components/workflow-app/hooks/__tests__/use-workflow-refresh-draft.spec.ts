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
    id: string
    mode: string
  }
}

let workflowStoreState: {
  appId: string
  isWorkflowDataLoaded: boolean
  debouncedSyncWorkflowDraft?: { cancel: () => void }
  setSyncWorkflowDraftHash: typeof mockSetSyncWorkflowDraftHash
  setIsSyncingWorkflowDraft: typeof mockSetIsSyncingWorkflowDraft
  setEnvironmentVariables: typeof mockSetEnvironmentVariables
  setEnvSecrets: typeof mockSetEnvSecrets
  setConversationVariables: typeof mockSetConversationVariables
  setIsWorkflowDataLoaded: typeof mockSetIsWorkflowDataLoaded
}

const mockWorkflowStore = { getState: () => workflowStoreState }

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => mockWorkflowStore,
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

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useWorkflowRefreshDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowStoreState = {
      appId: 'app-1',
      isWorkflowDataLoaded: true,
      debouncedSyncWorkflowDraft: undefined,
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft: mockSetIsSyncingWorkflowDraft,
      setEnvironmentVariables: mockSetEnvironmentVariables,
      setEnvSecrets: mockSetEnvSecrets,
      setConversationVariables: mockSetConversationVariables,
      setIsWorkflowDataLoaded: mockSetIsWorkflowDataLoaded,
    }
    appStoreState = {
      appDetail: { id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT },
    }
    mockFetchWorkflowDraft.mockResolvedValue(draftResponse)
    mockSetIsWorkflowDataLoaded.mockImplementation((loaded: boolean) => {
      workflowStoreState.isWorkflowDataLoaded = loaded
    })
  })

  it.each(['resolve', 'reject'] as const)(
    'ignores a late %s after the editor unmounts',
    async (outcome) => {
      const pending = createDeferred<typeof draftResponse>()
      mockFetchWorkflowDraft.mockReturnValue(pending.promise)
      const { result, unmount } = renderHook(() => useWorkflowRefreshDraft())
      const refresh = result.current.handleRefreshWorkflowDraft
      let refreshPromise: Promise<boolean>
      act(() => {
        refreshPromise = refresh()
      })
      unmount()
      vi.clearAllMocks()

      await act(async () => {
        if (outcome === 'resolve') pending.resolve(draftResponse)
        else pending.reject(new Error('late failure'))
        await expect(refreshPromise).resolves.toBe(false)
      })
      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
      expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
      expect(mockSetEnvSecrets).not.toHaveBeenCalled()
      expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
      expect(mockSetConversationVariables).not.toHaveBeenCalled()
      expect(mockSetIsWorkflowDataLoaded).not.toHaveBeenCalled()
      expect(mockSetIsSyncingWorkflowDraft).not.toHaveBeenCalled()
      await expect(refresh()).resolves.toBe(false)
      expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
    },
  )

  it.each(['resolve', 'reject'] as const)(
    'discards the previous app %s and refuses its retained refresh callback after switching apps',
    async (outcome) => {
      const pending = createDeferred<typeof draftResponse>()
      mockFetchWorkflowDraft.mockReturnValueOnce(pending.promise)
      const { result, rerender } = renderHook(() => useWorkflowRefreshDraft())
      const refreshPreviousApp = result.current.handleRefreshWorkflowDraft
      let refreshPromise: Promise<boolean>
      act(() => {
        refreshPromise = refreshPreviousApp()
      })
      appStoreState.appDetail = { id: 'app-2', mode: AppModeEnum.ADVANCED_CHAT }
      workflowStoreState.appId = 'app-2'
      rerender()
      vi.clearAllMocks()

      await act(async () => {
        if (outcome === 'resolve') pending.resolve(draftResponse)
        else pending.reject(new Error('previous app failure'))
        await expect(refreshPromise).resolves.toBe(false)
      })
      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
      expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
      expect(mockSetIsSyncingWorkflowDraft).not.toHaveBeenCalled()
      expect(mockSetIsWorkflowDataLoaded).not.toHaveBeenCalled()
      await expect(refreshPreviousApp()).resolves.toBe(false)
      expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()

      await act(async () => {
        await expect(result.current.handleRefreshWorkflowDraft()).resolves.toBe(true)
      })
      expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('/apps/app-2/workflows/draft')
      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['resolve', 'reject'] as const)(
    'ignores an older overlapping refresh %s while the latest request is pending',
    async (outcome) => {
      const first = createDeferred<typeof draftResponse>()
      const latest = createDeferred<typeof draftResponse>()
      mockFetchWorkflowDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise)
      const { result } = renderHook(() => useWorkflowRefreshDraft())
      let firstRefresh: Promise<boolean>
      let latestRefresh: Promise<boolean>
      act(() => {
        firstRefresh = result.current.handleRefreshWorkflowDraft()
        latestRefresh = result.current.handleRefreshWorkflowDraft()
      })
      vi.clearAllMocks()

      await act(async () => {
        if (outcome === 'resolve') first.resolve(draftResponse)
        else first.reject(new Error('older failure'))
        await expect(firstRefresh).resolves.toBe(false)
      })
      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
      expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
      expect(mockSetIsWorkflowDataLoaded).not.toHaveBeenCalled()
      expect(mockSetIsSyncingWorkflowDraft).not.toHaveBeenCalled()

      await act(async () => {
        latest.resolve({ ...draftResponse, hash: 'latest-hash' })
        await expect(latestRefresh).resolves.toBe(true)
      })
      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledTimes(1)
      expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('latest-hash')
      expect(mockSetIsWorkflowDataLoaded).toHaveBeenLastCalledWith(true)
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)
    },
  )

  it('restores the loaded draft when the latest overlapping refresh fails', async () => {
    const first = createDeferred<typeof draftResponse>()
    const latest = createDeferred<typeof draftResponse>()
    mockFetchWorkflowDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise)
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    let firstRefresh: Promise<boolean>
    let latestRefresh: Promise<boolean>
    act(() => {
      firstRefresh = result.current.handleRefreshWorkflowDraft()
      latestRefresh = result.current.handleRefreshWorkflowDraft()
    })

    await act(async () => {
      latest.reject(new Error('latest failure'))
      await expect(latestRefresh).resolves.toBe(false)
    })
    expect(workflowStoreState.isWorkflowDataLoaded).toBe(true)
    expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)

    await act(async () => {
      first.resolve(draftResponse)
      await expect(firstRefresh).resolves.toBe(false)
    })
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
  })

  it.each(['reject', 'discard'] as const)(
    'restores saving when a guarded refresh takes over a paused refresh and must %s',
    async (outcome) => {
      const first = createDeferred<typeof draftResponse>()
      const guarded = createDeferred<typeof draftResponse>()
      mockFetchWorkflowDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(guarded.promise)
      const { result } = renderHook(() => useWorkflowRefreshDraft())
      let firstRefresh: Promise<boolean>
      let guardedRefresh: Promise<boolean>
      let shouldApply = true
      act(() => {
        firstRefresh = result.current.handleRefreshWorkflowDraft()
        guardedRefresh = result.current.handleRefreshWorkflowDraft(false, {
          shouldApply: () => shouldApply,
        })
      })
      expect(workflowStoreState.isWorkflowDataLoaded).toBe(false)

      await act(async () => {
        if (outcome === 'reject') guarded.reject(new Error('guarded failure'))
        else {
          shouldApply = false
          guarded.resolve(draftResponse)
        }
        await expect(guardedRefresh).resolves.toBe(false)
      })
      expect(workflowStoreState.isWorkflowDataLoaded).toBe(true)
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)

      await act(async () => {
        first.resolve(draftResponse)
        await expect(firstRefresh).resolves.toBe(false)
      })
      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    },
  )

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

  it('should still update hash even when notUpdateCanvas=true', async () => {
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    await act(async () => {
      result.current.handleRefreshWorkflowDraft(true)
    })
    await waitFor(() => {
      expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('server-hash')
    })
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
      appDetail: { id: 'app-1', mode: AppModeEnum.WORKFLOW },
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
})
