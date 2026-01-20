import type { ErrorDocsResponse } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { retryErrorDocs } from '@/service/datasets'
import { useDatasetErrorDocs } from '@/service/knowledge/use-dataset'
import RetryButton from './index-failed'

// Mock service hooks
const mockRefetch = vi.fn()

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetErrorDocs: vi.fn(),
}))

vi.mock('@/service/datasets', () => ({
  retryErrorDocs: vi.fn(),
}))

const mockUseDatasetErrorDocs = vi.mocked(useDatasetErrorDocs)
const mockRetryErrorDocs = vi.mocked(retryErrorDocs)

// Helper to create mock query result
const createMockQueryResult = (
  data: ErrorDocsResponse | undefined,
  isLoading: boolean,
) => ({
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
}) as unknown as ReturnType<typeof useDatasetErrorDocs>

describe('RetryButton (IndexFailed)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefetch.mockResolvedValue({})
  })

  describe('Rendering', () => {
    it('should render nothing when loading', () => {
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult(undefined, true),
      )

      const { container } = render(<RetryButton datasetId="test-dataset" />)
      expect(container.firstChild).toBeNull()
    })

    it('should render nothing when no error documents', () => {
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({ total: 0, data: [] }, false),
      )

      const { container } = render(<RetryButton datasetId="test-dataset" />)
      expect(container.firstChild).toBeNull()
    })

    it('should render StatusWithAction when error documents exist', () => {
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({
          total: 3,
          data: [
            { id: 'doc1' },
            { id: 'doc2' },
            { id: 'doc3' },
          ] as ErrorDocsResponse['data'],
        }, false),
      )

      render(<RetryButton datasetId="test-dataset" />)
      expect(screen.getByText(/retry/i)).toBeInTheDocument()
    })

    it('should display error count in description', () => {
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({
          total: 5,
          data: [{ id: 'doc1' }] as ErrorDocsResponse['data'],
        }, false),
      )

      render(<RetryButton datasetId="test-dataset" />)
      expect(screen.getByText(/5/)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass datasetId to useDatasetErrorDocs', () => {
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({ total: 0, data: [] }, false),
      )

      render(<RetryButton datasetId="my-dataset-id" />)
      expect(mockUseDatasetErrorDocs).toHaveBeenCalledWith('my-dataset-id')
    })
  })

  describe('User Interactions', () => {
    it('should call retryErrorDocs when retry button is clicked', async () => {
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({
          total: 2,
          data: [{ id: 'doc1' }, { id: 'doc2' }] as ErrorDocsResponse['data'],
        }, false),
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
    })

    it('should refetch error docs after successful retry', async () => {
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({
          total: 1,
          data: [{ id: 'doc1' }] as ErrorDocsResponse['data'],
        }, false),
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
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({
          total: 1,
          data: [{ id: 'doc1' }] as ErrorDocsResponse['data'],
        }, false),
      )

      // Delay the response to test loading state
      mockRetryErrorDocs.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ result: 'success' }), 100)))

      render(<RetryButton datasetId="test-dataset" />)

      const retryButton = screen.getByText(/retry/i)
      fireEvent.click(retryButton)

      // Button should show disabled styling during retry
      await waitFor(() => {
        const button = screen.getByText(/retry/i)
        expect(button).toHaveClass('cursor-not-allowed')
        expect(button).toHaveClass('text-text-disabled')
      })
    })
  })

  describe('State Management', () => {
    it('should transition to error state when retry fails', async () => {
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({
          total: 1,
          data: [{ id: 'doc1' }] as ErrorDocsResponse['data'],
        }, false),
      )

      mockRetryErrorDocs.mockResolvedValue({ result: 'fail' })

      render(<RetryButton datasetId="test-dataset" />)

      const retryButton = screen.getByText(/retry/i)
      fireEvent.click(retryButton)

      await waitFor(() => {
        // Button should still be visible after failed retry
        expect(screen.getByText(/retry/i)).toBeInTheDocument()
      })
    })

    it('should transition to success state when total becomes 0', async () => {
      const { rerender } = render(<RetryButton datasetId="test-dataset" />)

      // Initially has errors
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({
          total: 1,
          data: [{ id: 'doc1' }] as ErrorDocsResponse['data'],
        }, false),
      )

      rerender(<RetryButton datasetId="test-dataset" />)
      expect(screen.getByText(/retry/i)).toBeInTheDocument()

      // Now no errors
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({ total: 0, data: [] }, false),
      )

      rerender(<RetryButton datasetId="test-dataset" />)

      await waitFor(() => {
        expect(screen.queryByText(/retry/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty data array', () => {
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({ total: 0, data: [] }, false),
      )

      const { container } = render(<RetryButton datasetId="test-dataset" />)
      expect(container.firstChild).toBeNull()
    })

    it('should handle undefined data by showing error state', () => {
      // When data is undefined but not loading, the component shows error state
      // because errorDocs?.total is not strictly equal to 0
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult(undefined, false),
      )

      render(<RetryButton datasetId="test-dataset" />)
      // Component renders with undefined count
      expect(screen.getByText(/retry/i)).toBeInTheDocument()
    })

    it('should handle retry with empty document list', async () => {
      mockUseDatasetErrorDocs.mockReturnValue(
        createMockQueryResult({ total: 1, data: [] }, false),
      )

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
    })
  })
})
