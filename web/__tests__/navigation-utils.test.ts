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
})
