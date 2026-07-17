import type { ReactNode } from 'react'
import type { DataSet } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { useDatasetCardState } from '../use-dataset-card-state'

type UsageQueryOptions = {
  input: {
    params: {
      dataset_id: string
    }
  }
  staleTime?: number
  retry?: boolean
  context?: {
    silent?: boolean
  }
}

const {
  mockToastSuccess,
  mockToastError,
  mockCheckUsage,
  mockDeleteDataset,
  mockExportPipeline,
  mockPush,
  mockUsageQueryOptions,
} = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockCheckUsage: vi.fn(),
  mockDeleteDataset: vi.fn(),
  mockExportPipeline: vi.fn(),
  mockPush: vi.fn(),
  mockUsageQueryOptions: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    datasets: {
      byDatasetId: {
        delete: {
          mutationOptions: () => ({
            mutationKey: ['dataset-card', 'delete'],
            mutationFn: (input: { params: { dataset_id: string } }) => mockDeleteDataset(input),
          }),
        },
        useCheck: {
          get: {
            queryOptions: (options: UsageQueryOptions) => {
              mockUsageQueryOptions(options)
              return {
                queryKey: ['dataset-card', 'usage', options.input.params.dataset_id],
                queryFn: () => mockCheckUsage(options.input),
                staleTime: options.staleTime,
                retry: options.retry,
              }
            },
          },
        },
      },
    },
  },
}))

vi.mock('@/service/use-pipeline', () => ({
  useExportPipelineDSL: () => ({ mutateAsync: mockExportPipeline }),
}))

function createMockDataset(overrides: Partial<DataSet> = {}): DataSet {
  return {
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    provider: 'vendor',
    permission: DatasetPermission.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    embedding_available: true,
    app_count: 5,
    document_count: 10,
    word_count: 1000,
    created_at: 1609459200,
    updated_at: 1609545600,
    tags: [{ id: 'tag-1', name: 'Tag 1', type: 'knowledge', binding_count: '' }],
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    created_by: 'user-1',
    doc_form: ChunkingMode.text,
    pipeline_id: 'pipeline-1',
    ...overrides,
  } as DataSet
}

function renderDatasetCardState(options: Parameters<typeof useDatasetCardState>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: 2,
        retryDelay: 0,
        staleTime: 5 * 60 * 1000,
      },
      mutations: {
        retry: false,
      },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)

  // oxlint-disable-next-line eslint-react/use-state
  return renderHook(() => useDatasetCardState(options), { wrapper })
}

describe('useDatasetCardState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckUsage.mockResolvedValue({ is_using: false })
    mockDeleteDataset.mockResolvedValue(undefined)
    mockExportPipeline.mockResolvedValue({ data: 'yaml content' })
  })

  describe('delete flow', () => {
    it('shows the current usage state every time delete confirmation is opened', async () => {
      mockCheckUsage
        .mockResolvedValueOnce({ is_using: false })
        .mockResolvedValueOnce({ is_using: true })
      const { result } = renderDatasetCardState({
        dataset: createMockDataset(),
        onSuccess: vi.fn(),
      })

      await act(async () => {
        await result.current.detectIsUsedByApp()
      })

      expect(result.current.modalState.showConfirmDelete).toBe(true)
      expect(result.current.modalState.confirmMessage).toContain('deleteDatasetConfirmContent')

      act(() => {
        result.current.closeConfirmDelete()
      })

      await act(async () => {
        await result.current.detectIsUsedByApp()
      })

      expect(result.current.modalState.showConfirmDelete).toBe(true)
      expect(result.current.modalState.confirmMessage).toContain('datasetUsedByApp')
      expect(mockCheckUsage).toHaveBeenCalledTimes(2)
      expect(mockCheckUsage).toHaveBeenNthCalledWith(1, {
        params: { dataset_id: 'dataset-1' },
      })
      expect(mockCheckUsage).toHaveBeenNthCalledWith(2, {
        params: { dataset_id: 'dataset-1' },
      })
      expect(mockUsageQueryOptions).toHaveBeenLastCalledWith({
        input: {
          params: { dataset_id: 'dataset-1' },
        },
        staleTime: 0,
        retry: false,
        context: { silent: true },
      })
    })

    it('reports a usage check error once without opening confirmation', async () => {
      mockCheckUsage.mockRejectedValue(
        new Response(JSON.stringify({ message: 'API Error' }), { status: 400 }),
      )
      const { result } = renderDatasetCardState({
        dataset: createMockDataset(),
        onSuccess: vi.fn(),
      })

      await act(async () => {
        await result.current.detectIsUsedByApp()
      })

      expect(mockCheckUsage).toHaveBeenCalledTimes(1)
      expect(mockToastError).toHaveBeenCalledWith('API Error')
      expect(result.current.modalState.showConfirmDelete).toBe(false)
    })

    it('reports the request error message', async () => {
      mockCheckUsage.mockRejectedValue(new Error('Network error'))
      const { result } = renderDatasetCardState({
        dataset: createMockDataset(),
        onSuccess: vi.fn(),
      })

      await act(async () => {
        await result.current.detectIsUsedByApp()
      })

      expect(mockToastError).toHaveBeenCalledWith('Network error')
    })

    it('reports the translated fallback for an error without a message', async () => {
      mockCheckUsage.mockRejectedValue({})
      const { result } = renderDatasetCardState({
        dataset: createMockDataset(),
        onSuccess: vi.fn(),
      })

      await act(async () => {
        await result.current.detectIsUsedByApp()
      })

      expect(mockToastError).toHaveBeenCalledWith('dataset.unknownError')
    })

    it('deletes the dataset, reports success, refreshes the list, and closes confirmation', async () => {
      const onSuccess = vi.fn()
      const { result } = renderDatasetCardState({ dataset: createMockDataset(), onSuccess })

      await act(async () => {
        await result.current.detectIsUsedByApp()
      })
      await act(async () => {
        await result.current.onConfirmDelete()
      })

      expect(mockDeleteDataset).toHaveBeenCalledWith({
        params: { dataset_id: 'dataset-1' },
      })
      expect(mockToastSuccess).toHaveBeenCalledWith('dataset.datasetDeleted')
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(result.current.modalState.showConfirmDelete).toBe(false)
    })
  })

  describe('pipeline export', () => {
    it('does not export a dataset without a pipeline', async () => {
      const { result } = renderDatasetCardState({
        dataset: createMockDataset({ pipeline_id: undefined }),
        onSuccess: vi.fn(),
      })

      await act(async () => {
        await result.current.handleExportPipeline()
      })

      expect(mockExportPipeline).not.toHaveBeenCalled()
    })

    it('exports the requested pipeline configuration', async () => {
      const { result } = renderDatasetCardState({
        dataset: createMockDataset({ pipeline_id: 'pipeline-1', name: 'Test Pipeline' }),
        onSuccess: vi.fn(),
      })

      await act(async () => {
        await result.current.handleExportPipeline(true)
      })

      expect(mockExportPipeline).toHaveBeenCalledWith({
        pipelineId: 'pipeline-1',
        include: true,
      })
    })

    it('reports a pipeline export error', async () => {
      mockExportPipeline.mockRejectedValue(new Error('Export failed'))
      const { result } = renderDatasetCardState({
        dataset: createMockDataset({ pipeline_id: 'pipeline-1' }),
        onSuccess: vi.fn(),
      })

      await act(async () => {
        await result.current.handleExportPipeline()
      })

      expect(mockToastError).toHaveBeenCalledWith('app.exportFailed')
    })
  })
})
