import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { createHttpError } from '@/service/http-error'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'

const mockGetNodes = vi.fn()
const mockStoreGetState = vi.fn()

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: mockStoreGetState,
  }),
}))

const mockWorkflowStoreGetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
  }),
}))

const mockGetNodesReadOnly = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({
    getNodesReadOnly: mockGetNodesReadOnly,
  }),
}))

const mockSyncWorkflowDraft = vi.fn()
// Stand in for the draft sync request at the client boundary: record the request it sends
// and validate rejections against the contract, as the console link does.
vi.mock('@/service/console', async (importOriginal) => {
  const { rag } = await import('@dify/contracts/api/console/rag/orpc.gen')
  const { validateDefinedErrors } = await import('@/service/console/defined-errors')
  const validate = validateDefinedErrors({ rag })
  const post = (input: { params: { pipeline_id: string }; body: unknown }) =>
    validate({
      context: {},
      input,
      path: ['rag', 'pipelines', 'byPipelineId', 'workflows', 'draft', 'post'],
      next: () =>
        mockSyncWorkflowDraft({
          url: `/rag/pipelines/${input.params.pipeline_id}/workflows/draft`,
          params: input.body,
        }),
    })
  return {
    ...(await importOriginal<typeof import('@/service/console')>()),
    consoleClient: { rag: { pipelines: { byPipelineId: { workflows: { draft: { post } } } } } },
  }
})

const mockHandleRefreshWorkflowDraft = vi.fn()
vi.mock('../use-pipeline-refresh-draft', () => ({
  usePipelineRefreshDraft: () => ({
    handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft,
  }),
}))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  API_PREFIX: '/api',
}))

const mockPostWithKeepalive = vi.fn()
vi.mock('@/service/fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/fetch')>()),
  postWithKeepalive: (...args: unknown[]) => mockPostWithKeepalive(...args),
}))

describe('useNodesSyncDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockStoreGetState.mockReturnValue({
      getNodes: mockGetNodes,
      edges: [],
      transform: [0, 0, 1],
    })

    mockGetNodes.mockReturnValue([
      { id: 'node-1', data: { type: 'start', _temp: true }, position: { x: 0, y: 0 } },
      { id: 'node-2', data: { type: 'end' }, position: { x: 100, y: 0 } },
    ])

    mockWorkflowStoreGetState.mockReturnValue({
      pipelineId: 'test-pipeline-id',
      environmentVariables: [],
      syncWorkflowDraftHash: 'test-hash',
      ragPipelineVariables: [],
      setSyncWorkflowDraftHash: vi.fn(),
      setDraftUpdatedAt: vi.fn(),
    })

    mockGetNodesReadOnly.mockReturnValue(false)
    mockSyncWorkflowDraft.mockResolvedValue({
      hash: 'new-hash',
      updated_at: '2024-01-01T00:00:00Z',
    })
  })

  it.each(['page close', 'queued sync'] as const)(
    'sends the complete sanitized draft on %s without changing the canvas',
    async (mode) => {
      const node = {
        id: 'node-1',
        data: { type: 'start', _privateData: 'secret' },
        position: { x: 0, y: 0 },
      }
      const temp = {
        id: 'temp',
        data: { type: 'start', _isTempNode: true },
        position: { x: 50, y: 0 },
      }
      const edge = {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        data: { _hidden: true, visible: false },
      }
      mockGetNodes.mockReturnValue([node, temp])
      mockStoreGetState.mockReturnValue({
        getNodes: mockGetNodes,
        edges: [edge],
        transform: [100, 200, 1.5],
      })
      const environmentVariables = [
        { id: 'env', name: 'URL', value_type: 'string', value: 'https://example.com' },
      ]
      const ragPipelineVariables = [{ variable: 'input', type: 'text-input' }]
      mockWorkflowStoreGetState.mockReturnValue({
        environmentVariables,
        ragPipelineVariables,
        syncWorkflowDraftHash: 'test-hash',
        setSyncWorkflowDraftHash: vi.fn(),
        setDraftUpdatedAt: vi.fn(),
      })
      const { result } = renderHook(() => useNodesSyncDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })
      const payload = {
        graph: {
          nodes: [{ ...node, data: { type: 'start' } }],
          edges: [{ ...edge, data: { visible: false } }],
          viewport: { x: 100, y: 200, zoom: 1.5 },
        },
        environment_variables: environmentVariables,
        rag_pipeline_variables: ragPipelineVariables,
        hash: 'test-hash',
      }
      if (mode === 'page close') {
        act(() => result.current.syncWorkflowDraftWhenPageClose())
        expect(mockPostWithKeepalive).toHaveBeenCalledExactlyOnceWith(
          '/api/rag/pipelines/test-pipeline-id/workflows/draft',
          payload,
        )
      } else {
        await act(async () => {
          await result.current.doSyncWorkflowDraft()
        })
        expect(mockSyncWorkflowDraft).toHaveBeenCalledExactlyOnceWith({
          url: '/rag/pipelines/test-pipeline-id/workflows/draft',
          params: payload,
        })
      }
      expect(node.data._privateData).toBe('secret')
      expect(edge.data._hidden).toBe(true)
    },
  )

  describe('syncWorkflowDraftWhenPageClose', () => {
    it('should not call postWithKeepalive when nodes are read only', () => {
      mockGetNodesReadOnly.mockReturnValue(true)

      const { result } = renderHook(() => useNodesSyncDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockPostWithKeepalive).not.toHaveBeenCalled()
    })

    it('should not call postWithKeepalive when nodes array is empty', () => {
      mockGetNodes.mockReturnValue([])

      const { result } = renderHook(() => useNodesSyncDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockPostWithKeepalive).not.toHaveBeenCalled()
    })
  })

  describe('doSyncWorkflowDraft', () => {
    it('should not sync when nodes are read only', async () => {
      mockGetNodesReadOnly.mockReturnValue(true)

      const { result } = renderHook(() => useNodesSyncDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should capture the graph before a queued sync runs after the canvas is torn down', async () => {
      const draftNode = {
        id: 'node-1',
        data: { type: 'start' },
        position: { x: 0, y: 0 },
      }
      const draftEdge = {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        data: { visible: true },
      }
      mockGetNodes.mockReturnValue([draftNode])
      mockStoreGetState.mockReturnValue({
        getNodes: mockGetNodes,
        edges: [draftEdge],
        transform: [10, 20, 1.5],
      })

      const { result } = renderHook(() => useNodesSyncDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })
      let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

      act(() => {
        syncPromise = result.current.doSyncWorkflowDraft()

        // Simulate ReactFlow clearing its store immediately after the page starts unmounting.
        mockGetNodes.mockReturnValue([])
        mockStoreGetState.mockReturnValue({
          getNodes: mockGetNodes,
          edges: [],
          transform: [0, 0, 1],
        })
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

    it('should use the latest hash when sending a previously captured queued graph', async () => {
      const workflowState = {
        pipelineId: 'test-pipeline-id',
        environmentVariables: [],
        syncWorkflowDraftHash: 'initial-hash',
        ragPipelineVariables: [],
        setSyncWorkflowDraftHash: vi.fn(),
        setDraftUpdatedAt: vi.fn(),
      }
      workflowState.setSyncWorkflowDraftHash.mockImplementation((hash: string) => {
        workflowState.syncWorkflowDraftHash = hash
      })
      mockWorkflowStoreGetState.mockImplementation(() => workflowState)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])
      mockSyncWorkflowDraft
        .mockResolvedValueOnce({ hash: 'hash-after-first-sync', updated_at: 'first-update' })
        .mockResolvedValueOnce({ hash: 'hash-after-second-sync', updated_at: 'second-update' })

      const { result } = renderHook(() => useNodesSyncDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })
      let firstSync!: ReturnType<typeof result.current.doSyncWorkflowDraft>
      let secondSync!: ReturnType<typeof result.current.doSyncWorkflowDraft>

      act(() => {
        firstSync = result.current.doSyncWorkflowDraft()
        secondSync = result.current.doSyncWorkflowDraft()
      })

      await act(async () => {
        await Promise.all([firstSync, secondSync])
      })

      expect(mockSyncWorkflowDraft).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          params: expect.objectContaining({ hash: 'initial-hash' }),
        }),
      )
      expect(mockSyncWorkflowDraft).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          params: expect.objectContaining({ hash: 'hash-after-first-sync' }),
        }),
      )
    })

    it('should call onError callback when sync fails', async () => {
      mockGetNodesReadOnly.mockReturnValue(false)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])
      mockSyncWorkflowDraft.mockRejectedValue(new Error('Sync failed'))
      const onError = vi.fn()
      const onSuccess = vi.fn()
      const onSettled = vi.fn()

      const { result } = renderHook(() => useNodesSyncDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onError, onSuccess, onSettled })
      })

      expect(onError).toHaveBeenCalled()
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onSettled).toHaveBeenCalledOnce()
    })

    it('should update hash and draft updated at on success', async () => {
      const onSuccess = vi.fn()
      const onSettled = vi.fn()
      const onError = vi.fn()
      const mockSetSyncWorkflowDraftHash = vi.fn()
      const mockSetDraftUpdatedAt = vi.fn()

      mockGetNodesReadOnly.mockReturnValue(false)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])
      mockWorkflowStoreGetState.mockReturnValue({
        pipelineId: 'test-pipeline-id',
        environmentVariables: [],
        syncWorkflowDraftHash: 'test-hash',
        ragPipelineVariables: [],
        setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
        setDraftUpdatedAt: mockSetDraftUpdatedAt,
      })

      const { result } = renderHook(() => useNodesSyncDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onSuccess, onSettled, onError })
      })

      expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash')
      expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith('2024-01-01T00:00:00Z')
      expect(onSuccess).toHaveBeenCalledOnce()
      expect(onSettled).toHaveBeenCalledOnce()
      expect(onError).not.toHaveBeenCalled()
    })

    it('should handle draft not sync error', async () => {
      mockGetNodesReadOnly.mockReturnValue(false)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])

      const mockJsonError = createHttpError(new Response(null, { status: 409 }), {
        code: 'draft_workflow_not_sync',
        message: 'Workflow not synced.',
        status: 409,
      })
      mockSyncWorkflowDraft.mockRejectedValue(mockJsonError)

      const { result } = renderHook(() => useNodesSyncDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false)
      })

      expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalled()
    })

    it('should not refresh when notRefreshWhenSyncError is true', async () => {
      mockGetNodesReadOnly.mockReturnValue(false)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])

      const mockJsonError = createHttpError(new Response(null, { status: 409 }), {
        code: 'draft_workflow_not_sync',
        message: 'Workflow not synced.',
        status: 409,
      })
      mockSyncWorkflowDraft.mockRejectedValue(mockJsonError)

      const { result } = renderHook(() => useNodesSyncDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await act(async () => {
        await result.current.doSyncWorkflowDraft(true)
      })

      expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
    })
  })
})
