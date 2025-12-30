import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import useDocumentListQueryState from './use-document-list-query-state'

const renderWithAdapter = (searchParams = '') => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={searchParams}>
      {children}
    </NuqsTestingAdapter>
  )

  return renderHook(() => useDocumentListQueryState(), { wrapper })
}

// Document list query state: defaults, sanitization, and update actions.
describe('useDocumentListQueryState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Default query values.
  describe('Rendering', () => {
    it('should return default query values when URL params are missing', () => {
      // Arrange
      const { result } = renderWithAdapter()

      // Act
      const { query } = result.current

      // Assert
      expect(query).toEqual({
        page: 1,
        limit: 10,
        keyword: '',
        status: 'all',
        sort: '-created_at',
      })
    })
  })

  // URL sanitization behavior.
  describe('Edge Cases', () => {
    it('should sanitize invalid URL query values', () => {
      // Arrange
      const { result } = renderWithAdapter('?page=0&limit=500&keyword=%20%20&status=invalid&sort=bad')

      // Act
      const { query } = result.current

      // Assert
      expect(query).toEqual({
        page: 1,
        limit: 10,
        keyword: '',
        status: 'all',
        sort: '-created_at',
      })
    })
  })

  // Query update actions.
  describe('User Interactions', () => {
    it('should normalize query updates', async () => {
      // Arrange
      const { result } = renderWithAdapter()

      // Act
      act(() => {
        result.current.updateQuery({
          page: 0,
          limit: 200,
          keyword: '  search  ',
          status: 'invalid',
          sort: 'hit_count',
        })
      })

      // Assert
      await waitFor(() => {
        expect(result.current.query).toEqual({
          page: 1,
          limit: 10,
          keyword: '  search  ',
          status: 'all',
          sort: 'hit_count',
        })
      })
    })

    it('should reset query values to defaults', async () => {
      // Arrange
      const { result } = renderWithAdapter('?page=2&limit=25&keyword=hello&status=enabled&sort=hit_count')

      // Act
      act(() => {
        result.current.resetQuery()
      })

      // Assert
      await waitFor(() => {
        expect(result.current.query).toEqual({
          page: 1,
          limit: 10,
          keyword: '',
          status: 'all',
          sort: '-created_at',
        })
      })
    })
  })

  // Callback stability.
  describe('Performance', () => {
    it('should keep action callbacks stable across updates', async () => {
      // Arrange
      const { result } = renderWithAdapter()
      const initialUpdate = result.current.updateQuery
      const initialReset = result.current.resetQuery

      // Act
      act(() => {
        result.current.updateQuery({ page: 2 })
      })

      // Assert
      await waitFor(() => {
        expect(result.current.updateQuery).toBe(initialUpdate)
        expect(result.current.resetQuery).toBe(initialReset)
      })
    })
  })
})
