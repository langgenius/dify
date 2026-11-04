import type { DocumentStatusResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useIndexingStatusPolling } from '../use-indexing-status-polling'

const mockFetchIndexingStatusBatch = vi.fn()

vi.mock('@/service/datasets', () => ({
  fetchIndexingStatusBatch: (...args: unknown[]) => mockFetchIndexingStatusBatch(...args),
}))

const status = (
  indexing_status: DocumentStatusResponse['indexing_status'],
  overrides: Partial<DocumentStatusResponse> = {},
): DocumentStatusResponse => ({
  id: 'doc-1',
  indexing_status,
  processing_started_at: null,
  parsing_completed_at: null,
  cleaning_completed_at: null,
  splitting_completed_at: null,
  completed_at: null,
  paused_at: null,
  error: null,
  stopped_at: null,
  completed_segments: 0,
  total_segments: 0,
  ...overrides,
})

describe('useIndexingStatusPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const defaultParams = { datasetId: 'ds-1', batchId: 'batch-1' }

  it('should fetch status on mount and update state', async () => {
    mockFetchIndexingStatusBatch.mockResolvedValue({
      data: [status('indexing', { completed_segments: 5, total_segments: 10 })],
    })

    const { result } = renderHook(() => useIndexingStatusPolling(defaultParams))
    // Flush the resolved promise
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledWith({
      datasetId: 'ds-1',
      batchId: 'batch-1',
    })
    expect(result.current.statusList).toHaveLength(1)
    expect(result.current.isEmbedding).toBe(true)
    expect(result.current.isEmbeddingCompleted).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2499)
    })
    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledTimes(2)
  })

  it('should stop polling when all completed', async () => {
    mockFetchIndexingStatusBatch.mockResolvedValue({
      data: [status('completed')],
    })

    const { result } = renderHook(() => useIndexingStatusPolling(defaultParams))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isEmbeddingCompleted).toBe(true)
    expect(result.current.isEmbedding).toBe(false)

    // Should not schedule another poll
    const callCount = mockFetchIndexingStatusBatch.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledTimes(callCount)
  })

  it('should continue polling on fetch error', async () => {
    mockFetchIndexingStatusBatch.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({
      data: [status('completed')],
    })

    const { result } = renderHook(() => useIndexingStatusPolling(defaultParams))
    // First call: rejects
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // Advance past polling interval for retry
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    expect(result.current.isEmbeddingCompleted).toBe(true)
  })

  it('should detect embedding statuses', async () => {
    mockFetchIndexingStatusBatch.mockResolvedValue({
      data: [status('splitting'), status('parsing')],
    })

    const { result } = renderHook(() => useIndexingStatusPolling(defaultParams))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isEmbedding).toBe(true)
    expect(result.current.isEmbeddingCompleted).toBe(false)
  })

  it('should detect mixed statuses (some completed, some embedding)', async () => {
    mockFetchIndexingStatusBatch.mockResolvedValue({
      data: [status('completed'), status('indexing')],
    })

    const { result } = renderHook(() => useIndexingStatusPolling(defaultParams))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.statusList).toHaveLength(2)
    expect(result.current.isEmbedding).toBe(true)
    expect(result.current.isEmbeddingCompleted).toBe(false)
  })

  it('should cleanup on unmount', async () => {
    mockFetchIndexingStatusBatch.mockResolvedValue({
      data: [status('indexing')],
    })

    const { unmount } = renderHook(() => useIndexingStatusPolling(defaultParams))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const callCount = mockFetchIndexingStatusBatch.mock.calls.length
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(mockFetchIndexingStatusBatch).toHaveBeenCalledTimes(callCount)
  })

  it('should treat error and paused as completed statuses', async () => {
    mockFetchIndexingStatusBatch.mockResolvedValue({
      data: [status('error'), status('paused')],
    })

    const { result } = renderHook(() => useIndexingStatusPolling(defaultParams))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isEmbeddingCompleted).toBe(true)
    expect(result.current.isEmbedding).toBe(false)
  })
})
