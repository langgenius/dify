import { waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { BlockEnum } from '@/app/components/workflow/types'
import { createDeferred } from '@/test/deferred'
import { usePipelineRefreshDraft } from '../use-pipeline-refresh-draft'

const mockWorkflowStoreGetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
  }),
}))

const mockHandleUpdateWorkflowCanvas = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas,
  }),
}))

const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (url: string) => mockFetchWorkflowDraft(url),
}))

describe('usePipelineRefreshDraft', () => {
  const mockSetSyncWorkflowDraftHash = vi.fn()
  const mockSetIsSyncingWorkflowDraft = vi.fn()
  const mockSetEnvironmentVariables = vi.fn()
  const mockSetEnvSecrets = vi.fn()
  const mockSetRagPipelineVariables = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockWorkflowStoreGetState.mockReturnValue({
      pipelineId: 'test-pipeline-id',
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft: mockSetIsSyncingWorkflowDraft,
      setEnvironmentVariables: mockSetEnvironmentVariables,
      setEnvSecrets: mockSetEnvSecrets,
      setRagPipelineVariables: mockSetRagPipelineVariables,
    })

    mockFetchWorkflowDraft.mockResolvedValue({
      graph: {
        nodes: [createNode({ id: 'node-1', data: { type: BlockEnum.DataSource } })],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      hash: 'new-hash',
      environment_variables: [],
      rag_pipeline_variables: [],
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('handleRefreshWorkflowDraft', () => {
    it('refreshes graph and input variables after the draft resolves', async () => {
      const response = {
        graph: {
          nodes: [createNode({ id: 'source', data: { type: BlockEnum.DataSource } })],
          edges: [],
          viewport: { x: 10, y: 20, zoom: 1.5 },
        },
        hash: 'new-hash',
        environment_variables: [],
        rag_pipeline_variables: [{ variable: 'query', type: 'text-input' }],
      }
      const pending = createDeferred<typeof response>()
      mockFetchWorkflowDraft.mockReturnValue(pending.promise)
      const { result } = renderHook(() => usePipelineRefreshDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })
      act(() => result.current.handleRefreshWorkflowDraft())
      expect(mockFetchWorkflowDraft).toHaveBeenCalledExactlyOnceWith(
        '/rag/pipelines/test-pipeline-id/workflows/draft',
      )
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(true)
      expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
      await act(async () => pending.resolve(response))
      await waitFor(() => expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false))
      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledExactlyOnceWith(response.graph)
      expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash')
      expect(mockSetRagPipelineVariables).toHaveBeenCalledWith(response.rag_pipeline_variables)
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

      const { result } = renderHook(() => usePipelineRefreshDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      act(() => {
        result.current.handleRefreshWorkflowDraft()
      })

      await waitFor(() =>
        expect(mockSetEnvSecrets).toHaveBeenCalledWith({ 'env-1': 'secret-value' }),
      )
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

      const { result } = renderHook(() => usePipelineRefreshDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

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

      const { result } = renderHook(() => usePipelineRefreshDraft(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

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
