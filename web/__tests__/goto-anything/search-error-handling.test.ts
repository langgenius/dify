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

// Mock the actual service functions used by the scopes
vi.mock('@/service/use-goto-anything', () => ({
  searchPlugins: vi.fn(),
  searchApps: vi.fn(),
  searchDatasets: vi.fn(),
}))

const mockSearchPlugins = searchPlugins as MockedFunction<typeof searchPlugins>
const mockSearchApps = searchApps as MockedFunction<typeof searchApps>
const mockSearchDatasets = searchDatasets as MockedFunction<typeof searchDatasets>

describe('GotoAnything Search Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('@plugin search error handling', () => {
    it('should return empty array when API fails instead of throwing error', async () => {
      mockSearchPlugins.mockRejectedValue(new Error('HTTP 403: Forbidden'))

      const result = await pluginScope.search('@plugin', 'test', 'en')

      expect(result).toEqual([])
      expect(mockSearchPlugins).toHaveBeenCalledWith('test')
    })

    it('should return empty array when user has no plugin data', async () => {
      // eslint-disable-next-line ts/no-explicit-any
      mockSearchPlugins.mockResolvedValue({ data: { plugins: [] } } as any)

      const result = await pluginScope.search('@plugin', '', 'en')

      expect(result).toEqual([])
    })

    it('should return empty array when API returns unexpected data structure', async () => {
      // eslint-disable-next-line ts/no-explicit-any
      mockSearchPlugins.mockResolvedValue({ data: null } as any)

      const result = await pluginScope.search('@plugin', 'test', 'en')

      expect(result).toEqual([])
    })
  })

  describe('Other search types error handling', () => {
    it('@app search should return empty array when API fails', async () => {
      mockSearchApps.mockRejectedValue(new Error('API Error'))

      const result = await appScope.search('@app', 'test', 'en')

      expect(result).toEqual([])
    })

    it('@knowledge search should return empty array when API fails', async () => {
      mockSearchDatasets.mockRejectedValue(new Error('API Error'))

      const result = await knowledgeScope.search('@knowledge', 'test', 'en')

      expect(result).toEqual([])
    })
  })

  describe('Unified search entry error handling', () => {
    it('regular search (without @prefix) should return successful results even when partial APIs fail', async () => {
      // eslint-disable-next-line ts/no-explicit-any
      mockSearchApps.mockResolvedValue({ data: [], has_more: false, limit: 10, page: 1, total: 0 } as any)
      // eslint-disable-next-line ts/no-explicit-any
      mockSearchDatasets.mockResolvedValue({ data: [], has_more: false, limit: 10, page: 1, total: 0 } as any)
      mockSearchPlugins.mockRejectedValue(new Error('Plugin API failed'))

      const allScopes = [appScope, knowledgeScope, pluginScope]
      const result = await searchAnything('en', 'test', undefined, allScopes)

      expect(result).toEqual([])
      expect(console.warn).toHaveBeenCalled()
    })

    it('@plugin dedicated search should return empty array when API fails', async () => {
      mockSearchPlugins.mockRejectedValue(new Error('Plugin service unavailable'))

      const allScopes = [appScope, knowledgeScope, pluginScope]
      const result = await searchAnything('en', '@plugin test', pluginScope, allScopes)

      expect(result).toEqual([])
    })

    it('@app dedicated search should return empty array when API fails', async () => {
      mockSearchApps.mockRejectedValue(new Error('App service unavailable'))

      const allScopes = [appScope, knowledgeScope, pluginScope]
      const result = await searchAnything('en', '@app test', appScope, allScopes)

      expect(result).toEqual([])
    })
  })

  describe('Error handling consistency validation', () => {
    it('all search types should return empty array when encountering errors', async () => {
      mockSearchPlugins.mockRejectedValue(new Error('Plugin API failed'))
      mockSearchApps.mockRejectedValue(new Error('App API failed'))
      mockSearchDatasets.mockRejectedValue(new Error('Dataset API failed'))

      const actions = [
        { name: '@plugin', scope: pluginScope },
        { name: '@app', scope: appScope },
        { name: '@knowledge', scope: knowledgeScope },
      ]

      for (const { name, scope } of actions) {
        const result = await scope.search(name, 'test', 'en')
        expect(result).toEqual([])
      }
    })
  })

  describe('Edge case testing', () => {
    it('empty search term should be handled properly', async () => {
      // eslint-disable-next-line ts/no-explicit-any
      mockSearchPlugins.mockResolvedValue({ data: { plugins: [] } } as any)

      const allScopes = [appScope, knowledgeScope, pluginScope]
      const result = await searchAnything('en', '@plugin ', pluginScope, allScopes)
      expect(result).toEqual([])
    })

    it('network timeout should be handled correctly', async () => {
      const timeoutError = new Error('Network timeout')
      timeoutError.name = 'TimeoutError'

      mockSearchPlugins.mockRejectedValue(timeoutError)

      const allScopes = [appScope, knowledgeScope, pluginScope]
      const result = await searchAnything('en', '@plugin test', pluginScope, allScopes)
      expect(result).toEqual([])
    })

    it('JSON parsing errors should be handled correctly', async () => {
      const parseError = new SyntaxError('Unexpected token in JSON')
      mockSearchPlugins.mockRejectedValue(parseError)

      const allScopes = [appScope, knowledgeScope, pluginScope]
      const result = await searchAnything('en', '@plugin test', pluginScope, allScopes)
      expect(result).toEqual([])
    })
  })
})
