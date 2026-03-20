import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    vi.spyOn(console, 'error').mockImplementation(() => {})

    mockWorkflowStoreGetState.mockReturnValue({
      setEnvSecrets: mockSetEnvSecrets,
      setEnvironmentVariables: mockSetEnvironmentVariables,
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setDraftUpdatedAt: mockSetDraftUpdatedAt,
      setToolPublished: mockSetToolPublished,
      setRagPipelineVariables: mockSetRagPipelineVariables,
    })

    mockUseDatasetDetailContextWithSelector.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
      const state = {
        dataset: {
          pipeline_id: 'test-pipeline-id',
          name: 'Test Knowledge',
          icon_info: { icon: 'test-icon' },
        },
      }
      return selector(state)
    })

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
    it('should return data and isLoading', async () => {
      const { result } = renderHook(() => usePipelineInit())

      expect(result.current.isLoading).toBe(true)
      expect(result.current.data).toBeUndefined()
    })

    it('should set pipelineId in workflow store on mount', () => {
      renderHook(() => usePipelineInit())

      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
        pipelineId: 'test-pipeline-id',
        knowledgeName: 'Test Knowledge',
        knowledgeIcon: { icon: 'test-icon' },
      })
    })
  })

  describe('data fetching', () => {
    it('should fetch workflow draft on mount', async () => {
      renderHook(() => usePipelineInit())

      await waitFor(() => {
        expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('/rag/pipelines/test-pipeline-id/workflows/draft')
      })
    })

    it('should set data after successful fetch', async () => {
      const { result } = renderHook(() => usePipelineInit())

      await waitFor(() => {
        expect(result.current.data).toBeDefined()
      })
    })

    it('should set isLoading to false after fetch', async () => {
      const { result } = renderHook(() => usePipelineInit())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })

    it('should set draft updated at', async () => {
      renderHook(() => usePipelineInit())

      await waitFor(() => {
        expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith('2024-01-01T00:00:00Z')
      })
    })

    it('should set tool published status', async () => {
      renderHook(() => usePipelineInit())

      await waitFor(() => {
        expect(mockSetToolPublished).toHaveBeenCalledWith(true)
      })
    })

    it('should set sync hash', async () => {
      renderHook(() => usePipelineInit())

      await waitFor(() => {
        expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('test-hash')
      })
    })
  })

  describe('environment variables handling', () => {
    it('should extract secret environment variables', async () => {
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

      renderHook(() => usePipelineInit())

      await waitFor(() => {
        expect(mockSetEnvSecrets).toHaveBeenCalledWith({ 'env-1': 'secret-value' })
      })
    })

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

      renderHook(() => usePipelineInit())

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

      renderHook(() => usePipelineInit())

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
        rag_pipeline_variables: [
          { variable: 'query', type: 'text-input' },
        ],
      })

      renderHook(() => usePipelineInit())

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

      renderHook(() => usePipelineInit())

      await waitFor(() => {
        expect(mockSetRagPipelineVariables).toHaveBeenCalledWith([])
      })
    })
  })

  describe('draft not exist error handling', () => {
    it('should create initial workflow when draft does not exist', async () => {
      const mockJsonError = {
        json: vi.fn().mockResolvedValue({ code: 'draft_workflow_not_exist' }),
        bodyUsed: false,
      }
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

      renderHook(() => usePipelineInit())

      await waitFor(() => {
        expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
          notInitialWorkflow: true,
          shouldAutoOpenStartNodeSelector: true,
        })
      })
    })

    it('should sync initial workflow with template nodes', async () => {
      const mockJsonError = {
        json: vi.fn().mockResolvedValue({ code: 'draft_workflow_not_exist' }),
        bodyUsed: false,
      }
      mockFetchWorkflowDraft.mockRejectedValueOnce(mockJsonError)
      mockSyncWorkflowDraft.mockResolvedValue({ updated_at: '2024-01-02T00:00:00Z' })

      renderHook(() => usePipelineInit())

      await waitFor(() => {
        expect(mockSyncWorkflowDraft).toHaveBeenCalledWith({
          url: '/rag/pipelines/test-pipeline-id/workflows/draft',
          params: {
            graph: {
              nodes: [{ id: 'template-node' }],
              edges: [],
            },
            environment_variables: [],
          },
        })
      })
    })
  })

  describe('missing datasetId', () => {
    it('should not fetch when datasetId is missing', async () => {
      mockUseDatasetDetailContextWithSelector.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
        const state = { dataset: undefined }
        return selector(state)
      })

      renderHook(() => usePipelineInit())

      await waitFor(() => {
        expect(mockFetchWorkflowDraft).toHaveBeenCalled()
      })
    })
  })
})
