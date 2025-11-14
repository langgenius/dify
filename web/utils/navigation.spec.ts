/**
 * Test suite for navigation utility functions
 * Tests URL and query parameter manipulation for consistent navigation behavior
 * Includes helpers for preserving state during navigation (pagination, filters, etc.)
 */
import {
  createBackNavigation,
  createNavigationPath,
  createNavigationPathWithParams,
  datasetNavigation,
  extractQueryParams,
  mergeQueryParams,
} from './navigation'

describe('navigation', () => {
  const originalWindow = globalThis.window

  beforeEach(() => {
    // Mock window.location with sample query parameters
    delete (globalThis as any).window
    globalThis.window = {
      location: {
        search: '?page=3&limit=10&keyword=test',
      },
    } as any
  })

  afterEach(() => {
    globalThis.window = originalWindow
  })

  /**
   * Tests createNavigationPath which builds URLs with optional query parameter preservation
   */
  describe('createNavigationPath', () => {
    test('preserves query parameters by default', () => {
      const result = createNavigationPath('/datasets/123/documents')
      expect(result).toBe('/datasets/123/documents?page=3&limit=10&keyword=test')
    })

    test('returns clean path when preserveParams is false', () => {
      const result = createNavigationPath('/datasets/123/documents', false)
      expect(result).toBe('/datasets/123/documents')
    })

    test('handles empty query string', () => {
      globalThis.window.location.search = ''
      const result = createNavigationPath('/datasets/123/documents')
      expect(result).toBe('/datasets/123/documents')
    })

    test('handles path with trailing slash', () => {
      const result = createNavigationPath('/datasets/123/documents/')
      expect(result).toBe('/datasets/123/documents/?page=3&limit=10&keyword=test')
    })

    test('handles root path', () => {
      const result = createNavigationPath('/')
      expect(result).toBe('/?page=3&limit=10&keyword=test')
    })
  })

  /**
   * Tests createBackNavigation which creates a navigation callback function
   */
  describe('createBackNavigation', () => {
    /**
     * Tests that the returned function properly navigates with preserved params
     */
    test('returns function that calls router.push with correct path', () => {
      const mockRouter = { push: jest.fn() }
      const backNav = createBackNavigation(mockRouter, '/datasets/123/documents')

      backNav()

      expect(mockRouter.push).toHaveBeenCalledWith('/datasets/123/documents?page=3&limit=10&keyword=test')
    })

    test('returns function that navigates without params when preserveParams is false', () => {
      const mockRouter = { push: jest.fn() }
      const backNav = createBackNavigation(mockRouter, '/datasets/123/documents', false)

      backNav()

      expect(mockRouter.push).toHaveBeenCalledWith('/datasets/123/documents')
    })

    test('can be called multiple times', () => {
      const mockRouter = { push: jest.fn() }
      const backNav = createBackNavigation(mockRouter, '/datasets/123/documents')

      backNav()
      backNav()

      expect(mockRouter.push).toHaveBeenCalledTimes(2)
    })
  })

  /**
   * Tests extractQueryParams which extracts specific parameters from current URL
   */
  describe('extractQueryParams', () => {
    /**
     * Tests selective parameter extraction
     */
    test('extracts specified parameters', () => {
      const result = extractQueryParams(['page', 'limit'])
      expect(result).toEqual({ page: '3', limit: '10' })
    })

    test('extracts all specified parameters including keyword', () => {
      const result = extractQueryParams(['page', 'limit', 'keyword'])
      expect(result).toEqual({ page: '3', limit: '10', keyword: 'test' })
    })

    test('ignores non-existent parameters', () => {
      const result = extractQueryParams(['page', 'nonexistent'])
      expect(result).toEqual({ page: '3' })
    })

    test('returns empty object when no parameters match', () => {
      const result = extractQueryParams(['foo', 'bar'])
      expect(result).toEqual({})
    })

    test('returns empty object for empty array', () => {
      const result = extractQueryParams([])
      expect(result).toEqual({})
    })

    test('handles empty query string', () => {
      globalThis.window.location.search = ''
      const result = extractQueryParams(['page', 'limit'])
      expect(result).toEqual({})
    })
  })

  /**
   * Tests createNavigationPathWithParams which builds URLs with specific parameters
   */
  describe('createNavigationPathWithParams', () => {
    /**
     * Tests URL construction with custom parameters
     */
    test('creates path with specified parameters', () => {
      const result = createNavigationPathWithParams('/datasets/123/documents', {
        page: '1',
        limit: '25',
      })
      expect(result).toBe('/datasets/123/documents?page=1&limit=25')
    })

    test('handles string and number values', () => {
      const result = createNavigationPathWithParams('/datasets/123/documents', {
        page: 1,
        limit: 25,
        keyword: 'search',
      })
      expect(result).toBe('/datasets/123/documents?page=1&limit=25&keyword=search')
    })

    test('filters out empty string values', () => {
      const result = createNavigationPathWithParams('/datasets/123/documents', {
        page: '1',
        keyword: '',
      })
      expect(result).toBe('/datasets/123/documents?page=1')
    })

    test('filters out null and undefined values', () => {
      const result = createNavigationPathWithParams('/datasets/123/documents', {
        page: '1',
        keyword: null as any,
        filter: undefined as any,
      })
      expect(result).toBe('/datasets/123/documents?page=1')
    })

    test('returns base path when params are empty', () => {
      const result = createNavigationPathWithParams('/datasets/123/documents', {})
      expect(result).toBe('/datasets/123/documents')
    })

    test('encodes special characters in values', () => {
      const result = createNavigationPathWithParams('/datasets/123/documents', {
        keyword: 'search term',
      })
      expect(result).toBe('/datasets/123/documents?keyword=search+term')
    })
  })

  /**
   * Tests mergeQueryParams which combines new parameters with existing URL params
   */
  describe('mergeQueryParams', () => {
    /**
     * Tests parameter merging and overriding
     */
    test('merges new params with existing ones', () => {
      const result = mergeQueryParams({ keyword: 'new', page: '1' })
      expect(result.get('page')).toBe('1')
      expect(result.get('limit')).toBe('10')
      expect(result.get('keyword')).toBe('new')
    })

    test('overrides existing parameters', () => {
      const result = mergeQueryParams({ page: '5' })
      expect(result.get('page')).toBe('5')
      expect(result.get('limit')).toBe('10')
    })

    test('adds new parameters', () => {
      const result = mergeQueryParams({ filter: 'active' })
      expect(result.get('filter')).toBe('active')
      expect(result.get('page')).toBe('3')
    })

    test('removes parameters with null value', () => {
      const result = mergeQueryParams({ page: null })
      expect(result.get('page')).toBeNull()
      expect(result.get('limit')).toBe('10')
    })

    test('removes parameters with undefined value', () => {
      const result = mergeQueryParams({ page: undefined })
      expect(result.get('page')).toBeNull()
      expect(result.get('limit')).toBe('10')
    })

    test('does not preserve existing when preserveExisting is false', () => {
      const result = mergeQueryParams({ filter: 'active' }, false)
      expect(result.get('filter')).toBe('active')
      expect(result.get('page')).toBeNull()
      expect(result.get('limit')).toBeNull()
    })

    test('handles number values', () => {
      const result = mergeQueryParams({ page: 5, limit: 20 })
      expect(result.get('page')).toBe('5')
      expect(result.get('limit')).toBe('20')
    })

    test('does not add empty string values', () => {
      const result = mergeQueryParams({ newParam: '' })
      expect(result.get('newParam')).toBeNull()
      // Existing params are preserved
      expect(result.get('keyword')).toBe('test')
    })
  })

  /**
   * Tests datasetNavigation helper object with common dataset navigation patterns
   */
  describe('datasetNavigation', () => {
    /**
     * Tests navigation back to dataset documents list
     */
    describe('backToDocuments', () => {
      test('creates navigation function with preserved params', () => {
        const mockRouter = { push: jest.fn() }
        const backNav = datasetNavigation.backToDocuments(mockRouter, 'dataset-123')

        backNav()

        expect(mockRouter.push).toHaveBeenCalledWith('/datasets/dataset-123/documents?page=3&limit=10&keyword=test')
      })
    })

    /**
     * Tests navigation to document detail page
     */
    describe('toDocumentDetail', () => {
      test('creates navigation function to document detail', () => {
        const mockRouter = { push: jest.fn() }
        const navFunc = datasetNavigation.toDocumentDetail(mockRouter, 'dataset-123', 'doc-456')

        navFunc()

        expect(mockRouter.push).toHaveBeenCalledWith('/datasets/dataset-123/documents/doc-456')
      })
    })

    /**
     * Tests navigation to document settings page
     */
    describe('toDocumentSettings', () => {
      test('creates navigation function to document settings', () => {
        const mockRouter = { push: jest.fn() }
        const navFunc = datasetNavigation.toDocumentSettings(mockRouter, 'dataset-123', 'doc-456')

        navFunc()

        expect(mockRouter.push).toHaveBeenCalledWith('/datasets/dataset-123/documents/doc-456/settings')
      })
    })
  })
})
