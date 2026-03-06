import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkflowRefreshDraft } from '../use-workflow-refresh-draft'

const mockHandleUpdateWorkflowCanvas = vi.fn()
const mockSetSyncWorkflowDraftHash = vi.fn()

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      appId: 'app-1',
      isWorkflowDataLoaded: true,
      debouncedSyncWorkflowDraft: undefined,
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft: vi.fn(),
      setEnvironmentVariables: vi.fn(),
      setEnvSecrets: vi.fn(),
      setConversationVariables: vi.fn(),
      setIsWorkflowDataLoaded: vi.fn(),
    }),
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
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('server-hash')
  })
})
