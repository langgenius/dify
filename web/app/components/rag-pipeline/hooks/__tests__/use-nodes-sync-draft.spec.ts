import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/app/components/workflow/hooks/use-serial-async-callback', () => ({
  useSerialAsyncCallback: (fn: (...args: unknown[]) => Promise<void>, checkFn: () => boolean) => {
    return (...args: unknown[]) => {
      if (!checkFn()) {
        return fn(...args)
      }
    }
  },
}))

const mockSyncWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  syncWorkflowDraft: (params: unknown) => mockSyncWorkflowDraft(params),
}))

const mockHandleRefreshWorkflowDraft = vi.fn()
vi.mock('@/app/components/rag-pipeline/hooks', () => ({
  usePipelineRefreshDraft: () => ({
    handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft,
  }),
}))

vi.mock('@/config', () => ({
  API_PREFIX: '/api',
}))

const mockPostWithKeepalive = vi.fn()
vi.mock('@/service/fetch', () => ({
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

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('hook initialization', () => {
    it('should return doSyncWorkflowDraft function', () => {
      const { result } = renderHook(() => useNodesSyncDraft())

      expect(result.current.doSyncWorkflowDraft).toBeDefined()
      expect(typeof result.current.doSyncWorkflowDraft).toBe('function')
    })

    it('should return syncWorkflowDraftWhenPageClose function', () => {
      const { result } = renderHook(() => useNodesSyncDraft())

      expect(result.current.syncWorkflowDraftWhenPageClose).toBeDefined()
      expect(typeof result.current.syncWorkflowDraftWhenPageClose).toBe('function')
    })
  })

  describe('syncWorkflowDraftWhenPageClose', () => {
    it('should not call postWithKeepalive when nodes are read only', () => {
      mockGetNodesReadOnly.mockReturnValue(true)

      const { result } = renderHook(() => useNodesSyncDraft())

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockPostWithKeepalive).not.toHaveBeenCalled()
    })

    it('should call postWithKeepalive with correct URL and params', () => {
      mockGetNodesReadOnly.mockReturnValue(false)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])

      const { result } = renderHook(() => useNodesSyncDraft())

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockPostWithKeepalive).toHaveBeenCalledWith(
        '/api/rag/pipelines/test-pipeline-id/workflows/draft',
        expect.objectContaining({
          graph: expect.any(Object),
          hash: 'test-hash',
        }),
      )
    })

    it('should not call postWithKeepalive when pipelineId is missing', () => {
      mockWorkflowStoreGetState.mockReturnValue({
        pipelineId: undefined,
        environmentVariables: [],
        syncWorkflowDraftHash: 'test-hash',
        ragPipelineVariables: [],
      })

      const { result } = renderHook(() => useNodesSyncDraft())

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockPostWithKeepalive).not.toHaveBeenCalled()
    })

    it('should not call postWithKeepalive when nodes array is empty', () => {
      mockGetNodes.mockReturnValue([])

      const { result } = renderHook(() => useNodesSyncDraft())

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockPostWithKeepalive).not.toHaveBeenCalled()
    })

    it('should filter out temp nodes', () => {
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start', _isTempNode: true }, position: { x: 0, y: 0 } },
      ])

      const { result } = renderHook(() => useNodesSyncDraft())

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockPostWithKeepalive).not.toHaveBeenCalled()
    })

    it('should remove underscore-prefixed data keys from nodes', () => {
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start', _privateData: 'secret' }, position: { x: 0, y: 0 } },
      ])

      const { result } = renderHook(() => useNodesSyncDraft())

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockPostWithKeepalive).toHaveBeenCalled()
      const sentParams = mockPostWithKeepalive.mock.calls[0][1]
      expect(sentParams.graph.nodes[0].data._privateData).toBeUndefined()
    })
  })

  describe('doSyncWorkflowDraft', () => {
    it('should not sync when nodes are read only', async () => {
      mockGetNodesReadOnly.mockReturnValue(true)

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should call syncWorkflowDraft service', async () => {
      mockGetNodesReadOnly.mockReturnValue(false)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalled()
    })

    it('should call onSuccess callback when sync succeeds', async () => {
      mockGetNodesReadOnly.mockReturnValue(false)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])
      const onSuccess = vi.fn()

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onSuccess })
      })

      expect(onSuccess).toHaveBeenCalled()
    })

    it('should call onSettled callback after sync completes', async () => {
      mockGetNodesReadOnly.mockReturnValue(false)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])
      const onSettled = vi.fn()

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onSettled })
      })

      expect(onSettled).toHaveBeenCalled()
    })

    it('should call onError callback when sync fails', async () => {
      mockGetNodesReadOnly.mockReturnValue(false)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])
      mockSyncWorkflowDraft.mockRejectedValue(new Error('Sync failed'))
      const onError = vi.fn()

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onError })
      })

      expect(onError).toHaveBeenCalled()
    })

    it('should update hash and draft updated at on success', async () => {
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

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash')
      expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith('2024-01-01T00:00:00Z')
    })

    it('should handle draft not sync error', async () => {
      mockGetNodesReadOnly.mockReturnValue(false)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])

      const mockJsonError = {
        json: vi.fn().mockResolvedValue({ code: 'draft_workflow_not_sync' }),
        bodyUsed: false,
      }
      mockSyncWorkflowDraft.mockRejectedValue(mockJsonError)

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false)
      })

      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalled()
    })

    it('should not refresh when notRefreshWhenSyncError is true', async () => {
      mockGetNodesReadOnly.mockReturnValue(false)
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])

      const mockJsonError = {
        json: vi.fn().mockResolvedValue({ code: 'draft_workflow_not_sync' }),
        bodyUsed: false,
      }
      mockSyncWorkflowDraft.mockRejectedValue(mockJsonError)

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft(true)
      })

      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
    })
  })

  describe('getPostParams', () => {
    it('should include viewport coordinates in params', () => {
      mockStoreGetState.mockReturnValue({
        getNodes: mockGetNodes,
        edges: [],
        transform: [100, 200, 1.5],
      })
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])

      const { result } = renderHook(() => useNodesSyncDraft())

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      const sentParams = mockPostWithKeepalive.mock.calls[0][1]
      expect(sentParams.graph.viewport).toEqual({ x: 100, y: 200, zoom: 1.5 })
    })

    it('should include environment variables in params', () => {
      mockWorkflowStoreGetState.mockReturnValue({
        pipelineId: 'test-pipeline-id',
        environmentVariables: [{ key: 'API_KEY', value: 'secret' }],
        syncWorkflowDraftHash: 'test-hash',
        ragPipelineVariables: [],
        setSyncWorkflowDraftHash: vi.fn(),
        setDraftUpdatedAt: vi.fn(),
      })
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])

      const { result } = renderHook(() => useNodesSyncDraft())

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      const sentParams = mockPostWithKeepalive.mock.calls[0][1]
      expect(sentParams.environment_variables).toEqual([{ key: 'API_KEY', value: 'secret' }])
    })

    it('should include rag pipeline variables in params', () => {
      mockWorkflowStoreGetState.mockReturnValue({
        pipelineId: 'test-pipeline-id',
        environmentVariables: [],
        syncWorkflowDraftHash: 'test-hash',
        ragPipelineVariables: [{ variable: 'input', type: 'text-input' }],
        setSyncWorkflowDraftHash: vi.fn(),
        setDraftUpdatedAt: vi.fn(),
      })
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])

      const { result } = renderHook(() => useNodesSyncDraft())

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      const sentParams = mockPostWithKeepalive.mock.calls[0][1]
      expect(sentParams.rag_pipeline_variables).toEqual([{ variable: 'input', type: 'text-input' }])
    })

    it('should remove underscore-prefixed keys from edges', () => {
      mockStoreGetState.mockReturnValue({
        getNodes: mockGetNodes,
        edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', data: { _hidden: true, visible: false } }],
        transform: [0, 0, 1],
      })
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { type: 'start' }, position: { x: 0, y: 0 } },
      ])

      const { result } = renderHook(() => useNodesSyncDraft())

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      const sentParams = mockPostWithKeepalive.mock.calls[0][1]
      expect(sentParams.graph.edges[0].data._hidden).toBeUndefined()
      expect(sentParams.graph.edges[0].data.visible).toBe(false)
    })
  })
})
