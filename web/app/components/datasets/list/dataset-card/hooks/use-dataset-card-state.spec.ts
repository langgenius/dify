import type { DataSet } from '@/models/datasets'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { useDatasetCardState } from './use-dataset-card-state'

// Mock Toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

// Mock service hooks
const mockCheckUsage = vi.fn()
const mockDeleteDataset = vi.fn()
const mockExportPipeline = vi.fn()

vi.mock('@/service/use-dataset-card', () => ({
  useCheckDatasetUsage: () => ({ mutateAsync: mockCheckUsage }),
  useDeleteDataset: () => ({ mutateAsync: mockDeleteDataset }),
}))

vi.mock('@/service/use-pipeline', () => ({
  useExportPipelineDSL: () => ({ mutateAsync: mockExportPipeline }),
}))

describe('useDatasetCardState', () => {
  const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
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
    tags: [{ id: 'tag-1', name: 'Tag 1', type: 'knowledge', binding_count: 0 }],
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    created_by: 'user-1',
    doc_form: ChunkingMode.text,
    pipeline_id: 'pipeline-1',
    ...overrides,
  } as DataSet)

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckUsage.mockResolvedValue({ is_using: false })
    mockDeleteDataset.mockResolvedValue({})
    mockExportPipeline.mockResolvedValue({ data: 'yaml content' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Initial State', () => {
    it('should return tags from dataset', () => {
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      expect(result.current.tags).toEqual(dataset.tags)
    })

    it('should have initial modal state closed', () => {
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      expect(result.current.modalState.showRenameModal).toBe(false)
      expect(result.current.modalState.showConfirmDelete).toBe(false)
      expect(result.current.modalState.confirmMessage).toBe('')
    })

    it('should not be exporting initially', () => {
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      expect(result.current.exporting).toBe(false)
    })
  })

  describe('Tags State', () => {
    it('should update tags when setTags is called', () => {
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      act(() => {
        result.current.setTags([{ id: 'tag-2', name: 'Tag 2', type: 'knowledge', binding_count: 0 }])
      })

      expect(result.current.tags).toEqual([{ id: 'tag-2', name: 'Tag 2', type: 'knowledge', binding_count: 0 }])
    })

    it('should sync tags when dataset tags change', () => {
      const dataset = createMockDataset()
      const { result, rerender } = renderHook(
        ({ dataset }) => useDatasetCardState({ dataset, onSuccess: vi.fn() }),
        { initialProps: { dataset } },
      )

      const newTags = [{ id: 'tag-3', name: 'Tag 3', type: 'knowledge', binding_count: 0 }]
      const updatedDataset = createMockDataset({ tags: newTags })

      rerender({ dataset: updatedDataset })

      expect(result.current.tags).toEqual(newTags)
    })
  })

  describe('Modal Handlers', () => {
    it('should open rename modal when openRenameModal is called', () => {
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      act(() => {
        result.current.openRenameModal()
      })

      expect(result.current.modalState.showRenameModal).toBe(true)
    })

    it('should close rename modal when closeRenameModal is called', () => {
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      act(() => {
        result.current.openRenameModal()
      })

      act(() => {
        result.current.closeRenameModal()
      })

      expect(result.current.modalState.showRenameModal).toBe(false)
    })

    it('should close confirm delete modal when closeConfirmDelete is called', () => {
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      // First trigger show confirm delete
      act(() => {
        result.current.detectIsUsedByApp()
      })

      waitFor(() => {
        expect(result.current.modalState.showConfirmDelete).toBe(true)
      })

      act(() => {
        result.current.closeConfirmDelete()
      })

      expect(result.current.modalState.showConfirmDelete).toBe(false)
    })
  })

  describe('detectIsUsedByApp', () => {
    it('should check usage and show confirm modal with not-in-use message', async () => {
      mockCheckUsage.mockResolvedValue({ is_using: false })
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      await act(async () => {
        await result.current.detectIsUsedByApp()
      })

      expect(mockCheckUsage).toHaveBeenCalledWith('dataset-1')
      expect(result.current.modalState.showConfirmDelete).toBe(true)
      expect(result.current.modalState.confirmMessage).toContain('deleteDatasetConfirmContent')
    })

    it('should show in-use message when dataset is used by app', async () => {
      mockCheckUsage.mockResolvedValue({ is_using: true })
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      await act(async () => {
        await result.current.detectIsUsedByApp()
      })

      expect(result.current.modalState.confirmMessage).toContain('datasetUsedByApp')
    })
  })

  describe('onConfirmDelete', () => {
    it('should delete dataset and call onSuccess', async () => {
      const onSuccess = vi.fn()
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess }),
      )

      await act(async () => {
        await result.current.onConfirmDelete()
      })

      expect(mockDeleteDataset).toHaveBeenCalledWith('dataset-1')
      expect(onSuccess).toHaveBeenCalled()
    })

    it('should close confirm modal after delete', async () => {
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      // First open confirm modal
      await act(async () => {
        await result.current.detectIsUsedByApp()
      })

      await act(async () => {
        await result.current.onConfirmDelete()
      })

      expect(result.current.modalState.showConfirmDelete).toBe(false)
    })
  })

  describe('handleExportPipeline', () => {
    it('should not export if pipeline_id is missing', async () => {
      const dataset = createMockDataset({ pipeline_id: undefined })
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      await act(async () => {
        await result.current.handleExportPipeline()
      })

      expect(mockExportPipeline).not.toHaveBeenCalled()
    })

    it('should export pipeline with correct parameters', async () => {
      const dataset = createMockDataset({ pipeline_id: 'pipeline-1', name: 'Test Pipeline' })
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      await act(async () => {
        await result.current.handleExportPipeline(true)
      })

      expect(mockExportPipeline).toHaveBeenCalledWith({
        pipelineId: 'pipeline-1',
        include: true,
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty tags array', () => {
      const dataset = createMockDataset({ tags: [] })
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      expect(result.current.tags).toEqual([])
    })

    it('should handle undefined onSuccess', async () => {
      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset }),
      )

      // Should not throw when onSuccess is undefined
      await act(async () => {
        await result.current.onConfirmDelete()
      })

      expect(mockDeleteDataset).toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should show error toast when export pipeline fails', async () => {
      const Toast = await import('@/app/components/base/toast')
      mockExportPipeline.mockRejectedValue(new Error('Export failed'))

      const dataset = createMockDataset({ pipeline_id: 'pipeline-1' })
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      await act(async () => {
        await result.current.handleExportPipeline()
      })

      expect(Toast.default.notify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String),
      })
    })

    it('should handle Response error in detectIsUsedByApp', async () => {
      const Toast = await import('@/app/components/base/toast')
      const mockResponse = new Response(JSON.stringify({ message: 'API Error' }), {
        status: 400,
      })
      mockCheckUsage.mockRejectedValue(mockResponse)

      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      await act(async () => {
        await result.current.detectIsUsedByApp()
      })

      expect(Toast.default.notify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.stringContaining('API Error'),
      })
    })

    it('should handle generic Error in detectIsUsedByApp', async () => {
      const Toast = await import('@/app/components/base/toast')
      mockCheckUsage.mockRejectedValue(new Error('Network error'))

      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      await act(async () => {
        await result.current.detectIsUsedByApp()
      })

      expect(Toast.default.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Network error',
      })
    })

    it('should handle error without message in detectIsUsedByApp', async () => {
      const Toast = await import('@/app/components/base/toast')
      mockCheckUsage.mockRejectedValue({})

      const dataset = createMockDataset()
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      await act(async () => {
        await result.current.detectIsUsedByApp()
      })

      expect(Toast.default.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Unknown error',
      })
    })

    it('should handle exporting state correctly', async () => {
      const dataset = createMockDataset({ pipeline_id: 'pipeline-1' })
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      // Exporting should initially be false
      expect(result.current.exporting).toBe(false)

      // Export should work when not exporting
      await act(async () => {
        await result.current.handleExportPipeline()
      })

      expect(mockExportPipeline).toHaveBeenCalled()
    })

    it('should reset exporting state after export completes', async () => {
      const dataset = createMockDataset({ pipeline_id: 'pipeline-1' })
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      await act(async () => {
        await result.current.handleExportPipeline()
      })

      expect(result.current.exporting).toBe(false)
    })

    it('should reset exporting state even when export fails', async () => {
      mockExportPipeline.mockRejectedValue(new Error('Export failed'))

      const dataset = createMockDataset({ pipeline_id: 'pipeline-1' })
      const { result } = renderHook(() =>
        useDatasetCardState({ dataset, onSuccess: vi.fn() }),
      )

      await act(async () => {
        await result.current.handleExportPipeline()
      })

      expect(result.current.exporting).toBe(false)
    })
  })
})
