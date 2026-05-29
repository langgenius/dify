import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkflowRefreshDraft } from '../use-workflow-refresh-draft'

const mockHandleUpdateWorkflowCanvas = vi.fn()
const mockSetSyncWorkflowDraftHash = vi.fn()
const mockSetIsSyncingWorkflowDraft = vi.fn()
const mockSetEnvironmentVariables = vi.fn()
const mockSetEnvSecrets = vi.fn()
const mockSetConversationVariables = vi.fn()
const mockSetIsWorkflowDataLoaded = vi.fn()
const mockCancel = vi.fn()

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

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => workflowStoreState,
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
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
    mockFetchWorkflowDraft.mockResolvedValue(draftResponse)
  })

  it('should update canvas by default (notUpdateCanvas omitted)', async () => {
    const { result } = renderHook(() => useWorkflowRefreshDraft())
    await act(async () => {
      result.current.handleRefreshWorkflowDraft()
    })
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

  it('should restore loaded state when refresh fails after workflow data was already loaded', async () => {
    mockFetchWorkflowDraft.mockRejectedValue(new Error('refresh failed'))

    const { result } = renderHook(() => useWorkflowRefreshDraft())

    act(() => {
      result.current.handleRefreshWorkflowDraft()
    })

    await waitFor(() => {
      expect(mockSetIsWorkflowDataLoaded).toHaveBeenNthCalledWith(1, false)
      expect(mockSetIsWorkflowDataLoaded).toHaveBeenNthCalledWith(2, true)
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenCalledWith(true)
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)
    })
  })
})
