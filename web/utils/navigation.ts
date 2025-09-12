/**
 * Navigation Utilities
 *
 * Provides helper functions for consistent navigation behavior throughout the application,
 * specifically for preserving query parameters when navigating between related pages.
 */

/**
 * Creates a navigation path that preserves current URL query parameters
 *
 * @param basePath - The base path to navigate to (e.g., '/datasets/123/documents')
 * @param preserveParams - Whether to preserve current query parameters (default: true)
 * @returns The complete navigation path with preserved query parameters
 *
 * @example
 * // Current URL: /datasets/123/documents/456?page=3&limit=10&keyword=test
 * const backPath = createNavigationPath('/datasets/123/documents')
 * // Returns: '/datasets/123/documents?page=3&limit=10&keyword=test'
 *
 * @example
 * // Navigate without preserving params
 * const cleanPath = createNavigationPath('/datasets/123/documents', false)
 * // Returns: '/datasets/123/documents'
 */
export function createNavigationPath(basePath: string, preserveParams: boolean = true): string {
  if (!preserveParams)
    return basePath

  try {
    const searchParams = new URLSearchParams(window.location.search)
    const queryString = searchParams.toString()
    const separator = queryString ? '?' : ''
    return `${basePath}${separator}${queryString}`
  }
  catch (error) {
    // Fallback to base path if there's any error accessing location
    console.warn('Failed to preserve query parameters:', error)
    return basePath
  }
}

/**
 * Creates a back navigation function that preserves query parameters
 *
 * @param router - Next.js router instance
 * @param basePath - The base path to navigate back to
 * @param preserveParams - Whether to preserve current query parameters (default: true)
 * @returns A function that navigates back with preserved parameters
 *
 * @example
 * const router = useRouter()
 * const backToPrev = createBackNavigation(router, `/datasets/${datasetId}/documents`)
 *
 * // Later, when user clicks back:
 * backToPrev()
 */
export function createBackNavigation(
  router: { push: (path: string) => void },
  basePath: string,
  preserveParams: boolean = true,
): () => void {
  return () => {
    const navigationPath = createNavigationPath(basePath, preserveParams)
    router.push(navigationPath)
  }
}

/**
 * Extracts specific query parameters from current URL
 *
 * @param paramNames - Array of parameter names to extract
 * @returns Object with extracted parameters
 *
 * @example
 * // Current URL: /page?page=3&limit=10&keyword=test&other=value
 * const params = extractQueryParams(['page', 'limit', 'keyword'])
 * // Returns: { page: '3', limit: '10', keyword: 'test' }
 */
export function extractQueryParams(paramNames: string[]): Record<string, string> {
  try {
    const searchParams = new URLSearchParams(window.location.search)
    const extracted: Record<string, string> = {}

    paramNames.forEach((name) => {
      const value = searchParams.get(name)
      if (value !== null)
        extracted[name] = value
    })

    return extracted
  }
  catch (error) {
    console.warn('Failed to extract query parameters:', error)
    return {}
  }
}

/**
 * Creates a navigation path with specific query parameters
 *
 * @param basePath - The base path
 * @param params - Object of query parameters to include
 * @returns Navigation path with specified parameters
 *
 * @example
 * const path = createNavigationPathWithParams('/datasets/123/documents', {
 *   page: '1',
 *   limit: '25',
 *   keyword: 'search term'
 * })
 * // Returns: '/datasets/123/documents?page=1&limit=25&keyword=search+term'
 */
export function createNavigationPathWithParams(
  basePath: string,
  params: Record<string, string | number>,
): string {
  try {
    const searchParams = new URLSearchParams()

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '')
        searchParams.set(key, String(value))
    })

    const queryString = searchParams.toString()
    const separator = queryString ? '?' : ''
    return `${basePath}${separator}${queryString}`
  }
  catch (error) {
    console.warn('Failed to create navigation path with params:', error)
    return basePath
  }
}

/**
 * Merges current query parameters with new ones
 *
 * @param newParams - New parameters to add or override
 * @param preserveExisting - Whether to preserve existing parameters (default: true)
 * @returns URLSearchParams object with merged parameters
 *
 * @example
 * // Current URL: /page?page=3&limit=10
 * const merged = mergeQueryParams({ keyword: 'test', page: '1' })
 * // Results in: page=1&limit=10&keyword=test (page overridden, limit preserved, keyword added)
 */
export function mergeQueryParams(
  newParams: Record<string, string | number | null | undefined>,
  preserveExisting: boolean = true,
): URLSearchParams {
  const searchParams = preserveExisting
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams()

  Object.entries(newParams).forEach(([key, value]) => {
    if (value === null || value === undefined)
      searchParams.delete(key)
    else if (value !== '')
      searchParams.set(key, String(value))
  })

  return searchParams
}

/**
 * Navigation utilities for common dataset/document patterns
 */
export const datasetNavigation = {
  /**
   * Creates navigation back to dataset documents list with preserved state
   */
  backToDocuments: (router: { push: (path: string) => void }, datasetId: string) => {
    return createBackNavigation(router, `/datasets/${datasetId}/documents`)
  },

  /**
   * Creates navigation to document detail
   */
  toDocumentDetail: (router: { push: (path: string) => void }, datasetId: string, documentId: string) => {
    return () => router.push(`/datasets/${datasetId}/documents/${documentId}`)
  },

  /**
   * Creates navigation to document settings
   */
  toDocumentSettings: (router: { push: (path: string) => void }, datasetId: string, documentId: string) => {
    return () => router.push(`/datasets/${datasetId}/documents/${documentId}/settings`)
  },
}
