import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useNodesSyncDraft } from '../use-nodes-sync-draft'

const mockGetNodes = vi.fn()
const mockPostWithKeepalive = vi.fn()
const mockSetSyncWorkflowDraftHash = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()
const mockGetNodesReadOnly = vi.fn()

let reactFlowState: {
  getNodes: typeof mockGetNodes
  edges: Array<Record<string, unknown>>
  transform: [number, number, number]
}

let workflowStoreState: {
  appId: string
  isWorkflowDataLoaded: boolean
  syncWorkflowDraftHash: string | null
  environmentVariables: Array<Record<string, unknown>>
  conversationVariables: Array<Record<string, unknown>>
  setSyncWorkflowDraftHash: typeof mockSetSyncWorkflowDraftHash
  setDraftUpdatedAt: typeof mockSetDraftUpdatedAt
}

let featuresState: {
  features: {
    opening: { enabled: boolean, opening_statement: string, suggested_questions: string[] }
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
  useWorkflowStore: () => ({
    getState: () => workflowStoreState,
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

vi.mock('@/service/fetch', () => ({ postWithKeepalive: (...args: unknown[]) => mockPostWithKeepalive(...args) }))
vi.mock('@/config', () => ({ API_PREFIX: '/api' }))

const mockHandleRefreshWorkflowDraft = vi.fn()
vi.mock('@/app/components/workflow-app/hooks', () => ({
  useWorkflowRefreshDraft: () => ({ handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft }),
}))

describe('useNodesSyncDraft — handleRefreshWorkflowDraft(true) on 409', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reactFlowState = {
      getNodes: mockGetNodes,
      edges: [],
      transform: [0, 0, 1],
    }
    workflowStoreState = {
      appId: 'app-1',
      isWorkflowDataLoaded: true,
      syncWorkflowDraftHash: 'hash-123',
      environmentVariables: [],
      conversationVariables: [],
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setDraftUpdatedAt: mockSetDraftUpdatedAt,
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

  it('should strip temp entities and private data, use the latest hash, and invoke success callbacks', async () => {
    reactFlowState = {
      ...reactFlowState,
      edges: [
        { id: 'edge-1', source: 'n1', target: 'n2', data: { _isTemp: false, _private: 'drop', stable: 'keep' } },
        { id: 'temp-edge', source: 'n2', target: 'n3', data: { _isTemp: true } },
      ],
      transform: [10, 20, 1.5],
    }
    mockGetNodes.mockReturnValue([
      { id: 'n1', position: { x: 0, y: 0 }, data: { type: 'start', _tempField: 'drop', label: 'Start' } },
      { id: 'temp-node', position: { x: 1, y: 1 }, data: { type: 'answer', _isTempNode: true } },
    ])
    workflowStoreState = {
      ...workflowStoreState,
      syncWorkflowDraftHash: 'latest-hash',
      environmentVariables: [{ id: 'env-1', value: 'env' }],
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

    const { result } = renderHook(() => useNodesSyncDraft())

    await act(async () => {
      await result.current.doSyncWorkflowDraft(false, callbacks)
    })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith({
      url: '/apps/app-1/workflows/draft',
      params: {
        graph: {
          nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { type: 'start', label: 'Start' } }],
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
        environment_variables: [{ id: 'env-1', value: 'env' }],
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

  it('should post workflow draft with keepalive when the page closes', () => {
    reactFlowState = {
      ...reactFlowState,
      transform: [1, 2, 3],
    }
    workflowStoreState = {
      ...workflowStoreState,
      environmentVariables: [{ id: 'env-1' }],
      conversationVariables: [{ id: 'conversation-1' }],
    }

    const { result } = renderHook(() => useNodesSyncDraft())

    act(() => {
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockPostWithKeepalive).toHaveBeenCalledWith('/api/apps/app-1/workflows/draft', expect.objectContaining({
      graph: expect.objectContaining({
        viewport: { x: 1, y: 2, zoom: 3 },
      }),
      hash: 'hash-123',
    }))
  })
})
