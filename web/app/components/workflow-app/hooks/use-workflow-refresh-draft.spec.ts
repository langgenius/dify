/**
 * Test Suite for useWorkflowRefreshDraft Hook
 *
 * PURPOSE:
 * This hook is responsible for refreshing workflow draft data from the server.
 * The key fix being tested is the `notUpdateCanvas` parameter behavior.
 *
 * MULTI-TAB PROBLEM SCENARIO:
 * 1. User opens the same workflow in Tab A and Tab B (both have hash: v1)
 * 2. Tab A saves successfully, server returns new hash: v2
 * 3. Tab B tries to save with old hash: v1, server returns 400 error (draft_workflow_not_sync)
 * 4. BEFORE FIX: handleRefreshWorkflowDraft() was called without args, which fetched
 *    draft AND overwrote canvas - user lost unsaved changes in Tab B
 * 5. AFTER FIX: handleRefreshWorkflowDraft(true) is called, which fetches draft but
 *    only updates hash, preserving user's canvas changes
 *
 * TESTING STRATEGY:
 * We don't simulate actual tab switching UI behavior. Instead, we test the hook's
 * response to specific inputs:
 * - When notUpdateCanvas=true: should NOT call handleUpdateWorkflowCanvas
 * - When notUpdateCanvas=false/undefined: should call handleUpdateWorkflowCanvas
 *
 * This is behavior-driven testing - we verify "what the code does when given specific
 * inputs" rather than simulating complete user interaction flows.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkflowRefreshDraft } from './use-workflow-refresh-draft'

// Mock the workflow service
const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

// Mock the workflow update hook
const mockHandleUpdateWorkflowCanvas = vi.fn()
vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas,
  }),
}))

// Mock store state
const mockSetSyncWorkflowDraftHash = vi.fn()
const mockSetIsSyncingWorkflowDraft = vi.fn()
const mockSetEnvironmentVariables = vi.fn()
const mockSetEnvSecrets = vi.fn()
const mockSetConversationVariables = vi.fn()
const mockSetIsWorkflowDataLoaded = vi.fn()
const mockCancelDebouncedSync = vi.fn()

const createMockStoreState = (overrides = {}) => ({
  appId: 'test-app-id',
  setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
  setIsSyncingWorkflowDraft: mockSetIsSyncingWorkflowDraft,
  setEnvironmentVariables: mockSetEnvironmentVariables,
  setEnvSecrets: mockSetEnvSecrets,
  setConversationVariables: mockSetConversationVariables,
  setIsWorkflowDataLoaded: mockSetIsWorkflowDataLoaded,
  isWorkflowDataLoaded: true,
  debouncedSyncWorkflowDraft: {
    cancel: mockCancelDebouncedSync,
  },
  ...overrides,
})

const mockWorkflowStoreGetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
  }),
}))

// Default mock response from fetchWorkflowDraft
const createMockDraftResponse = (overrides = {}) => ({
  hash: 'new-hash-12345',
  graph: {
    nodes: [{ id: 'node-1', type: 'start', data: {} }],
    edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
    viewport: { x: 100, y: 200, zoom: 1.5 },
  },
  environment_variables: [
    { id: 'env-1', name: 'API_KEY', value: 'secret-key', value_type: 'secret' },
    { id: 'env-2', name: 'BASE_URL', value: 'https://api.example.com', value_type: 'string' },
  ],
  conversation_variables: [
    { id: 'conv-1', name: 'user_input', value: 'test' },
  ],
  ...overrides,
})

describe('useWorkflowRefreshDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStoreGetState.mockReturnValue(createMockStoreState())
    mockFetchWorkflowDraft.mockResolvedValue(createMockDraftResponse())
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('handleRefreshWorkflowDraft function', () => {
    it('should return handleRefreshWorkflowDraft function', () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      expect(result.current.handleRefreshWorkflowDraft).toBeDefined()
      expect(typeof result.current.handleRefreshWorkflowDraft).toBe('function')
    })
  })

  describe('notUpdateCanvas parameter behavior (THE KEY FIX)', () => {
    it('should NOT call handleUpdateWorkflowCanvas when notUpdateCanvas is true', async () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(true)
      })

      await waitFor(() => {
        expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('/apps/test-app-id/workflows/draft')
      })

      await waitFor(() => {
        expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash-12345')
      })

      // THE KEY ASSERTION: Canvas should NOT be updated when notUpdateCanvas is true
      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    })

    it('should call handleUpdateWorkflowCanvas when notUpdateCanvas is false', async () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(false)
      })

      await waitFor(() => {
        expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('/apps/test-app-id/workflows/draft')
      })

      await waitFor(() => {
        // Canvas SHOULD be updated when notUpdateCanvas is false
        expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
          nodes: [{ id: 'node-1', type: 'start', data: {} }],
          edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
          viewport: { x: 100, y: 200, zoom: 1.5 },
        })
      })

      await waitFor(() => {
        expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash-12345')
      })
    })

    it('should call handleUpdateWorkflowCanvas when notUpdateCanvas is undefined (default)', async () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        expect(mockFetchWorkflowDraft).toHaveBeenCalled()
      })

      await waitFor(() => {
        // Canvas SHOULD be updated when notUpdateCanvas is undefined
        expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalled()
      })
    })

    it('should still update hash even when notUpdateCanvas is true', async () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(true)
      })

      await waitFor(() => {
        expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash-12345')
      })

      // Verify canvas was NOT updated
      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    })

    it('should still update environment variables when notUpdateCanvas is true', async () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(true)
      })

      await waitFor(() => {
        expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([
          { id: 'env-1', name: 'API_KEY', value: '[__HIDDEN__]', value_type: 'secret' },
          { id: 'env-2', name: 'BASE_URL', value: 'https://api.example.com', value_type: 'string' },
        ])
      })

      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    })

    it('should still update env secrets when notUpdateCanvas is true', async () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(true)
      })

      await waitFor(() => {
        expect(mockSetEnvSecrets).toHaveBeenCalledWith({
          'env-1': 'secret-key',
        })
      })

      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    })

    it('should still update conversation variables when notUpdateCanvas is true', async () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(true)
      })

      await waitFor(() => {
        expect(mockSetConversationVariables).toHaveBeenCalledWith([
          { id: 'conv-1', name: 'user_input', value: 'test' },
        ])
      })

      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    })
  })

  describe('syncing state management', () => {
    it('should set isSyncingWorkflowDraft to true before fetch', () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenCalledWith(true)
    })

    it('should set isSyncingWorkflowDraft to false after fetch completes', async () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        expect(mockSetIsSyncingWorkflowDraft).toHaveBeenCalledWith(false)
      })
    })

    it('should set isSyncingWorkflowDraft to false even when fetch fails', async () => {
      mockFetchWorkflowDraft.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        expect(mockSetIsSyncingWorkflowDraft).toHaveBeenCalledWith(false)
      })
    })
  })

  describe('isWorkflowDataLoaded flag management', () => {
    it('should set isWorkflowDataLoaded to false before fetch when it was true', () => {
      mockWorkflowStoreGetState.mockReturnValue(
        createMockStoreState({ isWorkflowDataLoaded: true }),
      )

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      expect(mockSetIsWorkflowDataLoaded).toHaveBeenCalledWith(false)
    })

    it('should set isWorkflowDataLoaded to true after fetch succeeds', async () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        expect(mockSetIsWorkflowDataLoaded).toHaveBeenCalledWith(true)
      })
    })

    it('should restore isWorkflowDataLoaded when fetch fails and it was previously loaded', async () => {
      mockWorkflowStoreGetState.mockReturnValue(
        createMockStoreState({ isWorkflowDataLoaded: true }),
      )
      mockFetchWorkflowDraft.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        // Should restore to true because wasLoaded was true
        expect(mockSetIsWorkflowDataLoaded).toHaveBeenLastCalledWith(true)
      })
    })
  })

  describe('debounced sync cancellation', () => {
    it('should cancel debounced sync before fetching draft', () => {
      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      expect(mockCancelDebouncedSync).toHaveBeenCalled()
    })

    it('should handle case when debouncedSyncWorkflowDraft has no cancel method', () => {
      mockWorkflowStoreGetState.mockReturnValue(
        createMockStoreState({ debouncedSyncWorkflowDraft: {} }),
      )

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      // Should not throw
      expect(() => {
        act(() => {
          result.current.handleRefreshWorkflowDraft()
        })
      }).not.toThrow()
    })
  })

  describe('edge cases', () => {
    it('should handle empty graph in response', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        hash: 'hash-empty',
        graph: null,
        environment_variables: [],
        conversation_variables: [],
      })

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(false)
      })

      await waitFor(() => {
        expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        })
      })
    })

    it('should handle missing viewport in response', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        hash: 'hash-no-viewport',
        graph: {
          nodes: [{ id: 'node-1' }],
          edges: [],
          viewport: null,
        },
        environment_variables: [],
        conversation_variables: [],
      })

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(false)
      })

      await waitFor(() => {
        expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
          nodes: [{ id: 'node-1' }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        })
      })
    })

    it('should handle missing environment_variables in response', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        hash: 'hash-no-env',
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        environment_variables: undefined,
        conversation_variables: [],
      })

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(true)
      })

      await waitFor(() => {
        expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([])
        expect(mockSetEnvSecrets).toHaveBeenCalledWith({})
      })
    })

    it('should handle missing conversation_variables in response', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        hash: 'hash-no-conv',
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        environment_variables: [],
        conversation_variables: undefined,
      })

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(true)
      })

      await waitFor(() => {
        expect(mockSetConversationVariables).toHaveBeenCalledWith([])
      })
    })

    it('should filter only secret type for envSecrets', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        hash: 'hash-mixed-env',
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        environment_variables: [
          { id: 'env-1', name: 'SECRET_KEY', value: 'secret-value', value_type: 'secret' },
          { id: 'env-2', name: 'PUBLIC_URL', value: 'https://example.com', value_type: 'string' },
          { id: 'env-3', name: 'ANOTHER_SECRET', value: 'another-secret', value_type: 'secret' },
        ],
        conversation_variables: [],
      })

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(true)
      })

      await waitFor(() => {
        expect(mockSetEnvSecrets).toHaveBeenCalledWith({
          'env-1': 'secret-value',
          'env-3': 'another-secret',
        })
      })
    })

    it('should hide secret values in environment variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        hash: 'hash-secrets',
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        environment_variables: [
          { id: 'env-1', name: 'SECRET_KEY', value: 'super-secret', value_type: 'secret' },
          { id: 'env-2', name: 'PUBLIC_URL', value: 'https://example.com', value_type: 'string' },
        ],
        conversation_variables: [],
      })

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft(true)
      })

      await waitFor(() => {
        expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([
          { id: 'env-1', name: 'SECRET_KEY', value: '[__HIDDEN__]', value_type: 'secret' },
          { id: 'env-2', name: 'PUBLIC_URL', value: 'https://example.com', value_type: 'string' },
        ])
      })
    })
  })

  describe('multi-tab scenario simulation (THE BUG FIX VERIFICATION)', () => {
    /**
     * This test verifies the fix for the multi-tab scenario:
     * 1. User opens workflow in Tab A and Tab B
     * 2. Tab A saves draft successfully
     * 3. Tab B tries to save but gets 'draft_workflow_not_sync' error (hash mismatch)
     * 4. BEFORE FIX: Tab B would fetch draft and overwrite canvas with old data
     * 5. AFTER FIX: Tab B only updates hash, preserving user's canvas changes
     */
    it('should only update hash when called with notUpdateCanvas=true (simulating sync error recovery)', async () => {
      const mockResponse = createMockDraftResponse()
      mockFetchWorkflowDraft.mockResolvedValue(mockResponse)

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      // Simulate the sync error recovery scenario where notUpdateCanvas is true
      act(() => {
        result.current.handleRefreshWorkflowDraft(true)
      })

      await waitFor(() => {
        expect(mockFetchWorkflowDraft).toHaveBeenCalled()
      })

      await waitFor(() => {
        // Hash should be updated for next sync attempt
        expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash-12345')
      })

      // Canvas should NOT be updated - user's changes are preserved
      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()

      // Other states should still be updated
      expect(mockSetEnvironmentVariables).toHaveBeenCalled()
      expect(mockSetConversationVariables).toHaveBeenCalled()
    })

    it('should update canvas when called with notUpdateCanvas=false (normal refresh)', async () => {
      const mockResponse = createMockDraftResponse()
      mockFetchWorkflowDraft.mockResolvedValue(mockResponse)

      const { result } = renderHook(() => useWorkflowRefreshDraft())

      // Simulate normal refresh scenario
      act(() => {
        result.current.handleRefreshWorkflowDraft(false)
      })

      await waitFor(() => {
        expect(mockFetchWorkflowDraft).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash-12345')
      })

      // Canvas SHOULD be updated in normal refresh
      await waitFor(() => {
        expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalled()
      })
    })
  })
})
