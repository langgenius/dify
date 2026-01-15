import type { MockedFunction } from 'vitest'
/**
 * Test GotoAnything search error handling mechanisms
 *
 * Main validations:
 * 1. @plugin search error handling when API fails
 * 2. Regular search (without @prefix) error handling when API fails
 * 3. Verify consistent error handling across different search types
 * 4. Ensure errors don't propagate to UI layer causing "search failed"
 */

import { appScope, knowledgeScope, pluginScope, searchAnything } from '@/app/components/goto-anything/actions'
import { searchApps, searchDatasets, searchPlugins } from '@/service/use-goto-anything'

// Mock react-i18next before importing modules that use it
vi.mock('react-i18next', () => ({
  getI18n: () => ({
    t: (key: string) => key,
    language: 'en',
  }),
}))

// Mock the new oRPC-based service functions
vi.mock('@/service/use-goto-anything', () => ({
  searchApps: vi.fn(),
  searchDatasets: vi.fn(),
  searchPlugins: vi.fn(),
}))

const mockSearchApps = searchApps as MockedFunction<typeof searchApps>
const mockSearchDatasets = searchDatasets as MockedFunction<typeof searchDatasets>
const mockSearchPlugins = searchPlugins as MockedFunction<typeof searchPlugins>
const searchScopes = [appScope, knowledgeScope, pluginScope]

describe('GotoAnything Search Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Suppress console.warn for clean test output
    vi.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress console.warn for clean test output
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('@plugin search error handling', () => {
    it('should return empty array when API fails instead of throwing error', async () => {
      // Mock marketplace API failure (403 permission denied)
      mockSearchPlugins.mockRejectedValue(new Error('HTTP 403: Forbidden'))

      const result = await pluginScope.search('@plugin', 'test', 'en')

      // Should return empty array instead of throwing error
      expect(result).toEqual([])
      expect(mockSearchPlugins).toHaveBeenCalledWith('test')
    })

    it('should return empty array when user has no plugin data', async () => {
      // Mock marketplace returning empty data
      mockSearchPlugins.mockResolvedValue({
        data: { plugins: [], total: 0 },
      })

      const result = await pluginScope.search('@plugin', '', 'en')

      expect(result).toEqual([])
    })

    it('should return empty array when API returns unexpected data structure', async () => {
      // Mock API returning unexpected data structure
      mockSearchPlugins.mockResolvedValue({
        data: null,
      } as any)

      const result = await pluginScope.search('@plugin', 'test', 'en')

      expect(result).toEqual([])
    })
  })

  describe('Other search types error handling', () => {
    it('@app search should return empty array when API fails', async () => {
      // Mock app API failure
      mockSearchApps.mockRejectedValue(new Error('API Error'))

      const result = await appScope.search('@app', 'test', 'en')

      expect(result).toEqual([])
    })

    it('@knowledge search should return empty array when API fails', async () => {
      // Mock knowledge API failure
      mockSearchDatasets.mockRejectedValue(new Error('API Error'))

      const result = await knowledgeScope.search('@knowledge', 'test', 'en')

      expect(result).toEqual([])
    })
  })

  describe('Unified search entry error handling', () => {
    it('regular search (without @prefix) should return successful results even when partial APIs fail', async () => {
      // Set app and knowledge success, plugin failure
      mockSearchApps.mockResolvedValue({ data: [], has_more: false, limit: 10, page: 1, total: 0 })
      mockSearchDatasets.mockResolvedValue({ data: [], has_more: false, limit: 10, page: 1, total: 0 })
      mockSearchPlugins.mockRejectedValue(new Error('Plugin API failed'))

      const result = await searchAnything('en', 'test', undefined, searchScopes)

      // Should return successful results even if plugin search fails
      expect(result).toEqual([])
      expect(console.warn).toHaveBeenCalledWith('Plugin search failed:', expect.any(Error))
    })

    it('@plugin dedicated search should return empty array when API fails', async () => {
      // Mock plugin API failure
      mockSearchPlugins.mockRejectedValue(new Error('Plugin service unavailable'))

      const result = await searchAnything('en', '@plugin test', pluginScope, searchScopes)

      // Should return empty array instead of throwing error
      expect(result).toEqual([])
    })

    it('@app dedicated search should return empty array when API fails', async () => {
      // Mock app API failure
      mockSearchApps.mockRejectedValue(new Error('App service unavailable'))

      const result = await searchAnything('en', '@app test', appScope, searchScopes)

      expect(result).toEqual([])
    })
  })

  describe('Error handling consistency validation', () => {
    it('all search types should return empty array when encountering errors', async () => {
      // Mock all APIs to fail
      mockSearchPlugins.mockRejectedValue(new Error('Plugin API failed'))
      mockSearchApps.mockRejectedValue(new Error('App API failed'))
      mockSearchDatasets.mockRejectedValue(new Error('Dataset API failed'))

      const actions = [
        { name: '@plugin', action: pluginScope },
        { name: '@app', action: appScope },
        { name: '@knowledge', action: knowledgeScope },
      ]

      for (const { name, action } of actions) {
        const result = await action.search(name, 'test', 'en')
        expect(result).toEqual([])
      }
    })
  })

  describe('Edge case testing', () => {
    it('empty search term should be handled properly', async () => {
      mockSearchPlugins.mockResolvedValue({ data: { plugins: [], total: 0 } })

      const result = await searchAnything('en', '@plugin ', pluginScope, searchScopes)
      expect(result).toEqual([])
    })

    it('network timeout should be handled correctly', async () => {
      const timeoutError = new Error('Network timeout')
      timeoutError.name = 'TimeoutError'

      mockSearchPlugins.mockRejectedValue(timeoutError)

      const result = await searchAnything('en', '@plugin test', pluginScope, searchScopes)
      expect(result).toEqual([])
    })

    it('JSON parsing errors should be handled correctly', async () => {
      const parseError = new SyntaxError('Unexpected token in JSON')
      mockSearchPlugins.mockRejectedValue(parseError)

      const result = await searchAnything('en', '@plugin test', pluginScope, searchScopes)
      expect(result).toEqual([])
    })
  })
})
