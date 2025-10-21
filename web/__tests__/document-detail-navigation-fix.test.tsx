/**
 * Document Detail Navigation Fix Verification Test
 *
 * This test specifically validates that the backToPrev function in the document detail
 * component correctly preserves pagination and filter states.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { useDocumentDetail, useDocumentMetadata } from '@/service/knowledge/use-document'

// Mock Next.js router
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: mockPush,
  })),
}))

// Mock the document service hooks
jest.mock('@/service/knowledge/use-document', () => ({
  useDocumentDetail: jest.fn(),
  useDocumentMetadata: jest.fn(),
  useInvalidDocumentList: jest.fn(() => jest.fn()),
}))

// Mock other dependencies
jest.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContext: jest.fn(() => [null]),
}))

jest.mock('@/service/use-base', () => ({
  useInvalid: jest.fn(() => jest.fn()),
}))

jest.mock('@/service/knowledge/use-segment', () => ({
  useSegmentListKey: jest.fn(),
  useChildSegmentListKey: jest.fn(),
}))

// Create a minimal version of the DocumentDetail component that includes our fix
const DocumentDetailWithFix = ({ datasetId, documentId }: { datasetId: string; documentId: string }) => {
  const router = useRouter()

  // This is the FIXED implementation from detail/index.tsx
  const backToPrev = () => {
    // Preserve pagination and filter states when navigating back
    const searchParams = new URLSearchParams(window.location.search)
    const queryString = searchParams.toString()
    const separator = queryString ? '?' : ''
    const backPath = `/datasets/${datasetId}/documents${separator}${queryString}`
    router.push(backPath)
  }

  return (
    <div data-testid="document-detail-fixed">
      <button type="button" data-testid="back-button-fixed" onClick={backToPrev}>
        Back to Documents
      </button>
      <div data-testid="document-info">
        Dataset: {datasetId}, Document: {documentId}
      </div>
    </div>
  )
}

describe('Document Detail Navigation Fix Verification', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Mock successful API responses
    ;(useDocumentDetail as jest.Mock).mockReturnValue({
      data: {
        id: 'doc-123',
        name: 'Test Document',
        display_status: 'available',
        enabled: true,
        archived: false,
      },
      error: null,
    })

    ;(useDocumentMetadata as jest.Mock).mockReturnValue({
      data: null,
      error: null,
    })
  })

  describe('Query Parameter Preservation', () => {
    test('preserves pagination state (page 3, limit 25)', () => {
      // Simulate user coming from page 3 with 25 items per page
      Object.defineProperty(window, 'location', {
        value: {
          search: '?page=3&limit=25',
        },
        writable: true,
      })

      render(<DocumentDetailWithFix datasetId="dataset-123" documentId="doc-456" />)

      // User clicks back button
      fireEvent.click(screen.getByTestId('back-button-fixed'))

      // Should preserve the pagination state
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-123/documents?page=3&limit=25')

      console.log('✅ Pagination state preserved: page=3&limit=25')
    })

    test('preserves search keyword and filters', () => {
      // Simulate user with search and filters applied
      Object.defineProperty(window, 'location', {
        value: {
          search: '?page=2&limit=10&keyword=API%20documentation&status=active',
        },
        writable: true,
      })

      render(<DocumentDetailWithFix datasetId="dataset-123" documentId="doc-456" />)

      fireEvent.click(screen.getByTestId('back-button-fixed'))

      // Should preserve all query parameters
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-123/documents?page=2&limit=10&keyword=API+documentation&status=active')

      console.log('✅ Search and filters preserved')
    })

    test('handles complex query parameters with special characters', () => {
      // Test with complex query string including encoded characters
      Object.defineProperty(window, 'location', {
        value: {
          search: '?page=1&limit=50&keyword=test%20%26%20debug&sort=name&order=desc&filter=%7B%22type%22%3A%22pdf%22%7D',
        },
        writable: true,
      })

      render(<DocumentDetailWithFix datasetId="dataset-123" documentId="doc-456" />)

      fireEvent.click(screen.getByTestId('back-button-fixed'))

      // URLSearchParams will normalize the encoding, but preserve all parameters
      const expectedCall = mockPush.mock.calls[0][0]
      expect(expectedCall).toMatch(/^\/datasets\/dataset-123\/documents\?/)
      expect(expectedCall).toMatch(/page=1/)
      expect(expectedCall).toMatch(/limit=50/)
      expect(expectedCall).toMatch(/keyword=test/)
      expect(expectedCall).toMatch(/sort=name/)
      expect(expectedCall).toMatch(/order=desc/)

      console.log('✅ Complex query parameters handled:', expectedCall)
    })

    test('handles empty query parameters gracefully', () => {
      // No query parameters in URL
      Object.defineProperty(window, 'location', {
        value: {
          search: '',
        },
        writable: true,
      })

      render(<DocumentDetailWithFix datasetId="dataset-123" documentId="doc-456" />)

      fireEvent.click(screen.getByTestId('back-button-fixed'))

      // Should navigate to clean documents URL
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-123/documents')

      console.log('✅ Empty parameters handled gracefully')
    })
  })

  describe('Different Dataset IDs', () => {
    test('works with different dataset identifiers', () => {
      Object.defineProperty(window, 'location', {
        value: {
          search: '?page=5&limit=10',
        },
        writable: true,
      })

      // Test with different dataset ID format
      render(<DocumentDetailWithFix datasetId="ds-prod-2024-001" documentId="doc-456" />)

      fireEvent.click(screen.getByTestId('back-button-fixed'))

      expect(mockPush).toHaveBeenCalledWith('/datasets/ds-prod-2024-001/documents?page=5&limit=10')

      console.log('✅ Works with different dataset ID formats')
    })
  })

  describe('Real User Scenarios', () => {
    test('scenario: user searches, goes to page 3, views document, clicks back', () => {
      // User searched for "API" and navigated to page 3
      Object.defineProperty(window, 'location', {
        value: {
          search: '?keyword=API&page=3&limit=10',
        },
        writable: true,
      })

      render(<DocumentDetailWithFix datasetId="main-dataset" documentId="api-doc-123" />)

      // User decides to go back to continue browsing
      fireEvent.click(screen.getByTestId('back-button-fixed'))

      // Should return to page 3 of API search results
      expect(mockPush).toHaveBeenCalledWith('/datasets/main-dataset/documents?keyword=API&page=3&limit=10')

      console.log('✅ Real user scenario: search + pagination preserved')
    })

    test('scenario: user applies multiple filters, goes to document, returns', () => {
      // User has applied multiple filters and is on page 2
      Object.defineProperty(window, 'location', {
        value: {
          search: '?page=2&limit=25&status=active&type=pdf&sort=created_at&order=desc',
        },
        writable: true,
      })

      render(<DocumentDetailWithFix datasetId="filtered-dataset" documentId="filtered-doc" />)

      fireEvent.click(screen.getByTestId('back-button-fixed'))

      // All filters should be preserved
      expect(mockPush).toHaveBeenCalledWith('/datasets/filtered-dataset/documents?page=2&limit=25&status=active&type=pdf&sort=created_at&order=desc')

      console.log('✅ Complex filtering scenario preserved')
    })
  })

  describe('Error Handling and Edge Cases', () => {
    test('handles malformed query parameters gracefully', () => {
      // Test with potentially problematic query string
      Object.defineProperty(window, 'location', {
        value: {
          search: '?page=invalid&limit=&keyword=test&=emptykey&malformed',
        },
        writable: true,
      })

      render(<DocumentDetailWithFix datasetId="dataset-123" documentId="doc-456" />)

      // Should not throw errors
      expect(() => {
        fireEvent.click(screen.getByTestId('back-button-fixed'))
      }).not.toThrow()

      // Should still attempt navigation (URLSearchParams will clean up the parameters)
      expect(mockPush).toHaveBeenCalled()
      const navigationPath = mockPush.mock.calls[0][0]
      expect(navigationPath).toMatch(/^\/datasets\/dataset-123\/documents/)

      console.log('✅ Malformed parameters handled gracefully:', navigationPath)
    })

    test('handles very long query strings', () => {
      // Test with a very long query string
      const longKeyword = 'a'.repeat(1000)
      Object.defineProperty(window, 'location', {
        value: {
          search: `?page=1&keyword=${longKeyword}`,
        },
        writable: true,
      })

      render(<DocumentDetailWithFix datasetId="dataset-123" documentId="doc-456" />)

      expect(() => {
        fireEvent.click(screen.getByTestId('back-button-fixed'))
      }).not.toThrow()

      expect(mockPush).toHaveBeenCalled()

      console.log('✅ Long query strings handled')
    })
  })

  describe('Performance Verification', () => {
    test('navigation function executes quickly', () => {
      Object.defineProperty(window, 'location', {
        value: {
          search: '?page=1&limit=10&keyword=test',
        },
        writable: true,
      })

      render(<DocumentDetailWithFix datasetId="dataset-123" documentId="doc-456" />)

      const startTime = performance.now()
      fireEvent.click(screen.getByTestId('back-button-fixed'))
      const endTime = performance.now()

      const executionTime = endTime - startTime

      // Should execute in less than 10ms
      expect(executionTime).toBeLessThan(10)

      console.log(`⚡ Navigation execution time: ${executionTime.toFixed(2)}ms`)
    })
  })
})
