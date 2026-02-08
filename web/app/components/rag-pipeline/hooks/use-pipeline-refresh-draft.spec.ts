import { renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// Import after mocks
// ============================================================================

import { usePipelineRefreshDraft } from './use-pipeline-refresh-draft'

// ============================================================================
// Mocks
// ============================================================================

// Mock workflow store
const mockWorkflowStoreGetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
  }),
}))

// Mock useWorkflowUpdate
const mockHandleUpdateWorkflowCanvas = vi.fn()
vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas,
  }),
}))

// Mock workflow service
const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (url: string) => mockFetchWorkflowDraft(url),
}))

// Mock utils
vi.mock('../utils', () => ({
  processNodesWithoutDataSource: (nodes: unknown[], viewport: unknown) => ({
    nodes,
    viewport,
  }),
}))

// ============================================================================
// Tests
// ============================================================================

describe('usePipelineRefreshDraft', () => {
  const mockSetSyncWorkflowDraftHash = vi.fn()
  const mockSetIsSyncingWorkflowDraft = vi.fn()
  const mockSetEnvironmentVariables = vi.fn()
  const mockSetEnvSecrets = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockWorkflowStoreGetState.mockReturnValue({
      pipelineId: 'test-pipeline-id',
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft: mockSetIsSyncingWorkflowDraft,
      setEnvironmentVariables: mockSetEnvironmentVariables,
      setEnvSecrets: mockSetEnvSecrets,
    })

    mockFetchWorkflowDraft.mockResolvedValue({
      graph: {
        nodes: [{ id: 'node-1' }],
        edges: [{ id: 'edge-1' }],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      hash: 'new-hash',
      environment_variables: [],
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('hook initialization', () => {
    it('should return handleRefreshWorkflowDraft function', () => {
      const { result } = renderHook(() => usePipelineRefreshDraft())

      expect(result.current.handleRefreshWorkflowDraft).toBeDefined()
      expect(typeof result.current.handleRefreshWorkflowDraft).toBe('function')
    })
  })

  describe('handleRefreshWorkflowDraft', () => {
    it('should set syncing state to true at start', async () => {
      const { result } = renderHook(() => usePipelineRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenCalledWith(true)
    })

    it('should fetch workflow draft with correct URL', async () => {
      const { result } = renderHook(() => usePipelineRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('/rag/pipelines/test-pipeline-id/workflows/draft')
    })

    it('should update workflow canvas with response data', async () => {
      const { result } = renderHook(() => usePipelineRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalled()
      })
    })

    it('should update sync hash after fetch', async () => {
      const { result } = renderHook(() => usePipelineRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash')
      })
    })

    it('should set syncing state to false after completion', async () => {
      const { result } = renderHook(() => usePipelineRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)
      })
    })

    it('should handle secret environment variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        hash: 'new-hash',
        environment_variables: [
          { id: 'env-1', value_type: 'secret', value: 'secret-value' },
          { id: 'env-2', value_type: 'string', value: 'plain-value' },
        ],
      })

      const { result } = renderHook(() => usePipelineRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        expect(mockSetEnvSecrets).toHaveBeenCalledWith({ 'env-1': 'secret-value' })
      })
    })

    it('should mask secret values in environment variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        hash: 'new-hash',
        environment_variables: [
          { id: 'env-1', value_type: 'secret', value: 'secret-value' },
          { id: 'env-2', value_type: 'string', value: 'plain-value' },
        ],
      })

      const { result } = renderHook(() => usePipelineRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([
          { id: 'env-1', value_type: 'secret', value: '[__HIDDEN__]' },
          { id: 'env-2', value_type: 'string', value: 'plain-value' },
        ])
      })
    })

    it('should handle empty environment variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        hash: 'new-hash',
        environment_variables: [],
      })

      const { result } = renderHook(() => usePipelineRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        expect(mockSetEnvSecrets).toHaveBeenCalledWith({})
        expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([])
      })
    })

    it('should handle undefined environment variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        hash: 'new-hash',
        environment_variables: undefined,
      })

      const { result } = renderHook(() => usePipelineRefreshDraft())

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() => {
        expect(mockSetEnvSecrets).toHaveBeenCalledWith({})
        expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([])
      })
    })
  })
})
