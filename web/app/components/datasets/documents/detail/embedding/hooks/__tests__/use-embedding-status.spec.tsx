import type { ReactNode } from 'react'
import type { IndexingStatusResponse } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as datasetsService from '@/service/datasets'
import {
  calculatePercent,
  isEmbeddingStatus,
  isTerminalStatus,
  useEmbeddingStatus,
  useInvalidateEmbeddingStatus,
  usePauseIndexing,
  useResumeIndexing,
} from '../use-embedding-status'

vi.mock('@/service/datasets')

const mockFetchIndexingStatus = vi.mocked(datasetsService.fetchIndexingStatus)
const mockPauseDocIndexing = vi.mocked(datasetsService.pauseDocIndexing)
const mockResumeDocIndexing = vi.mocked(datasetsService.resumeDocIndexing)

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const createWrapper = () => {
  const queryClient = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

const mockIndexingStatus = (overrides: Partial<IndexingStatusResponse> = {}): IndexingStatusResponse => ({
  id: 'doc1',
  indexing_status: 'indexing',
  completed_segments: 50,
  total_segments: 100,
  processing_started_at: 0,
  parsing_completed_at: 0,
  cleaning_completed_at: 0,
  splitting_completed_at: 0,
  completed_at: null,
  paused_at: null,
  error: null,
  stopped_at: null,
  ...overrides,
})

describe('use-embedding-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isEmbeddingStatus', () => {
    it('should return true for indexing status', () => {
      expect(isEmbeddingStatus('indexing')).toBe(true)
    })

    it('should return true for splitting status', () => {
      expect(isEmbeddingStatus('splitting')).toBe(true)
    })

    it('should return true for parsing status', () => {
      expect(isEmbeddingStatus('parsing')).toBe(true)
    })

    it('should return true for cleaning status', () => {
      expect(isEmbeddingStatus('cleaning')).toBe(true)
    })

    it('should return false for completed status', () => {
      expect(isEmbeddingStatus('completed')).toBe(false)
    })

    it('should return false for paused status', () => {
      expect(isEmbeddingStatus('paused')).toBe(false)
    })

    it('should return false for error status', () => {
      expect(isEmbeddingStatus('error')).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isEmbeddingStatus(undefined)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isEmbeddingStatus('')).toBe(false)
    })
  })

  describe('isTerminalStatus', () => {
    it('should return true for completed status', () => {
      expect(isTerminalStatus('completed')).toBe(true)
    })

    it('should return true for error status', () => {
      expect(isTerminalStatus('error')).toBe(true)
    })

    it('should return true for paused status', () => {
      expect(isTerminalStatus('paused')).toBe(true)
    })

    it('should return false for indexing status', () => {
      expect(isTerminalStatus('indexing')).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isTerminalStatus(undefined)).toBe(false)
    })
  })

  describe('calculatePercent', () => {
    it('should calculate percent correctly', () => {
      expect(calculatePercent(50, 100)).toBe(50)
    })

    it('should return 0 when total is 0', () => {
      expect(calculatePercent(50, 0)).toBe(0)
    })

    it('should return 0 when total is undefined', () => {
      expect(calculatePercent(50, undefined)).toBe(0)
    })

    it('should return 0 when completed is undefined', () => {
      expect(calculatePercent(undefined, 100)).toBe(0)
    })

    it('should cap at 100 when percent exceeds 100', () => {
      expect(calculatePercent(150, 100)).toBe(100)
    })

    it('should round to nearest integer', () => {
      expect(calculatePercent(33, 100)).toBe(33)
      expect(calculatePercent(1, 3)).toBe(33)
    })
  })

  describe('useEmbeddingStatus', () => {
    it('should return initial state when disabled', () => {
      const { result } = renderHook(
        () => useEmbeddingStatus({ datasetId: 'ds1', documentId: 'doc1', enabled: false }),
        { wrapper: createWrapper() },
      )

      expect(result.current.isEmbedding).toBe(false)
      expect(result.current.isCompleted).toBe(false)
      expect(result.current.isPaused).toBe(false)
      expect(result.current.isError).toBe(false)
      expect(result.current.percent).toBe(0)
    })

    it('should not fetch when datasetId is missing', () => {
      renderHook(
        () => useEmbeddingStatus({ documentId: 'doc1' }),
        { wrapper: createWrapper() },
      )

      expect(mockFetchIndexingStatus).not.toHaveBeenCalled()
    })

    it('should not fetch when documentId is missing', () => {
      renderHook(
        () => useEmbeddingStatus({ datasetId: 'ds1' }),
        { wrapper: createWrapper() },
      )

      expect(mockFetchIndexingStatus).not.toHaveBeenCalled()
    })

    it('should fetch indexing status when enabled with valid ids', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      const { result } = renderHook(
        () => useEmbeddingStatus({ datasetId: 'ds1', documentId: 'doc1' }),
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(result.current.isEmbedding).toBe(true)
      })

      expect(mockFetchIndexingStatus).toHaveBeenCalledWith({
        datasetId: 'ds1',
        documentId: 'doc1',
      })
      expect(result.current.percent).toBe(50)
    })

    it('should set isCompleted when status is completed', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({
        indexing_status: 'completed',
        completed_segments: 100,
      }))

      const { result } = renderHook(
        () => useEmbeddingStatus({ datasetId: 'ds1', documentId: 'doc1' }),
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(result.current.isCompleted).toBe(true)
      })

      expect(result.current.percent).toBe(100)
    })

    it('should set isPaused when status is paused', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({
        indexing_status: 'paused',
      }))

      const { result } = renderHook(
        () => useEmbeddingStatus({ datasetId: 'ds1', documentId: 'doc1' }),
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(result.current.isPaused).toBe(true)
      })
    })

    it('should set isError when status is error', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus({
        indexing_status: 'error',
        completed_segments: 25,
      }))

      const { result } = renderHook(
        () => useEmbeddingStatus({ datasetId: 'ds1', documentId: 'doc1' }),
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
    })

    it('should provide invalidate function', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      const { result } = renderHook(
        () => useEmbeddingStatus({ datasetId: 'ds1', documentId: 'doc1' }),
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(result.current.isEmbedding).toBe(true)
      })

      expect(typeof result.current.invalidate).toBe('function')

      // Call invalidate should not throw
      await act(async () => {
        result.current.invalidate()
      })
    })

    it('should provide resetStatus function that clears data', async () => {
      mockFetchIndexingStatus.mockResolvedValue(mockIndexingStatus())

      const { result } = renderHook(
        () => useEmbeddingStatus({ datasetId: 'ds1', documentId: 'doc1' }),
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(result.current.data).toBeDefined()
      })

      // Reset status should clear the data
      await act(async () => {
        result.current.resetStatus()
      })

      await waitFor(() => {
        expect(result.current.data).toBeNull()
      })
    })
  })

  describe('usePauseIndexing', () => {
    it('should call pauseDocIndexing when mutate is called', async () => {
      mockPauseDocIndexing.mockResolvedValue({ result: 'success' })

      const { result } = renderHook(
        () => usePauseIndexing({ datasetId: 'ds1', documentId: 'doc1' }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.mutate()
      })

      await waitFor(() => {
        expect(mockPauseDocIndexing).toHaveBeenCalledWith({
          datasetId: 'ds1',
          documentId: 'doc1',
        })
      })
    })

    it('should call onSuccess callback on successful pause', async () => {
      mockPauseDocIndexing.mockResolvedValue({ result: 'success' })
      const onSuccess = vi.fn()

      const { result } = renderHook(
        () => usePauseIndexing({ datasetId: 'ds1', documentId: 'doc1', onSuccess }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.mutate()
      })

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
      })
    })

    it('should call onError callback on failed pause', async () => {
      const error = new Error('Network error')
      mockPauseDocIndexing.mockRejectedValue(error)
      const onError = vi.fn()

      const { result } = renderHook(
        () => usePauseIndexing({ datasetId: 'ds1', documentId: 'doc1', onError }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.mutate()
      })

      await waitFor(() => {
        expect(onError).toHaveBeenCalled()
        expect(onError.mock.calls[0][0]).toEqual(error)
      })
    })
  })

  describe('useResumeIndexing', () => {
    it('should call resumeDocIndexing when mutate is called', async () => {
      mockResumeDocIndexing.mockResolvedValue({ result: 'success' })

      const { result } = renderHook(
        () => useResumeIndexing({ datasetId: 'ds1', documentId: 'doc1' }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.mutate()
      })

      await waitFor(() => {
        expect(mockResumeDocIndexing).toHaveBeenCalledWith({
          datasetId: 'ds1',
          documentId: 'doc1',
        })
      })
    })

    it('should call onSuccess callback on successful resume', async () => {
      mockResumeDocIndexing.mockResolvedValue({ result: 'success' })
      const onSuccess = vi.fn()

      const { result } = renderHook(
        () => useResumeIndexing({ datasetId: 'ds1', documentId: 'doc1', onSuccess }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        result.current.mutate()
      })

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
      })
    })
  })

  describe('useInvalidateEmbeddingStatus', () => {
    it('should return a function', () => {
      const { result } = renderHook(
        () => useInvalidateEmbeddingStatus(),
        { wrapper: createWrapper() },
      )

      expect(typeof result.current).toBe('function')
    })

    it('should invalidate specific query when datasetId and documentId are provided', async () => {
      const queryClient = createTestQueryClient()
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )

      // Set some initial data in the cache
      queryClient.setQueryData(['embedding', 'indexing-status', 'ds1', 'doc1'], {
        id: 'doc1',
        indexing_status: 'indexing',
      })

      const { result } = renderHook(
        () => useInvalidateEmbeddingStatus(),
        { wrapper },
      )

      await act(async () => {
        result.current('ds1', 'doc1')
      })

      // The query should be invalidated (marked as stale)
      const queryState = queryClient.getQueryState(['embedding', 'indexing-status', 'ds1', 'doc1'])
      expect(queryState?.isInvalidated).toBe(true)
    })

    it('should invalidate all embedding status queries when ids are not provided', async () => {
      const queryClient = createTestQueryClient()
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )

      // Set some initial data in the cache for multiple documents
      queryClient.setQueryData(['embedding', 'indexing-status', 'ds1', 'doc1'], {
        id: 'doc1',
        indexing_status: 'indexing',
      })
      queryClient.setQueryData(['embedding', 'indexing-status', 'ds2', 'doc2'], {
        id: 'doc2',
        indexing_status: 'completed',
      })

      const { result } = renderHook(
        () => useInvalidateEmbeddingStatus(),
        { wrapper },
      )

      await act(async () => {
        result.current()
      })

      // Both queries should be invalidated
      const queryState1 = queryClient.getQueryState(['embedding', 'indexing-status', 'ds1', 'doc1'])
      const queryState2 = queryClient.getQueryState(['embedding', 'indexing-status', 'ds2', 'doc2'])
      expect(queryState1?.isInvalidated).toBe(true)
      expect(queryState2?.isInvalidated).toBe(true)
    })
  })
})
