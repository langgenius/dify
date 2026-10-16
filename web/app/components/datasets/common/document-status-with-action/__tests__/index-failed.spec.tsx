import type { ErrorDocsResponse } from '@/models/datasets'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { retryErrorDocs } from '@/service/datasets'
import RetryButton from '../index-failed'

const mockRefetch = vi.fn()

const { mockErrorDocsQuery } = vi.hoisted(() => ({ mockErrorDocsQuery: vi.fn() }))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'datasets.byDatasetId.errorDocs.get': mockErrorDocsQuery,
  })
})

vi.mock('@/service/datasets', () => ({
  retryErrorDocs: vi.fn(),
}))

const mockRetryErrorDocs = vi.mocked(retryErrorDocs)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Helper to create mock query result
const createMockQueryResult = (data: ErrorDocsResponse | undefined, isLoading: boolean) => ({
  data,
  isLoading,
  refetch: mockRefetch,
  // Required query result properties
  error: null,
  isError: false,
  isFetched: true,
  isFetching: false,
  isSuccess: !isLoading && !!data,
  status: isLoading ? 'pending' : 'success',
  dataUpdatedAt: Date.now(),
  errorUpdatedAt: 0,
  failureCount: 0,
  failureReason: null,
  errorUpdateCount: 0,
  isLoadingError: false,
  isPaused: false,
  isPlaceholderData: false,
  isPending: isLoading,
  isRefetchError: false,
  isRefetching: false,
  isStale: false,
  fetchStatus: 'idle',
  promise: Promise.resolve(data as ErrorDocsResponse),
  isFetchedAfterMount: true,
  isInitialLoading: false,
})

describe('RetryButton (IndexFailed)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefetch.mockResolvedValue({})
  })

  describe('Rendering', () => {
    it('should render nothing when loading', () => {
      mockErrorDocsQuery.mockReturnValue(createMockQueryResult(undefined, true))

      const { container } = render(<RetryButton datasetId="test-dataset" />)
      expect(container.firstChild).toBeNull()
    })

    it('should render nothing when no error documents', () => {
      mockErrorDocsQuery.mockReturnValue(createMockQueryResult({ total: 0, data: [] }, false))

      const { container } = render(<RetryButton datasetId="test-dataset" />)
      expect(container.firstChild).toBeNull()
    })

    it('should render StatusWithAction when error documents exist', () => {
      mockErrorDocsQuery.mockReturnValue(
        createMockQueryResult(
          {
            total: 3,
            data: [{ id: 'doc1' }, { id: 'doc2' }, { id: 'doc3' }] as ErrorDocsResponse['data'],
          },
          false,
        ),
      )

      render(<RetryButton datasetId="test-dataset" />)
      expect(screen.getByText(/retry/i)).toBeInTheDocument()
    })

    it('should display error count in description', () => {
      mockErrorDocsQuery.mockReturnValue(
        createMockQueryResult(
          {
            total: 5,
            data: [{ id: 'doc1' }] as ErrorDocsResponse['data'],
          },
          false,
        ),
      )

      render(<RetryButton datasetId="test-dataset" />)
      expect(screen.getByText(/5/)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should load the error documents of the given dataset', () => {
      mockErrorDocsQuery.mockReturnValue(createMockQueryResult({ total: 0, data: [] }, false))

      render(<RetryButton datasetId="my-dataset-id" />)
      expect(mockErrorDocsQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { params: { dataset_id: 'my-dataset-id' } },
          enabled: true,
        }),
      )
    })
  })

  describe('User Interactions', () => {
    it('should call retryErrorDocs when retry button is clicked', async () => {
      mockErrorDocsQuery.mockReturnValue(
        createMockQueryResult(
          {
            total: 2,
            data: [{ id: 'doc1' }, { id: 'doc2' }] as ErrorDocsResponse['data'],
          },
          false,
        ),
      )

      mockRetryErrorDocs.mockResolvedValue({ result: 'success' })

      render(<RetryButton datasetId="test-dataset" />)

      const retryButton = screen.getByText(/retry/i)
      fireEvent.click(retryButton)

      await waitFor(() => {
        expect(mockRetryErrorDocs).toHaveBeenCalledWith({
          datasetId: 'test-dataset',
          document_ids: ['doc1', 'doc2'],
        })
      })

      // Wait for all state updates to complete
      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })

    it('should refetch error docs after successful retry', async () => {
      mockErrorDocsQuery.mockReturnValue(
        createMockQueryResult(
          {
            total: 1,
            data: [{ id: 'doc1' }] as ErrorDocsResponse['data'],
          },
          false,
        ),
      )

      mockRetryErrorDocs.mockResolvedValue({ result: 'success' })

      render(<RetryButton datasetId="test-dataset" />)

      const retryButton = screen.getByText(/retry/i)
      fireEvent.click(retryButton)

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })

    it('should disable button while retrying', async () => {
      mockErrorDocsQuery.mockReturnValue(
        createMockQueryResult(
          {
            total: 1,
            data: [{ id: 'doc1' }] as ErrorDocsResponse['data'],
          },
          false,
        ),
      )

      let resolveRetry: ((value: { result: 'success' }) => void) | undefined
      mockRetryErrorDocs.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRetry = resolve
          }),
      )

      render(<RetryButton datasetId="test-dataset" />)

      const retryButton = screen.getByText(/retry/i)
      fireEvent.click(retryButton)

      // Button should show disabled styling during retry
      await waitFor(() => {
        const button = screen.getByText(/retry/i)
        expect(button).toHaveClass('cursor-not-allowed')
        expect(button).toHaveClass('text-text-disabled')
      })

      resolveRetry?.({ result: 'success' })
      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })

  describe('State Management', () => {
    it('should transition to error state when retry fails', async () => {
      mockErrorDocsQuery.mockReturnValue(
        createMockQueryResult(
          {
            total: 1,
            data: [{ id: 'doc1' }] as ErrorDocsResponse['data'],
          },
          false,
        ),
      )

      mockRetryErrorDocs.mockRejectedValue(new Error('retry failed'))

      render(<RetryButton datasetId="test-dataset" />)

      const retryButton = screen.getByText(/retry/i)
      fireEvent.click(retryButton)

      // Wait for retry to complete and state to update
      await waitFor(() => {
        expect(mockRetryErrorDocs).toHaveBeenCalled()
      })

      // Button should still be visible after failed retry
      await waitFor(() => {
        expect(screen.getByText(/retry/i)).toBeInTheDocument()
      })
    })

    it('should transition to success state when total becomes 0', async () => {
      const { rerender } = render(<RetryButton datasetId="test-dataset" />)

      // Initially has errors
      mockErrorDocsQuery.mockReturnValue(
        createMockQueryResult(
          {
            total: 1,
            data: [{ id: 'doc1' }] as ErrorDocsResponse['data'],
          },
          false,
        ),
      )

      rerender(<RetryButton datasetId="test-dataset" />)
      expect(screen.getByText(/retry/i)).toBeInTheDocument()

      // Now no errors
      mockErrorDocsQuery.mockReturnValue(createMockQueryResult({ total: 0, data: [] }, false))

      rerender(<RetryButton datasetId="test-dataset" />)

      await waitFor(() => {
        expect(screen.queryByText(/retry/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty data array', () => {
      mockErrorDocsQuery.mockReturnValue(createMockQueryResult({ total: 0, data: [] }, false))

      const { container } = render(<RetryButton datasetId="test-dataset" />)
      expect(container.firstChild).toBeNull()
    })

    it('should handle undefined data by showing error state', () => {
      // When data is undefined but not loading, the component shows error state
      // because errorDocs?.total is not strictly equal to 0
      mockErrorDocsQuery.mockReturnValue(createMockQueryResult(undefined, false))

      render(<RetryButton datasetId="test-dataset" />)
      // Component renders with undefined count
      expect(screen.getByText(/retry/i)).toBeInTheDocument()
    })

    it('should handle retry with empty document list', async () => {
      mockErrorDocsQuery.mockReturnValue(createMockQueryResult({ total: 1, data: [] }, false))

      mockRetryErrorDocs.mockResolvedValue({ result: 'success' })

      render(<RetryButton datasetId="test-dataset" />)

      const retryButton = screen.getByText(/retry/i)
      fireEvent.click(retryButton)

      await waitFor(() => {
        expect(mockRetryErrorDocs).toHaveBeenCalledWith({
          datasetId: 'test-dataset',
          document_ids: [],
        })
      })

      // Wait for all state updates to complete
      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })
})
