/**
 * Test GotoAnything search error handling mechanisms
 *
 * Main validations:
 * 1. @plugin search error handling when API fails
 * 2. Regular search (without @prefix) error handling when API fails
 * 3. Verify consistent error handling across different search types
 * 4. Ensure errors don't propagate to UI layer causing "search failed"
 */

import { Actions, searchAnything } from '@/app/components/goto-anything/actions'
import { postMarketplace } from '@/service/base'
import { fetchAppList } from '@/service/apps'
import { fetchDatasets } from '@/service/datasets'

// Mock API functions
jest.mock('@/service/base', () => ({
  postMarketplace: jest.fn(),
}))

jest.mock('@/service/apps', () => ({
  fetchAppList: jest.fn(),
}))

jest.mock('@/service/datasets', () => ({
  fetchDatasets: jest.fn(),
}))

const mockPostMarketplace = postMarketplace as jest.MockedFunction<typeof postMarketplace>
const mockFetchAppList = fetchAppList as jest.MockedFunction<typeof fetchAppList>
const mockFetchDatasets = fetchDatasets as jest.MockedFunction<typeof fetchDatasets>

describe('GotoAnything Search Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Suppress console.warn for clean test output
    jest.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress console.warn for clean test output
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('@plugin search error handling', () => {
    it('should return empty array when API fails instead of throwing error', async () => {
      // Mock marketplace API failure (403 permission denied)
      mockPostMarketplace.mockRejectedValue(new Error('HTTP 403: Forbidden'))

      const pluginAction = Actions.plugin

      // Directly call plugin action's search method
      const result = await pluginAction.search('@plugin', 'test', 'en')

      // Should return empty array instead of throwing error
      expect(result).toEqual([])
      expect(mockPostMarketplace).toHaveBeenCalledWith('/plugins/search/advanced', {
        body: {
          page: 1,
          page_size: 10,
          query: 'test',
          type: 'plugin',
        },
      })
    })

    it('should return empty array when user has no plugin data', async () => {
      // Mock marketplace returning empty data
      mockPostMarketplace.mockResolvedValue({
        data: { plugins: [] },
      })

      const pluginAction = Actions.plugin
      const result = await pluginAction.search('@plugin', '', 'en')

      expect(result).toEqual([])
    })

    it('should return empty array when API returns unexpected data structure', async () => {
      // Mock API returning unexpected data structure
      mockPostMarketplace.mockResolvedValue({
        data: null,
      })

      const pluginAction = Actions.plugin
      const result = await pluginAction.search('@plugin', 'test', 'en')

      expect(result).toEqual([])
    })
  })

  describe('Other search types error handling', () => {
    it('@app search should return empty array when API fails', async () => {
      // Mock app API failure
      mockFetchAppList.mockRejectedValue(new Error('API Error'))

      const appAction = Actions.app
      const result = await appAction.search('@app', 'test', 'en')

      expect(result).toEqual([])
    })

    it('@knowledge search should return empty array when API fails', async () => {
      // Mock knowledge API failure
      mockFetchDatasets.mockRejectedValue(new Error('API Error'))

      const knowledgeAction = Actions.knowledge
      const result = await knowledgeAction.search('@knowledge', 'test', 'en')

      expect(result).toEqual([])
    })
  })

  describe('Unified search entry error handling', () => {
    it('regular search (without @prefix) should return successful results even when partial APIs fail', async () => {
      // Set app and knowledge success, plugin failure
      mockFetchAppList.mockResolvedValue({ data: [], has_more: false, limit: 10, page: 1, total: 0 })
      mockFetchDatasets.mockResolvedValue({ data: [], has_more: false, limit: 10, page: 1, total: 0 })
      mockPostMarketplace.mockRejectedValue(new Error('Plugin API failed'))

      const result = await searchAnything('en', 'test')

      // Should return successful results even if plugin search fails
      expect(result).toEqual([])
      expect(console.warn).toHaveBeenCalledWith('Plugin search failed:', expect.any(Error))
    })

    it('@plugin dedicated search should return empty array when API fails', async () => {
      // Mock plugin API failure
      mockPostMarketplace.mockRejectedValue(new Error('Plugin service unavailable'))

      const pluginAction = Actions.plugin
      const result = await searchAnything('en', '@plugin test', pluginAction)

      // Should return empty array instead of throwing error
      expect(result).toEqual([])
    })

    it('@app dedicated search should return empty array when API fails', async () => {
      // Mock app API failure
      mockFetchAppList.mockRejectedValue(new Error('App service unavailable'))

      const appAction = Actions.app
      const result = await searchAnything('en', '@app test', appAction)

      expect(result).toEqual([])
    })
  })

  describe('Error handling consistency validation', () => {
    it('all search types should return empty array when encountering errors', async () => {
      // Mock all APIs to fail
      mockPostMarketplace.mockRejectedValue(new Error('Plugin API failed'))
      mockFetchAppList.mockRejectedValue(new Error('App API failed'))
      mockFetchDatasets.mockRejectedValue(new Error('Dataset API failed'))

      const actions = [
        { name: '@plugin', action: Actions.plugin },
        { name: '@app', action: Actions.app },
        { name: '@knowledge', action: Actions.knowledge },
      ]

      for (const { name, action } of actions) {
        const result = await action.search(name, 'test', 'en')
        expect(result).toEqual([])
      }
    })
  })

  describe('Edge case testing', () => {
    it('empty search term should be handled properly', async () => {
      mockPostMarketplace.mockResolvedValue({ data: { plugins: [] } })

      const result = await searchAnything('en', '@plugin ', Actions.plugin)
      expect(result).toEqual([])
    })

    it('network timeout should be handled correctly', async () => {
      const timeoutError = new Error('Network timeout')
      timeoutError.name = 'TimeoutError'

      mockPostMarketplace.mockRejectedValue(timeoutError)

      const result = await searchAnything('en', '@plugin test', Actions.plugin)
      expect(result).toEqual([])
    })

    it('JSON parsing errors should be handled correctly', async () => {
      const parseError = new SyntaxError('Unexpected token in JSON')
      mockPostMarketplace.mockRejectedValue(parseError)

      const result = await searchAnything('en', '@plugin test', Actions.plugin)
      expect(result).toEqual([])
    })
  })
})
