import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useNodesSyncDraft } from '../use-nodes-sync-draft'

const mockGetNodes = vi.fn()
vi.mock('reactflow', () => ({
  useStoreApi: () => ({ getState: () => ({ getNodes: mockGetNodes, edges: [], transform: [0, 0, 1] }) }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      appId: 'app-1',
      isWorkflowDataLoaded: true,
      syncWorkflowDraftHash: 'hash-123',
      environmentVariables: [],
      conversationVariables: [],
      setSyncWorkflowDraftHash: vi.fn(),
      setDraftUpdatedAt: vi.fn(),
    }),
  }),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({
    getState: () => ({
      features: {
        opening: { enabled: false, opening_statement: '', suggested_questions: [] },
        suggested: {},
        text2speech: {},
        speech2text: {},
        citation: {},
        moderation: {},
        file: {},
      },
    }),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ getNodesReadOnly: () => false }),
}))

vi.mock('@/app/components/workflow/hooks/use-serial-async-callback', () => ({
  useSerialAsyncCallback: (fn: (...args: unknown[]) => Promise<void>, checkFn: () => boolean) =>
    (...args: unknown[]) => {
      if (!checkFn())
        return fn(...args)
    },
}))

const mockSyncWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  syncWorkflowDraft: (p: unknown) => mockSyncWorkflowDraft(p),
}))

vi.mock('@/service/fetch', () => ({ postWithKeepalive: vi.fn() }))
vi.mock('@/config', () => ({ API_PREFIX: '/api' }))

const mockHandleRefreshWorkflowDraft = vi.fn()
vi.mock('@/app/components/workflow-app/hooks', () => ({
  useWorkflowRefreshDraft: () => ({ handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft }),
}))

describe('useNodesSyncDraft — handleRefreshWorkflowDraft(true) on 409', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetNodes.mockReturnValue([{ id: 'n1', position: { x: 0, y: 0 }, data: { type: 'start' } }])
    mockSyncWorkflowDraft.mockResolvedValue({ hash: 'new', updated_at: 1 })
  })

  it('should call handleRefreshWorkflowDraft(true) — not updating canvas — on draft_workflow_not_sync', async () => {
    const error = { json: vi.fn().mockResolvedValue({ code: 'draft_workflow_not_sync' }), bodyUsed: false }
    mockSyncWorkflowDraft.mockRejectedValue(error)

    const { result } = renderHook(() => useNodesSyncDraft())
    await act(async () => {
      await result.current.doSyncWorkflowDraft(false)
    })
    await new Promise(r => setTimeout(r, 0))

    expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledWith(true)
  })

  it('should NOT refresh when notRefreshWhenSyncError=true', async () => {
    const error = { json: vi.fn().mockResolvedValue({ code: 'draft_workflow_not_sync' }), bodyUsed: false }
    mockSyncWorkflowDraft.mockRejectedValue(error)

    const { result } = renderHook(() => useNodesSyncDraft())
    await act(async () => {
      await result.current.doSyncWorkflowDraft(true)
    })
    await new Promise(r => setTimeout(r, 0))

    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should NOT refresh for a different error code', async () => {
    const error = { json: vi.fn().mockResolvedValue({ code: 'other_error' }), bodyUsed: false }
    mockSyncWorkflowDraft.mockRejectedValue(error)

    const { result } = renderHook(() => useNodesSyncDraft())
    await act(async () => {
      await result.current.doSyncWorkflowDraft(false)
    })
    await new Promise(r => setTimeout(r, 0))

    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should not include source_workflow_id in draft sync payloads', async () => {
    const { result } = renderHook(() => useNodesSyncDraft())

    await act(async () => {
      await result.current.doSyncWorkflowDraft(false)
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.not.objectContaining({
        source_workflow_id: expect.anything(),
      }),
    }))
  })
})
