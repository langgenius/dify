/**
 * Navigation Utilities Test
 *
 * Tests for the navigation utility functions to ensure they handle
 * query parameter preservation correctly across different scenarios.
 */

import {
  createBackNavigation,
  createNavigationPath,
  createNavigationPathWithParams,
  datasetNavigation,
  extractQueryParams,
  mergeQueryParams,
} from '@/utils/navigation'

// Mock router for testing
const mockPush = jest.fn()
const mockRouter = { push: mockPush }

describe('Navigation Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('createNavigationPath', () => {
    test('preserves query parameters by default', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=3&limit=10&keyword=test' },
        writable: true,
      })

      const path = createNavigationPath('/datasets/123/documents')
      expect(path).toBe('/datasets/123/documents?page=3&limit=10&keyword=test')
    })

    test('returns clean path when preserveParams is false', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=3&limit=10' },
        writable: true,
      })

      const path = createNavigationPath('/datasets/123/documents', false)
      expect(path).toBe('/datasets/123/documents')
    })

    test('handles empty query parameters', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '' },
        writable: true,
      })

      const path = createNavigationPath('/datasets/123/documents')
      expect(path).toBe('/datasets/123/documents')
    })

    test('handles errors gracefully', () => {
      // Mock window.location to throw an error
      Object.defineProperty(window, 'location', {
        get: () => {
          throw new Error('Location access denied')
        },
        configurable: true,
      })

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const path = createNavigationPath('/datasets/123/documents')

      expect(path).toBe('/datasets/123/documents')
      expect(consoleSpy).toHaveBeenCalledWith('Failed to preserve query parameters:', expect.any(Error))

      consoleSpy.mockRestore()
    })
  })

  describe('createBackNavigation', () => {
    test('creates function that navigates with preserved params', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=2&limit=25' },
        writable: true,
      })

      const backFn = createBackNavigation(mockRouter, '/datasets/123/documents')
      backFn()

      expect(mockPush).toHaveBeenCalledWith('/datasets/123/documents?page=2&limit=25')
    })

    test('creates function that navigates without params when specified', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=2&limit=25' },
        writable: true,
      })

      const backFn = createBackNavigation(mockRouter, '/datasets/123/documents', false)
      backFn()

      expect(mockPush).toHaveBeenCalledWith('/datasets/123/documents')
    })
  })

  describe('extractQueryParams', () => {
    test('extracts specified parameters', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=3&limit=10&keyword=test&other=value' },
        writable: true,
      })

      const params = extractQueryParams(['page', 'limit', 'keyword'])
      expect(params).toEqual({
        page: '3',
        limit: '10',
        keyword: 'test',
      })
    })

    test('handles missing parameters', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=3' },
        writable: true,
      })

      const params = extractQueryParams(['page', 'limit', 'missing'])
      expect(params).toEqual({
        page: '3',
      })
    })

    test('handles errors gracefully', () => {
      Object.defineProperty(window, 'location', {
        get: () => {
          throw new Error('Location access denied')
        },
        configurable: true,
      })

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const params = extractQueryParams(['page', 'limit'])

      expect(params).toEqual({})
      expect(consoleSpy).toHaveBeenCalledWith('Failed to extract query parameters:', expect.any(Error))

      consoleSpy.mockRestore()
    })
  })

  describe('createNavigationPathWithParams', () => {
    test('creates path with specified parameters', () => {
      const path = createNavigationPathWithParams('/datasets/123/documents', {
        page: 1,
        limit: 25,
        keyword: 'search term',
      })

      expect(path).toBe('/datasets/123/documents?page=1&limit=25&keyword=search+term')
    })

    test('filters out empty values', () => {
      const path = createNavigationPathWithParams('/datasets/123/documents', {
        page: 1,
        limit: '',
        keyword: 'test',
        filter: '',
      })

      expect(path).toBe('/datasets/123/documents?page=1&keyword=test')
    })

    test('handles errors gracefully', () => {
      // Mock URLSearchParams to throw an error
      const originalURLSearchParams = globalThis.URLSearchParams
      globalThis.URLSearchParams = jest.fn(() => {
        throw new Error('URLSearchParams error')
      }) as any

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const path = createNavigationPathWithParams('/datasets/123/documents', { page: 1 })

      expect(path).toBe('/datasets/123/documents')
      expect(consoleSpy).toHaveBeenCalledWith('Failed to create navigation path with params:', expect.any(Error))

      consoleSpy.mockRestore()
      globalThis.URLSearchParams = originalURLSearchParams
    })
  })

  describe('mergeQueryParams', () => {
    test('merges new params with existing ones', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=3&limit=10' },
        writable: true,
      })

      const merged = mergeQueryParams({ keyword: 'test', page: '1' })
      const result = merged.toString()

      expect(result).toContain('page=1') // overridden
      expect(result).toContain('limit=10') // preserved
      expect(result).toContain('keyword=test') // added
    })

    test('removes parameters when value is null', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=3&limit=10&keyword=test' },
        writable: true,
      })

      const merged = mergeQueryParams({ keyword: null, filter: 'active' })
      const result = merged.toString()

      expect(result).toContain('page=3')
      expect(result).toContain('limit=10')
      expect(result).not.toContain('keyword')
      expect(result).toContain('filter=active')
    })

    test('creates fresh params when preserveExisting is false', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=3&limit=10' },
        writable: true,
      })

      const merged = mergeQueryParams({ keyword: 'test' }, false)
      const result = merged.toString()

      expect(result).toBe('keyword=test')
    })
  })

  describe('datasetNavigation', () => {
    test('backToDocuments creates correct navigation function', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=2&limit=25' },
        writable: true,
      })

      const backFn = datasetNavigation.backToDocuments(mockRouter, 'dataset-123')
      backFn()

      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-123/documents?page=2&limit=25')
    })

    test('toDocumentDetail creates correct navigation function', () => {
      const detailFn = datasetNavigation.toDocumentDetail(mockRouter, 'dataset-123', 'doc-456')
      detailFn()

      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-123/documents/doc-456')
    })

    test('toDocumentSettings creates correct navigation function', () => {
      const settingsFn = datasetNavigation.toDocumentSettings(mockRouter, 'dataset-123', 'doc-456')
      settingsFn()

      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-123/documents/doc-456/settings')
    })
  })

  describe('Real-world Integration Scenarios', () => {
    test('complete user workflow: list -> detail -> back', () => {
      // User starts on page 3 with search
      Object.defineProperty(window, 'location', {
        value: { search: '?page=3&keyword=API&limit=25' },
        writable: true,
      })

      // Create back navigation function (as would be done in detail component)
      const backToDocuments = datasetNavigation.backToDocuments(mockRouter, 'main-dataset')

      // User clicks back
      backToDocuments()

      // Should return to exact same list state
      expect(mockPush).toHaveBeenCalledWith('/datasets/main-dataset/documents?page=3&keyword=API&limit=25')
    })

    test('user applies filters then views document', () => {
      // Complex filter state
      Object.defineProperty(window, 'location', {
        value: { search: '?page=1&limit=50&status=active&type=pdf&sort=created_at&order=desc' },
        writable: true,
      })

      const backFn = createBackNavigation(mockRouter, '/datasets/filtered-set/documents')
      backFn()

      expect(mockPush).toHaveBeenCalledWith('/datasets/filtered-set/documents?page=1&limit=50&status=active&type=pdf&sort=created_at&order=desc')
    })
  })

  describe('Edge Cases and Error Handling', () => {
    test('handles special characters in query parameters', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?keyword=hello%20world&filter=type%3Apdf&tag=%E4%B8%AD%E6%96%87' },
        writable: true,
      })

      const path = createNavigationPath('/datasets/123/documents')
      expect(path).toContain('hello+world')
      expect(path).toContain('type%3Apdf')
      expect(path).toContain('%E4%B8%AD%E6%96%87')
    })

    test('handles duplicate query parameters', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?tag=tag1&tag=tag2&tag=tag3' },
        writable: true,
      })

      const params = extractQueryParams(['tag'])
      // URLSearchParams.get() returns the first value
      expect(params.tag).toBe('tag1')
    })

    test('handles very long query strings', () => {
      const longValue = 'a'.repeat(1000)
      Object.defineProperty(window, 'location', {
        value: { search: `?data=${longValue}` },
        writable: true,
      })

      const path = createNavigationPath('/datasets/123/documents')
      expect(path).toContain(longValue)
      expect(path.length).toBeGreaterThan(1000)
    })

    test('handles empty string values in query parameters', () => {
      const path = createNavigationPathWithParams('/datasets/123/documents', {
        page: 1,
        keyword: '',
        filter: '',
        sort: 'name',
      })

      expect(path).toBe('/datasets/123/documents?page=1&sort=name')
      expect(path).not.toContain('keyword=')
      expect(path).not.toContain('filter=')
    })

    test('handles null and undefined values in mergeQueryParams', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=1&limit=10&keyword=test' },
        writable: true,
      })

      const merged = mergeQueryParams({
        keyword: null,
        filter: undefined,
        sort: 'name',
      })
      const result = merged.toString()

      expect(result).toContain('page=1')
      expect(result).toContain('limit=10')
      expect(result).not.toContain('keyword')
      expect(result).toContain('sort=name')
    })

    test('handles navigation with hash fragments', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=1', hash: '#section-2' },
        writable: true,
      })

      const path = createNavigationPath('/datasets/123/documents')
      // Should preserve query params but not hash
      expect(path).toBe('/datasets/123/documents?page=1')
    })

    test('handles malformed query strings gracefully', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?page=1&invalid&limit=10&=value&key=' },
        writable: true,
      })

      const params = extractQueryParams(['page', 'limit', 'invalid', 'key'])
      expect(params.page).toBe('1')
      expect(params.limit).toBe('10')
      // Malformed params should be handled by URLSearchParams
      expect(params.invalid).toBe('') // for `&invalid`
      expect(params.key).toBe('') // for `&key=`
    })
  })

  describe('Performance Tests', () => {
    test('handles large number of query parameters efficiently', () => {
      const manyParams = Array.from({ length: 50 }, (_, i) => `param${i}=value${i}`).join('&')
      Object.defineProperty(window, 'location', {
        value: { search: `?${manyParams}` },
        writable: true,
      })

      const startTime = Date.now()
      const path = createNavigationPath('/datasets/123/documents')
      const endTime = Date.now()

      expect(endTime - startTime).toBeLessThan(50) // Should be fast
      expect(path).toContain('param0=value0')
      expect(path).toContain('param49=value49')
    })
  })
})
