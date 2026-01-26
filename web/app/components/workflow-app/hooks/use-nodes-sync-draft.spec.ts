/**
 * Test Suite for useNodesSyncDraft Hook
 *
 * PURPOSE:
 * This hook handles syncing workflow draft to the server. The key fix being tested
 * is the error handling behavior when `draft_workflow_not_sync` error occurs.
 *
 * MULTI-TAB PROBLEM SCENARIO:
 * 1. User opens the same workflow in Tab A and Tab B (both have hash: v1)
 * 2. Tab A saves successfully, server returns new hash: v2
 * 3. Tab B tries to save with old hash: v1, server returns 400 error with code
 *    'draft_workflow_not_sync'
 * 4. BEFORE FIX: handleRefreshWorkflowDraft() was called without args, which fetched
 *    draft AND overwrote canvas - user lost unsaved changes in Tab B
 * 5. AFTER FIX: handleRefreshWorkflowDraft(true) is called, which fetches draft but
 *    only updates hash (notUpdateCanvas=true), preserving user's canvas changes
 *
 * TESTING STRATEGY:
 * We don't simulate actual tab switching UI behavior. Instead, we mock the API to
 * return `draft_workflow_not_sync` error and verify:
 * - The hook calls handleRefreshWorkflowDraft(true) - not handleRefreshWorkflowDraft()
 * - This ensures canvas data is preserved while hash is updated for retry
 *
 * This is behavior-driven testing - we verify "what the code does when receiving
 * specific API errors" rather than simulating complete user interaction flows.
 * True multi-tab integration testing would require E2E frameworks like Playwright.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

// Mock reactflow store
const mockGetNodes = vi.fn()

type MockEdge = {
  id: string
  source: string
  target: string
  data: Record<string, unknown>
}

const mockStoreState: {
  getNodes: ReturnType<typeof vi.fn>
  edges: MockEdge[]
  transform: number[]
} = {
  getNodes: mockGetNodes,
  edges: [],
  transform: [0, 0, 1],
}
vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => mockStoreState,
  }),
}))

// Mock features store
const mockFeaturesState = {
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
vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({
    getState: () => mockFeaturesState,
  }),
}))

// Mock workflow service
const mockSyncWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  syncWorkflowDraft: (...args: unknown[]) => mockSyncWorkflowDraft(...args),
}))

// Mock useNodesReadOnly
const mockGetNodesReadOnly = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({
    getNodesReadOnly: mockGetNodesReadOnly,
  }),
}))

// Mock useSerialAsyncCallback - pass through the callback
vi.mock('@/app/components/workflow/hooks/use-serial-async-callback', () => ({
  useSerialAsyncCallback: (callback: (...args: unknown[]) => unknown) => callback,
}))

// Mock workflow store
const mockSetSyncWorkflowDraftHash = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()

const createMockWorkflowStoreState = (overrides = {}) => ({
  appId: 'test-app-id',
  conversationVariables: [],
  environmentVariables: [],
  syncWorkflowDraftHash: 'current-hash-123',
  isWorkflowDataLoaded: true,
  setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
  setDraftUpdatedAt: mockSetDraftUpdatedAt,
  ...overrides,
})

const mockWorkflowStoreGetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
  }),
}))

// Mock useWorkflowRefreshDraft (THE KEY DEPENDENCY FOR THIS TEST)
const mockHandleRefreshWorkflowDraft = vi.fn()
vi.mock('.', () => ({
  useWorkflowRefreshDraft: () => ({
    handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft,
  }),
}))

// Mock API_PREFIX
vi.mock('@/config', () => ({
  API_PREFIX: '/api',
}))

// Create a mock error response that mimics the actual API error
const createMockErrorResponse = (code: string) => {
  const errorBody = { code, message: 'Draft not in sync' }
  let bodyUsed = false

  return {
    json: vi.fn().mockImplementation(() => {
      bodyUsed = true
      return Promise.resolve(errorBody)
    }),
    get bodyUsed() {
      return bodyUsed
    },
  }
}

describe('useNodesSyncDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetNodesReadOnly.mockReturnValue(false)
    mockGetNodes.mockReturnValue([
      { id: 'node-1', type: 'start', data: { type: 'start' } },
      { id: 'node-2', type: 'llm', data: { type: 'llm' } },
    ])
    mockStoreState.edges = [
      { id: 'edge-1', source: 'node-1', target: 'node-2', data: {} },
    ]
    mockWorkflowStoreGetState.mockReturnValue(createMockWorkflowStoreState())
    mockSyncWorkflowDraft.mockResolvedValue({
      hash: 'new-hash-456',
      updated_at: Date.now(),
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('doSyncWorkflowDraft function', () => {
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

  describe('successful sync', () => {
    it('should call syncWorkflowDraft service on successful sync', async () => {
      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith({
        url: '/apps/test-app-id/workflows/draft',
        params: expect.objectContaining({
          hash: 'current-hash-123',
          graph: expect.objectContaining({
            nodes: expect.any(Array),
            edges: expect.any(Array),
            viewport: expect.any(Object),
          }),
        }),
      })
    })

    it('should update syncWorkflowDraftHash on success', async () => {
      mockSyncWorkflowDraft.mockResolvedValue({
        hash: 'new-hash-789',
        updated_at: 1234567890,
      })

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash-789')
    })

    it('should update draftUpdatedAt on success', async () => {
      const updatedAt = 1234567890
      mockSyncWorkflowDraft.mockResolvedValue({
        hash: 'new-hash',
        updated_at: updatedAt,
      })

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith(updatedAt)
    })

    it('should call onSuccess callback on success', async () => {
      const onSuccess = vi.fn()
      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onSuccess })
      })

      expect(onSuccess).toHaveBeenCalled()
    })

    it('should call onSettled callback after success', async () => {
      const onSettled = vi.fn()
      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onSettled })
      })

      expect(onSettled).toHaveBeenCalled()
    })
  })

  describe('sync error handling - draft_workflow_not_sync (THE KEY FIX)', () => {
    /**
     * This is THE KEY TEST for the bug fix.
     *
     * SCENARIO: Multi-tab editing
     * 1. User opens workflow in Tab A and Tab B
     * 2. Tab A saves draft successfully, gets new hash
     * 3. Tab B tries to save with old hash
     * 4. Server returns 400 with code 'draft_workflow_not_sync'
     *
     * BEFORE FIX:
     * - handleRefreshWorkflowDraft() was called without arguments
     * - This would fetch draft AND overwrite the canvas
     * - User loses their unsaved changes in Tab B
     *
     * AFTER FIX:
     * - handleRefreshWorkflowDraft(true) is called
     * - This fetches draft but DOES NOT overwrite canvas
     * - Only hash is updated for the next sync attempt
     * - User's unsaved changes are preserved
     */
    it('should call handleRefreshWorkflowDraft with notUpdateCanvas=true when draft_workflow_not_sync error occurs', async () => {
      const mockError = createMockErrorResponse('draft_workflow_not_sync')
      mockSyncWorkflowDraft.mockRejectedValue(mockError)

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      // THE KEY ASSERTION: handleRefreshWorkflowDraft must be called with true
      await waitFor(() => {
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledWith(true)
      })
    })

    it('should NOT call handleRefreshWorkflowDraft when notRefreshWhenSyncError is true', async () => {
      const mockError = createMockErrorResponse('draft_workflow_not_sync')
      mockSyncWorkflowDraft.mockRejectedValue(mockError)

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        // First parameter is notRefreshWhenSyncError
        await result.current.doSyncWorkflowDraft(true)
      })

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should call onError callback when draft_workflow_not_sync error occurs', async () => {
      const mockError = createMockErrorResponse('draft_workflow_not_sync')
      mockSyncWorkflowDraft.mockRejectedValue(mockError)
      const onError = vi.fn()

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onError })
      })

      expect(onError).toHaveBeenCalled()
    })

    it('should call onSettled callback after error', async () => {
      const mockError = createMockErrorResponse('draft_workflow_not_sync')
      mockSyncWorkflowDraft.mockRejectedValue(mockError)
      const onSettled = vi.fn()

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onSettled })
      })

      expect(onSettled).toHaveBeenCalled()
    })
  })

  describe('other error handling', () => {
    it('should NOT call handleRefreshWorkflowDraft for non-draft_workflow_not_sync errors', async () => {
      const mockError = createMockErrorResponse('some_other_error')
      mockSyncWorkflowDraft.mockRejectedValue(mockError)

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should handle error without json method', async () => {
      const mockError = new Error('Network error')
      mockSyncWorkflowDraft.mockRejectedValue(mockError)

      const { result } = renderHook(() => useNodesSyncDraft())
      const onError = vi.fn()

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onError })
      })

      expect(onError).toHaveBeenCalled()
      expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should handle error with bodyUsed already true', async () => {
      const mockError = {
        json: vi.fn(),
        bodyUsed: true,
      }
      mockSyncWorkflowDraft.mockRejectedValue(mockError)

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      // Should not call json() when bodyUsed is true
      expect(mockError.json).not.toHaveBeenCalled()
      expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
    })
  })

  describe('read-only mode', () => {
    it('should not sync when nodes are read-only', async () => {
      mockGetNodesReadOnly.mockReturnValue(true)

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should not sync on page close when nodes are read-only', () => {
      mockGetNodesReadOnly.mockReturnValue(true)

      // Mock sendBeacon
      const mockSendBeacon = vi.fn()
      Object.defineProperty(navigator, 'sendBeacon', {
        value: mockSendBeacon,
        writable: true,
      })

      const { result } = renderHook(() => useNodesSyncDraft())

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockSendBeacon).not.toHaveBeenCalled()
    })
  })

  describe('workflow data not loaded', () => {
    it('should not sync when workflow data is not loaded', async () => {
      mockWorkflowStoreGetState.mockReturnValue(
        createMockWorkflowStoreState({ isWorkflowDataLoaded: false }),
      )

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    })
  })

  describe('no appId', () => {
    it('should not sync when appId is not set', async () => {
      mockWorkflowStoreGetState.mockReturnValue(
        createMockWorkflowStoreState({ appId: null }),
      )

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    })
  })

  describe('node filtering', () => {
    it('should filter out temp nodes', async () => {
      mockGetNodes.mockReturnValue([
        { id: 'node-1', type: 'start', data: { type: 'start' } },
        { id: 'node-temp', type: 'custom', data: { type: 'custom', _isTempNode: true } },
        { id: 'node-2', type: 'llm', data: { type: 'llm' } },
      ])

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            graph: expect.objectContaining({
              nodes: expect.not.arrayContaining([
                expect.objectContaining({ id: 'node-temp' }),
              ]),
            }),
          }),
        }),
      )
    })

    it('should remove internal underscore properties from nodes', async () => {
      mockGetNodes.mockReturnValue([
        {
          id: 'node-1',
          type: 'start',
          data: {
            type: 'start',
            _internalProp: 'should be removed',
            _anotherInternal: true,
            publicProp: 'should remain',
          },
        },
      ])

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      const callArgs = mockSyncWorkflowDraft.mock.calls[0][0]
      const sentNode = callArgs.params.graph.nodes[0]

      expect(sentNode.data).not.toHaveProperty('_internalProp')
      expect(sentNode.data).not.toHaveProperty('_anotherInternal')
      expect(sentNode.data).toHaveProperty('publicProp', 'should remain')
    })
  })

  describe('edge filtering', () => {
    it('should filter out temp edges', async () => {
      mockStoreState.edges = [
        { id: 'edge-1', source: 'node-1', target: 'node-2', data: {} },
        { id: 'edge-temp', source: 'node-1', target: 'node-3', data: { _isTemp: true } },
      ]

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      const callArgs = mockSyncWorkflowDraft.mock.calls[0][0]
      const sentEdges = callArgs.params.graph.edges

      expect(sentEdges).toHaveLength(1)
      expect(sentEdges[0].id).toBe('edge-1')
    })

    it('should remove internal underscore properties from edges', async () => {
      mockStoreState.edges = [
        {
          id: 'edge-1',
          source: 'node-1',
          target: 'node-2',
          data: {
            _internalEdgeProp: 'should be removed',
            publicEdgeProp: 'should remain',
          },
        },
      ]

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      const callArgs = mockSyncWorkflowDraft.mock.calls[0][0]
      const sentEdge = callArgs.params.graph.edges[0]

      expect(sentEdge.data).not.toHaveProperty('_internalEdgeProp')
      expect(sentEdge.data).toHaveProperty('publicEdgeProp', 'should remain')
    })
  })

  describe('viewport handling', () => {
    it('should send current viewport from transform', async () => {
      mockStoreState.transform = [100, 200, 1.5]

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            graph: expect.objectContaining({
              viewport: { x: 100, y: 200, zoom: 1.5 },
            }),
          }),
        }),
      )
    })
  })

  describe('multi-tab concurrent editing scenario (END-TO-END TEST)', () => {
    /**
     * Simulates the complete multi-tab scenario to verify the fix works correctly.
     *
     * Scenario:
     * 1. Tab A and Tab B both have the workflow open with hash 'hash-v1'
     * 2. Tab A saves successfully, server returns 'hash-v2'
     * 3. Tab B tries to save with 'hash-v1', gets 'draft_workflow_not_sync' error
     * 4. Tab B should only update hash to 'hash-v2', not overwrite canvas
     * 5. Tab B can now retry save with correct hash
     */
    it('should preserve canvas data during hash conflict resolution', async () => {
      // Initial state: both tabs have hash-v1
      mockWorkflowStoreGetState.mockReturnValue(
        createMockWorkflowStoreState({ syncWorkflowDraftHash: 'hash-v1' }),
      )

      // Tab B tries to save with old hash, server returns error
      const syncError = createMockErrorResponse('draft_workflow_not_sync')
      mockSyncWorkflowDraft.mockRejectedValue(syncError)

      const { result } = renderHook(() => useNodesSyncDraft())

      // Tab B attempts to sync
      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      // Verify the sync was attempted with old hash
      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            hash: 'hash-v1',
          }),
        }),
      )

      // Verify handleRefreshWorkflowDraft was called with true (not overwrite canvas)
      await waitFor(() => {
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledWith(true)
      })

      // The key assertion: only one argument (true) was passed
      expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(mockHandleRefreshWorkflowDraft.mock.calls[0]).toEqual([true])
    })

    it('should handle multiple consecutive sync failures gracefully', async () => {
      // Create fresh error for each call to avoid bodyUsed issue
      mockSyncWorkflowDraft
        .mockRejectedValueOnce(createMockErrorResponse('draft_workflow_not_sync'))
        .mockRejectedValueOnce(createMockErrorResponse('draft_workflow_not_sync'))

      const { result } = renderHook(() => useNodesSyncDraft())

      // First sync attempt
      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      // Wait for first refresh call
      await waitFor(() => {
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(1)
      })

      // Second sync attempt
      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      // Both should call handleRefreshWorkflowDraft with true
      await waitFor(() => {
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(2)
      })

      mockHandleRefreshWorkflowDraft.mock.calls.forEach((call) => {
        expect(call).toEqual([true])
      })
    })
  })

  describe('callbacks behavior', () => {
    it('should not call onSuccess when sync fails', async () => {
      const syncError = createMockErrorResponse('draft_workflow_not_sync')
      mockSyncWorkflowDraft.mockRejectedValue(syncError)
      const onSuccess = vi.fn()
      const onError = vi.fn()

      const { result } = renderHook(() => useNodesSyncDraft())

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onSuccess, onError })
      })

      expect(onSuccess).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalled()
    })

    it('should always call onSettled regardless of success or failure', async () => {
      const onSettled = vi.fn()

      const { result } = renderHook(() => useNodesSyncDraft())

      // Test success case
      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onSettled })
      })
      expect(onSettled).toHaveBeenCalledTimes(1)

      // Reset
      onSettled.mockClear()

      // Test failure case
      const syncError = createMockErrorResponse('draft_workflow_not_sync')
      mockSyncWorkflowDraft.mockRejectedValue(syncError)

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, { onSettled })
      })
      expect(onSettled).toHaveBeenCalledTimes(1)
    })
  })
})
