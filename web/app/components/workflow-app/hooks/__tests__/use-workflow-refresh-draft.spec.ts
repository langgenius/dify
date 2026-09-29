import type { WorkflowDraftReplacedEvent } from '@/app/components/workflow/workflow-data-update-event'
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
const mockEventEmitterEmit = vi.fn()
const mockBeginCommittedReplacement = vi.fn()
const mockGetWorkflowReplacementSequence = vi.fn()
const mockIsWorkflowReplacementPending = vi.fn()
const mockBeginWorkflowReplacementIfUnchanged = vi.fn()
const mockIsWorkflowReplacementCurrent = vi.fn()
let appStoreState: {
  appDetail: {
    mode: string
  }
}

let workflowStoreState: {
  appId: string
  isWorkflowDataLoaded: boolean
  isSyncingWorkflowDraft: boolean
  syncWorkflowDraftHash: string
  lastAppliedReplacementId: string | null
  draftReplacementEpoch: number
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
    getState: () => workflowStoreState,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: <T>(selector: (state: typeof appStoreState) => T): T => selector(appStoreState),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({ handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas }),
}))

vi.mock('@/context/event-emitter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/event-emitter')>()
  return {
    ...actual,
    useEventEmitterContextContext: () => ({ eventEmitter: { emit: mockEventEmitterEmit } }),
  }
})

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    beginCommittedReplacement: (...args: unknown[]) => mockBeginCommittedReplacement(...args),
    getWorkflowReplacementSequence: (...args: unknown[]) =>
      mockGetWorkflowReplacementSequence(...args),
    isWorkflowReplacementPending: (...args: unknown[]) => mockIsWorkflowReplacementPending(...args),
    beginWorkflowReplacementIfUnchanged: (...args: unknown[]) =>
      mockBeginWorkflowReplacementIfUnchanged(...args),
    isWorkflowReplacementCurrent: (...args: unknown[]) => mockIsWorkflowReplacementCurrent(...args),
  },
}))

const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchAppWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

const draftResponse = {
  id: 'draft-1',
  hash: 'server-hash',
  last_replacement_id: null,
  graph: { nodes: [{ id: 'n1' }], edges: [], viewport: { x: 1, y: 2, zoom: 1 } },
  features: {},
  environment_variables: [],
  conversation_variables: [],
  rag_pipeline_variables: [],
  created_at: 0,
  updated_at: 0,
  tool_published: false,
  version: '1',
  marked_name: '',
  marked_comment: '',
}

describe('useWorkflowRefreshDraft — notUpdateCanvas parameter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEventEmitterEmit.mockReset()
    mockSetIsWorkflowDataLoaded.mockImplementation((loaded: boolean) => {
      workflowStoreState.isWorkflowDataLoaded = loaded
    })
    mockSetIsSyncingWorkflowDraft.mockImplementation((syncing: boolean) => {
      workflowStoreState.isSyncingWorkflowDraft = syncing
    })
    mockSetSyncWorkflowDraftHash.mockImplementation((hash: string) => {
      workflowStoreState.syncWorkflowDraftHash = hash
    })
    mockGetWorkflowReplacementSequence.mockReturnValue(null)
    mockIsWorkflowReplacementPending.mockReturnValue(false)
    mockIsWorkflowReplacementCurrent.mockReturnValue(false)
    workflowStoreState = {
      appId: 'app-1',
      isWorkflowDataLoaded: true,
      isSyncingWorkflowDraft: false,
      syncWorkflowDraftHash: 'initial-hash',
      lastAppliedReplacementId: null,
      draftReplacementEpoch: 0,
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
  })

  it('applies a newly imported draft through the authoritative event before advancing its hash', async () => {
    const importedDraft = {
      ...draftResponse,
      hash: 'imported-hash',
      last_replacement_id: 'import-B',
      graph: { nodes: [], edges: [], viewport: { x: 1, y: 2, zoom: 1 } },
      features: { opening_statement: 'Imported' },
      updated_at: 2,
      tool_published: false,
    }
    mockFetchWorkflowDraft.mockResolvedValue(importedDraft)
    mockEventEmitterEmit.mockImplementation(() => {
      expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalledWith('imported-hash')
      workflowStoreState.lastAppliedReplacementId = 'import-B'
      workflowStoreState.draftReplacementEpoch += 1
    })

    const { result } = renderHook(() => useWorkflowRefreshDraft())
    let refreshed = false
    await act(async () => {
      refreshed = await result.current.handleRefreshWorkflowDraft(true)
    })

    expect(refreshed).toBe(true)
    expect(mockEventEmitterEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          draft: importedDraft,
          appliedReplacementId: 'import-B',
        }),
      }),
    )
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
    expect(mockSetIsWorkflowDataLoaded).toHaveBeenCalledWith(false)
    expect(mockSetIsWorkflowDataLoaded).toHaveBeenLastCalledWith(true)
  })

  it('claims a conditional token before applying a newly observed import', async () => {
    mockGetWorkflowReplacementSequence.mockReturnValue(1)
    mockBeginWorkflowReplacementIfUnchanged.mockReturnValue(2)
    mockFetchWorkflowDraft.mockResolvedValue({
      ...draftResponse,
      last_replacement_id: 'import-B',
      graph: { nodes: [], edges: [], viewport: { x: 1, y: 2, zoom: 1 } },
    })
    mockEventEmitterEmit.mockImplementation(() => {
      workflowStoreState.lastAppliedReplacementId = 'import-B'
      workflowStoreState.draftReplacementEpoch += 1
    })
    const { result } = renderHook(() => useWorkflowRefreshDraft())

    await act(async () => {
      await result.current.handleRefreshWorkflowDraft(true)
    })

    expect(mockBeginWorkflowReplacementIfUnchanged).toHaveBeenCalledWith('app-1', 1)
    expect(mockEventEmitterEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ workflowReplacementToken: 2 }),
      }),
    )
  })

  it('discards a refresh response after a newer replacement token begins', async () => {
    mockGetWorkflowReplacementSequence.mockReturnValue(1)
    let resolveDraft!: (draft: unknown) => void
    mockFetchWorkflowDraft.mockReturnValue(
      new Promise((resolve) => {
        resolveDraft = resolve
      }),
    )
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    let refresh!: Promise<boolean>
    act(() => {
      refresh = result.current.handleRefreshWorkflowDraft(true)
    })
    await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalledOnce())
    mockGetWorkflowReplacementSequence.mockReturnValue(2)
    mockIsWorkflowReplacementPending.mockReturnValue(true)

    await act(async () => {
      resolveDraft({ ...draftResponse, last_replacement_id: 'import-B', hash: 'new-hash' })
      await expect(refresh).resolves.toBe(false)
    })
    expect(mockBeginWorkflowReplacementIfUnchanged).not.toHaveBeenCalled()
    expect(mockEventEmitterEmit).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
  })

  it('discards an older GET after a same-marker draft replacement has applied', async () => {
    workflowStoreState.lastAppliedReplacementId = 'import-A'
    let resolveFetch!: (draft: unknown) => void
    mockFetchWorkflowDraft.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )

    const { result } = renderHook(() => useWorkflowRefreshDraft())
    let refresh!: Promise<boolean>
    act(() => {
      refresh = result.current.handleRefreshWorkflowDraft(true)
    })
    await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalledOnce())

    workflowStoreState.draftReplacementEpoch += 1
    await act(async () => {
      resolveFetch({ ...draftResponse, last_replacement_id: 'import-A', hash: 'old-hash' })
      await expect(refresh).resolves.toBe(false)
    })

    expect(mockEventEmitterEmit).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
    expect(mockSetIsWorkflowDataLoaded).toHaveBeenLastCalledWith(true)
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

  it.each(['older first', 'newer first'])(
    'keeps the newest overlapping refresh after replacement responses arrive %s',
    async (responseOrder) => {
      const olderDraft = {
        ...draftResponse,
        hash: 'hash-A',
        last_replacement_id: 'import-A',
        graph: { nodes: [], edges: [], viewport: { x: 1, y: 2, zoom: 1 } },
      }
      const newerDraft = {
        ...olderDraft,
        hash: 'hash-B',
        last_replacement_id: 'import-B',
      }
      let resolveOlder: ((draft: typeof olderDraft) => void) | undefined
      let resolveNewer: ((draft: typeof newerDraft) => void) | undefined
      mockFetchWorkflowDraft
        .mockReturnValueOnce(
          new Promise<typeof olderDraft>((resolve) => {
            resolveOlder = resolve
          }),
        )
        .mockReturnValueOnce(
          new Promise<typeof newerDraft>((resolve) => {
            resolveNewer = resolve
          }),
        )
      mockEventEmitterEmit.mockImplementation((event: WorkflowDraftReplacedEvent) => {
        const { draft } = event.payload
        workflowStoreState.setSyncWorkflowDraftHash(draft.hash)
        workflowStoreState.lastAppliedReplacementId = draft.last_replacement_id
        workflowStoreState.draftReplacementEpoch += 1
      })
      const { result } = renderHook(() => useWorkflowRefreshDraft())
      let olderRefresh: Promise<boolean> | undefined
      let newerRefresh: Promise<boolean> | undefined

      act(() => {
        olderRefresh = result.current.handleRefreshWorkflowDraft()
        newerRefresh = result.current.handleRefreshWorkflowDraft()
      })
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2)

      if (responseOrder === 'older first') {
        await act(async () => {
          resolveOlder?.(olderDraft)
          await olderRefresh
        })
        await act(async () => {
          resolveNewer?.(newerDraft)
          await newerRefresh
        })
      } else {
        await act(async () => {
          resolveNewer?.(newerDraft)
          await newerRefresh
        })
        await act(async () => {
          resolveOlder?.(olderDraft)
          await olderRefresh
        })
      }

      await expect(olderRefresh).resolves.toBe(false)
      await expect(newerRefresh).resolves.toBe(true)
      expect(mockEventEmitterEmit).toHaveBeenCalledOnce()
      expect(mockEventEmitterEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ draft: newerDraft }),
        }),
      )
      expect(workflowStoreState.syncWorkflowDraftHash).toBe('hash-B')
      expect(workflowStoreState.lastAppliedReplacementId).toBe('import-B')
      expect(workflowStoreState.draftReplacementEpoch).toBeGreaterThan(0)
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)
    },
  )

  it('keeps editing paused when an older refresh fails while the newest request is pending', async () => {
    let rejectOlder: ((error: Error) => void) | undefined
    let resolveNewer: ((draft: typeof draftResponse) => void) | undefined
    mockFetchWorkflowDraft
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectOlder = reject
        }),
      )
      .mockReturnValueOnce(
        new Promise<typeof draftResponse>((resolve) => {
          resolveNewer = resolve
        }),
      )
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    const olderRefresh = result.current.handleRefreshWorkflowDraft()
    expect(workflowStoreState.isWorkflowDataLoaded).toBe(false)
    const newerRefresh = result.current.handleRefreshWorkflowDraft()

    await act(async () => {
      rejectOlder?.(new Error('Older refresh failed'))
      await expect(olderRefresh).resolves.toBe(false)
    })

    expect(workflowStoreState.isWorkflowDataLoaded).toBe(false)
    expect(workflowStoreState.isSyncingWorkflowDraft).toBe(true)
    expect(workflowStoreState.syncWorkflowDraftHash).toBe('initial-hash')

    await act(async () => {
      resolveNewer?.({ ...draftResponse, hash: 'hash-B' })
      await expect(newerRefresh).resolves.toBe(true)
    })
    expect(workflowStoreState.isWorkflowDataLoaded).toBe(true)
    expect(workflowStoreState.isSyncingWorkflowDraft).toBe(false)
    expect(workflowStoreState.syncWorkflowDraftHash).toBe('hash-B')
  })

  it('restores readiness after the newest ordinary refresh fails without applying a late older response', async () => {
    let resolveOlder: ((draft: typeof draftResponse) => void) | undefined
    let rejectNewer: ((error: Error) => void) | undefined
    mockFetchWorkflowDraft
      .mockReturnValueOnce(
        new Promise<typeof draftResponse>((resolve) => {
          resolveOlder = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectNewer = reject
        }),
      )
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    const olderRefresh = result.current.handleRefreshWorkflowDraft()
    expect(workflowStoreState.isWorkflowDataLoaded).toBe(false)
    const newerRefresh = result.current.handleRefreshWorkflowDraft()

    await act(async () => {
      rejectNewer?.(new Error('Newest refresh failed'))
      await expect(newerRefresh).resolves.toBe(false)
    })

    expect(workflowStoreState.isWorkflowDataLoaded).toBe(true)
    expect(workflowStoreState.isSyncingWorkflowDraft).toBe(false)
    await act(async () => {
      resolveOlder?.({ ...draftResponse, hash: 'hash-A' })
      await expect(olderRefresh).resolves.toBe(false)
    })
    expect(workflowStoreState.syncWorkflowDraftHash).toBe('initial-hash')
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    expect(mockEventEmitterEmit).not.toHaveBeenCalled()
    expect(workflowStoreState.isWorkflowDataLoaded).toBe(true)
  })

  it('leaves readiness to the external owner when a guarded refresh supersedes an ordinary refresh and is cancelled', async () => {
    let rejectOlder: ((error: Error) => void) | undefined
    let resolveNewer: ((draft: typeof draftResponse) => void) | undefined
    mockFetchWorkflowDraft
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectOlder = reject
        }),
      )
      .mockReturnValueOnce(
        new Promise<typeof draftResponse>((resolve) => {
          resolveNewer = resolve
        }),
      )
    let shouldApply = true
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    const olderRefresh = result.current.handleRefreshWorkflowDraft()
    expect(workflowStoreState.isWorkflowDataLoaded).toBe(false)
    const newerRefresh = result.current.handleRefreshWorkflowDraft(false, {
      shouldApply: () => shouldApply,
    })
    shouldApply = false

    await act(async () => {
      resolveNewer?.({ ...draftResponse, hash: 'hash-B' })
      await expect(newerRefresh).resolves.toBe(false)
    })
    expect(workflowStoreState.isWorkflowDataLoaded).toBe(false)
    expect(workflowStoreState.isSyncingWorkflowDraft).toBe(false)

    await act(async () => {
      rejectOlder?.(new Error('Superseded ordinary refresh failed'))
      await expect(olderRefresh).resolves.toBe(false)
    })
    expect(workflowStoreState.isWorkflowDataLoaded).toBe(false)
    expect(workflowStoreState.syncWorkflowDraftHash).toBe('initial-hash')
    expect(mockSetIsWorkflowDataLoaded).not.toHaveBeenCalledWith(true)
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    expect(mockEventEmitterEmit).not.toHaveBeenCalled()
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

  it('uses a verified prefetched draft without a second GET', async () => {
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    await act(async () => {
      await result.current.handleRefreshWorkflowDraft(true, {
        prefetchedDraft: {
          ...draftResponse,
          graph: { nodes: [], edges: [] },
        },
        shouldApply: () => true,
      })
    })

    expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('server-hash')
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
  })

  it('should cancel pending draft sync, use fallback viewport, and persist masked secrets', async () => {
    workflowStoreState = {
      ...workflowStoreState,
      debouncedSyncWorkflowDraft: { cancel: mockCancel },
    }
    mockFetchWorkflowDraft.mockResolvedValue({
      hash: 'server-hash',
      last_replacement_id: null,
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
        { authoritativeDraft: true },
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
      last_replacement_id: null,
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
        { authoritativeDraft: true },
      )
    })
  })

  it('should not restore a local start placeholder for non-workflow app modes', async () => {
    mockFetchWorkflowDraft.mockResolvedValue({
      hash: 'server-hash',
      last_replacement_id: null,
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
        { authoritativeDraft: true },
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
      expect(mockSetIsWorkflowDataLoaded).toHaveBeenNthCalledWith(1, false)
      expect(mockSetIsWorkflowDataLoaded).toHaveBeenNthCalledWith(2, true)
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenCalledWith(true)
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)
    })
  })
})
