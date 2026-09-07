import type { EnvironmentVariablePatch } from '@/service/workflow'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { BlockEnum } from '@/app/components/workflow/types'
import { markAppDeletionFailed, markAppDeletionStarted } from '@/service/app-deletion'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
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
let isCollaborationEnabled = false

let reactFlowState: {
  getNodes: typeof mockGetNodes
  edges: Array<Record<string, unknown>>
  transform: [number, number, number]
}

let workflowStoreState: {
  appId: string
  isWorkflowDataLoaded: boolean
  syncWorkflowDraftHash: string | null
  conversationVariables: Array<Record<string, unknown>>
  setSyncWorkflowDraftHash: typeof mockSetSyncWorkflowDraftHash
  setDraftUpdatedAt: typeof mockSetDraftUpdatedAt
}

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

const renderUseNodesSyncDraft = () =>
  renderHookWithConsoleQuery(() => useNodesSyncDraft(), {
    systemFeatures: { enable_collaboration_mode: isCollaborationEnabled },
  })

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
  })

  it('should call handleRefreshWorkflowDraft(true) — not updating canvas — on draft_workflow_not_sync', async () => {
    const error = {
      json: vi.fn().mockResolvedValue({ code: 'draft_workflow_not_sync' }),
      bodyUsed: false,
    }
    mockSyncWorkflowDraft.mockRejectedValue(error)

    const { result } = renderUseNodesSyncDraft()
    await act(async () => {
      await result.current.doSyncWorkflowDraft(false)
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledWith(true)
  })

  it('should NOT refresh when notRefreshWhenSyncError=true', async () => {
    const error = {
      json: vi.fn().mockResolvedValue({ code: 'draft_workflow_not_sync' }),
      bodyUsed: false,
    }
    mockSyncWorkflowDraft.mockRejectedValue(error)

    const { result } = renderUseNodesSyncDraft()
    await act(async () => {
      await result.current.doSyncWorkflowDraft(true)
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should NOT refresh for a different error code', async () => {
    const error = { json: vi.fn().mockResolvedValue({ code: 'other_error' }), bodyUsed: false }
    mockSyncWorkflowDraft.mockRejectedValue(error)

    const { result } = renderUseNodesSyncDraft()
    await act(async () => {
      await result.current.doSyncWorkflowDraft(false)
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should ignore non-JSON sync errors without throwing an unhandled rejection', async () => {
    const error = {
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token U')),
      bodyUsed: false,
    }
    const callbacks = {
      onError: vi.fn(),
      onSettled: vi.fn(),
    }
    mockSyncWorkflowDraft.mockRejectedValue(error)

    const { result } = renderUseNodesSyncDraft()
    await act(async () => {
      await expect(result.current.doSyncWorkflowDraft(false, callbacks)).resolves.toBeNull()
    })

    expect(error.json).toHaveBeenCalled()
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
