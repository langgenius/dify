import { renderHook, act, waitFor } from '@testing-library/react'
import { useSearchParams, usePathname, useRouter } from 'next/navigation'
import useAppsQueryState from './use-apps-query-state'
import type { SortBy, SortOrder } from './use-apps-query-state'

// Mock Next.js navigation hooks
const mockPush = jest.fn()
const mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
  usePathname: jest.fn(),
  useRouter: jest.fn(),
}))

describe('useAppsQueryState', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams.forEach((_, key) => mockSearchParams.delete(key))
    ;(useSearchParams as jest.Mock).mockReturnValue(mockSearchParams)
    ;(usePathname as jest.Mock).mockReturnValue('/apps')
    ;(useRouter as jest.Mock).mockReturnValue({ push: mockPush })
  })

  describe('Initial State', () => {
    it('should initialize with default values when no search params', () => {
      // Arrange & Act
      const { result } = renderHook(() => useAppsQueryState())

      // Assert
      expect(result.current.query.tagIDs).toBeUndefined()
      expect(result.current.query.keywords).toBeUndefined()
      expect(result.current.query.isCreatedByMe).toBe(true)
      expect(result.current.query.sortBy).toBeUndefined()
      expect(result.current.query.sortOrder).toBeUndefined()
    })

    it('should parse tagIDs from search params', () => {
      // Arrange
      mockSearchParams.set('tagIDs', 'tag1;tag2;tag3')
      ;(useSearchParams as jest.Mock).mockReturnValue(mockSearchParams)

      // Act
      const { result } = renderHook(() => useAppsQueryState())

      // Assert
      expect(result.current.query.tagIDs).toEqual(['tag1', 'tag2', 'tag3'])
    })

    it('should parse keywords from search params', () => {
      // Arrange
      mockSearchParams.set('keywords', 'test keywords')
      ;(useSearchParams as jest.Mock).mockReturnValue(mockSearchParams)

      // Act
      const { result } = renderHook(() => useAppsQueryState())

      // Assert
      expect(result.current.query.keywords).toBe('test keywords')
    })

    it('should parse isCreatedByMe as false when explicitly set', () => {
      // Arrange
      mockSearchParams.set('isCreatedByMe', 'false')
      ;(useSearchParams as jest.Mock).mockReturnValue(mockSearchParams)

      // Act
      const { result } = renderHook(() => useAppsQueryState())

      // Assert
      expect(result.current.query.isCreatedByMe).toBe(false)
    })

    it('should parse sortBy from search params', () => {
      // Arrange
      mockSearchParams.set('sortBy', 'name')
      ;(useSearchParams as jest.Mock).mockReturnValue(mockSearchParams)

      // Act
      const { result } = renderHook(() => useAppsQueryState())

      // Assert
      expect(result.current.query.sortBy).toBe('name')
    })

    it('should parse sortOrder from search params', () => {
      // Arrange
      mockSearchParams.set('sortOrder', 'asc')
      ;(useSearchParams as jest.Mock).mockReturnValue(mockSearchParams)

      // Act
      const { result } = renderHook(() => useAppsQueryState())

      // Assert
      expect(result.current.query.sortOrder).toBe('asc')
    })
  })

  describe('State Updates', () => {
    it('should update sortBy and sortOrder', async () => {
      // Arrange
      const { result } = renderHook(() => useAppsQueryState())

      // Act
      act(() => {
        result.current.setQuery(prev => ({
          ...prev,
          sortBy: 'created_at' as SortBy,
          sortOrder: 'desc' as SortOrder,
        }))
      })

      // Assert
      await waitFor(() => {
        expect(result.current.query.sortBy).toBe('created_at')
        expect(result.current.query.sortOrder).toBe('desc')
      })
    })

    it('should update keywords', async () => {
      // Arrange
      const { result } = renderHook(() => useAppsQueryState())

      // Act
      act(() => {
        result.current.setQuery(prev => ({
          ...prev,
          keywords: 'new keywords',
        }))
      })

      // Assert
      await waitFor(() => {
        expect(result.current.query.keywords).toBe('new keywords')
      })
    })

    it('should update tagIDs', async () => {
      // Arrange
      const { result } = renderHook(() => useAppsQueryState())

      // Act
      act(() => {
        result.current.setQuery(prev => ({
          ...prev,
          tagIDs: ['tag1', 'tag2'],
        }))
      })

      // Assert
      await waitFor(() => {
        expect(result.current.query.tagIDs).toEqual(['tag1', 'tag2'])
      })
    })

    it('should update isCreatedByMe', async () => {
      // Arrange
      const { result } = renderHook(() => useAppsQueryState())

      // Act
      act(() => {
        result.current.setQuery(prev => ({
          ...prev,
          isCreatedByMe: false,
        }))
      })

      // Assert
      await waitFor(() => {
        expect(result.current.query.isCreatedByMe).toBe(false)
      })
    })
  })

  describe('URL Synchronization', () => {
    it('should sync sortBy and sortOrder to URL', async () => {
      // Arrange
      const { result } = renderHook(() => useAppsQueryState())

      // Act
      act(() => {
        result.current.setQuery(prev => ({
          ...prev,
          sortBy: 'name' as SortBy,
          sortOrder: 'asc' as SortOrder,
        }))
      })

      // Assert
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalled()
        const callArg = mockPush.mock.calls[mockPush.mock.calls.length - 1][0]
        expect(callArg).toContain('sortBy=name')
        expect(callArg).toContain('sortOrder=asc')
      })
    })

    it('should remove sortBy from URL when undefined', async () => {
      // Arrange
      mockSearchParams.set('sortBy', 'name')
      ;(useSearchParams as jest.Mock).mockReturnValue(mockSearchParams)
      const { result } = renderHook(() => useAppsQueryState())

      // Act
      act(() => {
        result.current.setQuery(prev => ({
          ...prev,
          sortBy: undefined,
        }))
      })

      // Assert
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalled()
        const callArg = mockPush.mock.calls[mockPush.mock.calls.length - 1][0]
        expect(callArg).not.toContain('sortBy')
      })
    })

    it('should handle multiple query parameters together', async () => {
      // Arrange
      const { result } = renderHook(() => useAppsQueryState())

      // Act
      act(() => {
        result.current.setQuery({
          keywords: 'test',
          tagIDs: ['tag1', 'tag2'],
          isCreatedByMe: false,
          sortBy: 'updated_at' as SortBy,
          sortOrder: 'desc' as SortOrder,
        })
      })

      // Assert
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalled()
        const callArg = mockPush.mock.calls[mockPush.mock.calls.length - 1][0]
        expect(callArg).toContain('keywords=test')
        expect(callArg).toContain('tagIDs=tag1')
        expect(callArg).toContain('isCreatedByMe=false')
        expect(callArg).toContain('sortBy=updated_at')
        expect(callArg).toContain('sortOrder=desc')
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle all valid sortBy values', () => {
      const validSortByValues: SortBy[] = ['created_at', 'updated_at', 'name', 'owner_name']

      validSortByValues.forEach((sortBy) => {
        mockSearchParams.set('sortBy', sortBy)
        ;(useSearchParams as jest.Mock).mockReturnValue(mockSearchParams)

        const { result } = renderHook(() => useAppsQueryState())

        expect(result.current.query.sortBy).toBe(sortBy)
        mockSearchParams.delete('sortBy')
      })
    })

    it('should handle all valid sortOrder values', () => {
      const validSortOrderValues: SortOrder[] = ['asc', 'desc']

      validSortOrderValues.forEach((sortOrder) => {
        mockSearchParams.set('sortOrder', sortOrder)
        ;(useSearchParams as jest.Mock).mockReturnValue(mockSearchParams)

        const { result } = renderHook(() => useAppsQueryState())

        expect(result.current.query.sortOrder).toBe(sortOrder)
        mockSearchParams.delete('sortOrder')
      })
    })

    it('should handle empty string values gracefully', () => {
      // Arrange
      mockSearchParams.set('sortBy', '')
      mockSearchParams.set('sortOrder', '')
      ;(useSearchParams as jest.Mock).mockReturnValue(mockSearchParams)

      // Act
      const { result } = renderHook(() => useAppsQueryState())

      // Assert - Empty strings should be treated as undefined
      expect(result.current.query.sortBy).toBeUndefined()
      expect(result.current.query.sortOrder).toBeUndefined()
    })
  })
})
