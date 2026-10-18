import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { createHttpError } from '@/service/http-error'
import { createDeferred } from '@/test/deferred'
import { usePipelineInit } from '../use-pipeline-init'

const mockWorkflowStoreGetState = vi.fn()
const mockWorkflowStoreSetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
    setState: mockWorkflowStoreSetState,
  }),
}))

const mockUseDatasetDetailContextWithSelector = vi.fn()
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    mockUseDatasetDetailContextWithSelector(selector),
}))

const mockFetchWorkflowDraft = vi.fn()
const mockSyncWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (url: string) => mockFetchWorkflowDraft(url),
  syncWorkflowDraft: (params: unknown) => mockSyncWorkflowDraft(params),
}))

vi.mock('../use-pipeline-config', () => ({
  usePipelineConfig: vi.fn(),
}))

vi.mock('../use-pipeline-template', () => ({
  usePipelineTemplate: () => ({
    nodes: [{ id: 'template-node' }],
    edges: [],
  }),
}))

describe('usePipelineInit', () => {
  const mockSetEnvSecrets = vi.fn()
  const mockSetEnvironmentVariables = vi.fn()
  const mockSetSyncWorkflowDraftHash = vi.fn()
  const mockSetDraftUpdatedAt = vi.fn()
  const mockSetToolPublished = vi.fn()
  const mockSetRagPipelineVariables = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockWorkflowStoreGetState.mockReturnValue({
      setEnvSecrets: mockSetEnvSecrets,
      setEnvironmentVariables: mockSetEnvironmentVariables,
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setDraftUpdatedAt: mockSetDraftUpdatedAt,
      setToolPublished: mockSetToolPublished,
      setRagPipelineVariables: mockSetRagPipelineVariables,
    })

    mockUseDatasetDetailContextWithSelector.mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) => {
        const state = {
          dataset: {
            pipeline_id: 'test-pipeline-id',
            name: 'Test Knowledge',
            icon_info: { icon: 'test-icon', icon_type: 'emoji' },
          },
        }
        return selector(state)
      },
    )

    mockFetchWorkflowDraft.mockResolvedValue({
      graph: {
        nodes: [{ id: 'node-1' }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      hash: 'test-hash',
      updated_at: '2024-01-01T00:00:00Z',
      tool_published: true,
      environment_variables: [],
      rag_pipeline_variables: [],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('hook initialization', () => {
    it('should initialize the knowledge presentation metadata', () => {
      renderHook(() => usePipelineInit(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
        knowledgeName: 'Test Knowledge',
        knowledgeIcon: {
          icon: 'test-icon',
          icon_type: 'emoji',
          icon_background: undefined,
          icon_url: undefined,
        },
      })
    })
  })

  describe('data fetching', () => {
    it('loads the graph and draft metadata only after initialization resolves', async () => {
      const response = {
        graph: { nodes: [{ id: 'node-1' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        hash: 'test-hash',
        updated_at: '2024-01-01T00:00:00Z',
        tool_published: true,
        environment_variables: [],
        rag_pipeline_variables: [],
      }
      const pending = createDeferred<typeof response>()
      mockFetchWorkflowDraft.mockReturnValue(pending.promise)
      const { result } = renderHook(() => usePipelineInit(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })
      expect(result.current).toEqual({ data: undefined, isLoading: true })
      expect(mockFetchWorkflowDraft).toHaveBeenCalledExactlyOnceWith(
        '/rag/pipelines/test-pipeline-id/workflows/draft',
      )
      expect(mockWorkflowStoreSetState).not.toHaveBeenCalledWith({ isWorkflowDataLoaded: true })
      await act(async () => pending.resolve(response))
      await waitFor(() => expect(result.current).toEqual({ data: response, isLoading: false }))
      expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith(response.updated_at)
      expect(mockSetToolPublished).toHaveBeenCalledWith(true)
      expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('test-hash')
      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ isWorkflowDataLoaded: true })
    })
  })

  describe('environment variables handling', () => {
    it('should mask secret values in environment variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        graph: { nodes: [], edges: [], viewport: {} },
        hash: 'test-hash',
        updated_at: '2024-01-01T00:00:00Z',
        tool_published: false,
        environment_variables: [
          { id: 'env-1', value_type: 'secret', value: 'secret-value' },
          { id: 'env-2', value_type: 'string', value: 'plain-value' },
        ],
        rag_pipeline_variables: [],
      })

      renderHook(() => usePipelineInit(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
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
        graph: { nodes: [], edges: [], viewport: {} },
        hash: 'test-hash',
        updated_at: '2024-01-01T00:00:00Z',
        tool_published: false,
        environment_variables: [],
        rag_pipeline_variables: [],
      })

      renderHook(() => usePipelineInit(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await waitFor(() => {
        expect(mockSetEnvSecrets).toHaveBeenCalledWith({})
        expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([])
      })
    })
  })

  describe('rag pipeline variables handling', () => {
    it('should set rag pipeline variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        graph: { nodes: [], edges: [], viewport: {} },
        hash: 'test-hash',
        updated_at: '2024-01-01T00:00:00Z',
        tool_published: false,
        environment_variables: [],
        rag_pipeline_variables: [{ variable: 'query', type: 'text-input' }],
      })

      renderHook(() => usePipelineInit(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalledWith([
          { variable: 'query', type: 'text-input' },
        ])
      })
    })

    it('should handle undefined rag pipeline variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        graph: { nodes: [], edges: [], viewport: {} },
        hash: 'test-hash',
        updated_at: '2024-01-01T00:00:00Z',
        tool_published: false,
        environment_variables: [],
        rag_pipeline_variables: undefined,
      })

      renderHook(() => usePipelineInit(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalledWith([])
      })
    })
  })

  describe('draft not exist error handling', () => {
    it('should create initial workflow when draft does not exist', async () => {
      const mockJsonError = createHttpError(new Response(null, { status: 404 }), {
        code: 'draft_workflow_not_exist',
        message: 'Draft workflow not exist.',
        status: 404,
      })
      mockFetchWorkflowDraft.mockRejectedValueOnce(mockJsonError)
      mockSyncWorkflowDraft.mockResolvedValue({ updated_at: '2024-01-02T00:00:00Z' })

      mockFetchWorkflowDraft.mockResolvedValueOnce({
        graph: { nodes: [], edges: [], viewport: {} },
        hash: 'new-hash',
        updated_at: '2024-01-02T00:00:00Z',
        tool_published: false,
        environment_variables: [],
        rag_pipeline_variables: [],
      })

      const { result } = renderHook(() => usePipelineInit(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await waitFor(() => {
        expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
          notInitialWorkflow: true,
          shouldAutoOpenStartNodeSelector: true,
        })
      })
      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(mockSyncWorkflowDraft).toHaveBeenCalledExactlyOnceWith({
        url: '/rag/pipelines/test-pipeline-id/workflows/draft',
        params: {
          graph: { nodes: [{ id: 'template-node' }], edges: [] },
          environment_variables: [],
        },
      })
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(result.current.data?.hash).toBe('new-hash')
    })
  })

  describe('missing presentation metadata', () => {
    it('loads the editor pipeline when dataset presentation metadata is missing', async () => {
      mockUseDatasetDetailContextWithSelector.mockImplementation(
        (selector: (state: Record<string, unknown>) => unknown) => {
          const state = { dataset: undefined }
          return selector(state)
        },
      )

      renderHook(() => usePipelineInit(), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      })

      await waitFor(() => {
        expect(mockFetchWorkflowDraft).toHaveBeenCalledWith(
          '/rag/pipelines/test-pipeline-id/workflows/draft',
        )
      })
    })
  })
})
