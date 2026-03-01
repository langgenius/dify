import type { Plugin } from '@/app/components/plugins/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { PLUGIN_TYPE_SEARCH_MAP } from '../constants'

// Mock config
vi.mock('@/config', () => ({
  API_PREFIX: '/api',
  APP_VERSION: '1.0.0',
  IS_MARKETPLACE: false,
  MARKETPLACE_API_PREFIX: 'https://marketplace.dify.ai/api/v1',
}))

// Mock var utils
vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (path: string) => `https://marketplace.dify.ai${path}`,
}))

// Mock marketplace client
const mockCollectionPlugins = vi.fn()
const mockCollections = vi.fn()
const mockSearchAdvanced = vi.fn()

vi.mock('@/service/client', () => ({
  marketplaceClient: {
    collections: (...args: unknown[]) => mockCollections(...args),
    collectionPlugins: (...args: unknown[]) => mockCollectionPlugins(...args),
    searchAdvanced: (...args: unknown[]) => mockSearchAdvanced(...args),
  },
}))

// Factory for creating mock plugins
const createMockPlugin = (overrides?: Partial<Plugin>): Plugin => ({
  type: 'plugin',
  org: 'test-org',
  name: 'test-plugin',
  plugin_id: 'plugin-1',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'test-org/test-plugin:1.0.0',
  icon: '/icon.png',
  verified: true,
  label: { 'en-US': 'Test Plugin' },
  brief: { 'en-US': 'Test plugin brief' },
  description: { 'en-US': 'Test plugin description' },
  introduction: 'Test plugin introduction',
  repository: 'https://github.com/test/plugin',
  category: PluginCategoryEnum.tool,
  install_count: 1000,
  endpoint: { settings: [] },
  tags: [{ name: 'search' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

describe('getPluginIconInMarketplace', () => {
  it('should return correct icon URL for regular plugin', async () => {
    const { getPluginIconInMarketplace } = await import('../utils')
    const plugin = createMockPlugin({ org: 'test-org', name: 'test-plugin', type: 'plugin' })
    const iconUrl = getPluginIconInMarketplace(plugin)
    expect(iconUrl).toBe('https://marketplace.dify.ai/api/v1/plugins/test-org/test-plugin/icon')
  })

  it('should return correct icon URL for bundle', async () => {
    const { getPluginIconInMarketplace } = await import('../utils')
    const bundle = createMockPlugin({ org: 'test-org', name: 'test-bundle', type: 'bundle' })
    const iconUrl = getPluginIconInMarketplace(bundle)
    expect(iconUrl).toBe('https://marketplace.dify.ai/api/v1/bundles/test-org/test-bundle/icon')
  })
})

describe('getFormattedPlugin', () => {
  it('should format plugin with icon URL', async () => {
    const { getFormattedPlugin } = await import('../utils')
    const rawPlugin = {
      type: 'plugin',
      org: 'test-org',
      name: 'test-plugin',
      tags: [{ name: 'search' }],
    } as unknown as Plugin

    const formatted = getFormattedPlugin(rawPlugin)
    expect(formatted.icon).toBe('https://marketplace.dify.ai/api/v1/plugins/test-org/test-plugin/icon')
  })

  it('should format bundle with additional properties', async () => {
    const { getFormattedPlugin } = await import('../utils')
    const rawBundle = {
      type: 'bundle',
      org: 'test-org',
      name: 'test-bundle',
      description: 'Bundle description',
      labels: { 'en-US': 'Test Bundle' },
    } as unknown as Plugin

    const formatted = getFormattedPlugin(rawBundle)
    expect(formatted.icon).toBe('https://marketplace.dify.ai/api/v1/bundles/test-org/test-bundle/icon')
    expect(formatted.brief).toBe('Bundle description')
    expect(formatted.label).toEqual({ 'en-US': 'Test Bundle' })
  })
})

describe('getPluginLinkInMarketplace', () => {
  it('should return correct link for regular plugin', async () => {
    const { getPluginLinkInMarketplace } = await import('../utils')
    const plugin = createMockPlugin({ org: 'test-org', name: 'test-plugin', type: 'plugin' })
    const link = getPluginLinkInMarketplace(plugin)
    expect(link).toBe('https://marketplace.dify.ai/plugins/test-org/test-plugin')
  })

  it('should return correct link for bundle', async () => {
    const { getPluginLinkInMarketplace } = await import('../utils')
    const bundle = createMockPlugin({ org: 'test-org', name: 'test-bundle', type: 'bundle' })
    const link = getPluginLinkInMarketplace(bundle)
    expect(link).toBe('https://marketplace.dify.ai/bundles/test-org/test-bundle')
  })
})

describe('getPluginDetailLinkInMarketplace', () => {
  it('should return correct detail link for regular plugin', async () => {
    const { getPluginDetailLinkInMarketplace } = await import('../utils')
    const plugin = createMockPlugin({ org: 'test-org', name: 'test-plugin', type: 'plugin' })
    const link = getPluginDetailLinkInMarketplace(plugin)
    expect(link).toBe('/plugins/test-org/test-plugin')
  })

  it('should return correct detail link for bundle', async () => {
    const { getPluginDetailLinkInMarketplace } = await import('../utils')
    const bundle = createMockPlugin({ org: 'test-org', name: 'test-bundle', type: 'bundle' })
    const link = getPluginDetailLinkInMarketplace(bundle)
    expect(link).toBe('/bundles/test-org/test-bundle')
  })
})

describe('getMarketplaceListCondition', () => {
  it('should return category condition for tool', async () => {
    const { getMarketplaceListCondition } = await import('../utils')
    expect(getMarketplaceListCondition(PluginCategoryEnum.tool)).toBe('category=tool')
  })

  it('should return category condition for model', async () => {
    const { getMarketplaceListCondition } = await import('../utils')
    expect(getMarketplaceListCondition(PluginCategoryEnum.model)).toBe('category=model')
  })

  it('should return category condition for agent', async () => {
    const { getMarketplaceListCondition } = await import('../utils')
    expect(getMarketplaceListCondition(PluginCategoryEnum.agent)).toBe('category=agent-strategy')
  })

  it('should return category condition for datasource', async () => {
    const { getMarketplaceListCondition } = await import('../utils')
    expect(getMarketplaceListCondition(PluginCategoryEnum.datasource)).toBe('category=datasource')
  })

  it('should return category condition for trigger', async () => {
    const { getMarketplaceListCondition } = await import('../utils')
    expect(getMarketplaceListCondition(PluginCategoryEnum.trigger)).toBe('category=trigger')
  })

  it('should return endpoint category for extension', async () => {
    const { getMarketplaceListCondition } = await import('../utils')
    expect(getMarketplaceListCondition(PluginCategoryEnum.extension)).toBe('category=endpoint')
  })

  it('should return type condition for bundle', async () => {
    const { getMarketplaceListCondition } = await import('../utils')
    expect(getMarketplaceListCondition('bundle')).toBe('type=bundle')
  })

  it('should return empty string for all', async () => {
    const { getMarketplaceListCondition } = await import('../utils')
    expect(getMarketplaceListCondition('all')).toBe('')
  })

  it('should return empty string for unknown type', async () => {
    const { getMarketplaceListCondition } = await import('../utils')
    expect(getMarketplaceListCondition('unknown')).toBe('')
  })
})

describe('getMarketplaceListFilterType', () => {
  it('should return undefined for all', async () => {
    const { getMarketplaceListFilterType } = await import('../utils')
    expect(getMarketplaceListFilterType(PLUGIN_TYPE_SEARCH_MAP.all)).toBeUndefined()
  })

  it('should return bundle for bundle', async () => {
    const { getMarketplaceListFilterType } = await import('../utils')
    expect(getMarketplaceListFilterType(PLUGIN_TYPE_SEARCH_MAP.bundle)).toBe('bundle')
  })

  it('should return plugin for other categories', async () => {
    const { getMarketplaceListFilterType } = await import('../utils')
    expect(getMarketplaceListFilterType(PLUGIN_TYPE_SEARCH_MAP.tool)).toBe('plugin')
    expect(getMarketplaceListFilterType(PLUGIN_TYPE_SEARCH_MAP.model)).toBe('plugin')
    expect(getMarketplaceListFilterType(PLUGIN_TYPE_SEARCH_MAP.agent)).toBe('plugin')
  })
})

describe('getMarketplacePluginsByCollectionId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch plugins by collection id successfully', async () => {
    const mockPlugins = [
      { type: 'plugin', org: 'test', name: 'plugin1', tags: [] },
      { type: 'plugin', org: 'test', name: 'plugin2', tags: [] },
    ]
    mockCollectionPlugins.mockResolvedValueOnce({
      data: { plugins: mockPlugins },
    })

    const { getMarketplacePluginsByCollectionId } = await import('../utils')
    const result = await getMarketplacePluginsByCollectionId('test-collection', {
      category: 'tool',
      exclude: ['excluded-plugin'],
      type: 'plugin',
    })

    expect(mockCollectionPlugins).toHaveBeenCalled()
    expect(result).toHaveLength(2)
  })

  it('should handle fetch error and return empty array', async () => {
    mockCollectionPlugins.mockRejectedValueOnce(new Error('Network error'))

    const { getMarketplacePluginsByCollectionId } = await import('../utils')
    const result = await getMarketplacePluginsByCollectionId('test-collection')

    expect(result).toEqual([])
  })

  it('should pass abort signal when provided', async () => {
    const mockPlugins = [{ type: 'plugin', org: 'test', name: 'plugin1' }]
    mockCollectionPlugins.mockResolvedValueOnce({
      data: { plugins: mockPlugins },
    })

    const controller = new AbortController()
    const { getMarketplacePluginsByCollectionId } = await import('../utils')
    await getMarketplacePluginsByCollectionId('test-collection', {}, { signal: controller.signal })

    expect(mockCollectionPlugins).toHaveBeenCalled()
    const call = mockCollectionPlugins.mock.calls[0]
    expect(call[1]).toMatchObject({ signal: controller.signal })
  })
})

describe('getMarketplaceCollectionsAndPlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch collections and plugins successfully', async () => {
    const mockCollectionData = [
      { name: 'collection1', label: {}, description: {}, rule: '', created_at: '', updated_at: '' },
    ]
    const mockPluginData = [{ type: 'plugin', org: 'test', name: 'plugin1' }]

    mockCollections.mockResolvedValueOnce({ data: { collections: mockCollectionData } })
    mockCollectionPlugins.mockResolvedValue({ data: { plugins: mockPluginData } })

    const { getMarketplaceCollectionsAndPlugins } = await import('../utils')
    const result = await getMarketplaceCollectionsAndPlugins({
      condition: 'category=tool',
      type: 'plugin',
    })

    expect(result.marketplaceCollections).toBeDefined()
    expect(result.marketplaceCollectionPluginsMap).toBeDefined()
  })

  it('should handle fetch error and return empty data', async () => {
    mockCollections.mockRejectedValueOnce(new Error('Network error'))

    const { getMarketplaceCollectionsAndPlugins } = await import('../utils')
    const result = await getMarketplaceCollectionsAndPlugins()

    expect(result.marketplaceCollections).toEqual([])
    expect(result.marketplaceCollectionPluginsMap).toEqual({})
  })

  it('should append condition and type to URL when provided', async () => {
    mockCollections.mockResolvedValueOnce({ data: { collections: [] } })

    const { getMarketplaceCollectionsAndPlugins } = await import('../utils')
    await getMarketplaceCollectionsAndPlugins({
      condition: 'category=tool',
      type: 'bundle',
    })

    expect(mockCollections).toHaveBeenCalled()
    const call = mockCollections.mock.calls[0]
    expect(call[0]).toMatchObject({ query: expect.objectContaining({ condition: 'category=tool', type: 'bundle' }) })
  })
})

describe('getCollectionsParams', () => {
  it('should return empty object for all category', async () => {
    const { getCollectionsParams } = await import('../utils')
    expect(getCollectionsParams(PLUGIN_TYPE_SEARCH_MAP.all)).toEqual({})
  })

  it('should return category, condition, and type for tool category', async () => {
    const { getCollectionsParams } = await import('../utils')
    const result = getCollectionsParams(PLUGIN_TYPE_SEARCH_MAP.tool)
    expect(result).toEqual({
      category: PluginCategoryEnum.tool,
      condition: 'category=tool',
      type: 'plugin',
    })
  })
})

describe('getMarketplacePlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty result when queryParams is undefined', async () => {
    const { getMarketplacePlugins } = await import('../utils')
    const result = await getMarketplacePlugins(undefined, 1)

    expect(result).toEqual({
      plugins: [],
      total: 0,
      page: 1,
      page_size: 40,
    })
    expect(mockSearchAdvanced).not.toHaveBeenCalled()
  })

  it('should fetch plugins with valid query params', async () => {
    mockSearchAdvanced.mockResolvedValueOnce({
      data: {
        plugins: [{ type: 'plugin', org: 'test', name: 'p1', tags: [] }],
        total: 1,
      },
    })

    const { getMarketplacePlugins } = await import('../utils')
    const result = await getMarketplacePlugins({
      query: 'test',
      sort_by: 'install_count',
      sort_order: 'DESC',
      category: 'tool',
      tags: ['search'],
      type: 'plugin',
      page_size: 20,
    }, 1)

    expect(result.plugins).toHaveLength(1)
    expect(result.total).toBe(1)
    expect(result.page).toBe(1)
    expect(result.page_size).toBe(20)
  })

  it('should use bundles endpoint when type is bundle', async () => {
    mockSearchAdvanced.mockResolvedValueOnce({
      data: {
        bundles: [{ type: 'bundle', org: 'test', name: 'b1', tags: [], description: 'desc', labels: {} }],
        total: 1,
      },
    })

    const { getMarketplacePlugins } = await import('../utils')
    const result = await getMarketplacePlugins({
      query: 'bundle',
      type: 'bundle',
    }, 1)

    expect(result.plugins).toHaveLength(1)
    const call = mockSearchAdvanced.mock.calls[0]
    expect(call[0].params.kind).toBe('bundles')
  })

  it('should use empty category when category is all', async () => {
    mockSearchAdvanced.mockResolvedValueOnce({
      data: { plugins: [], total: 0 },
    })

    const { getMarketplacePlugins } = await import('../utils')
    await getMarketplacePlugins({
      query: 'test',
      category: 'all',
    }, 1)

    const call = mockSearchAdvanced.mock.calls[0]
    expect(call[0].body.category).toBe('')
  })

  it('should handle API error and return empty result', async () => {
    mockSearchAdvanced.mockRejectedValueOnce(new Error('API error'))

    const { getMarketplacePlugins } = await import('../utils')
    const result = await getMarketplacePlugins({
      query: 'fail',
    }, 2)

    expect(result).toEqual({
      plugins: [],
      total: 0,
      page: 2,
      page_size: 40,
    })
  })

  it('should pass abort signal when provided', async () => {
    mockSearchAdvanced.mockResolvedValueOnce({
      data: { plugins: [], total: 0 },
    })

    const controller = new AbortController()
    const { getMarketplacePlugins } = await import('../utils')
    await getMarketplacePlugins({ query: 'test' }, 1, controller.signal)

    const call = mockSearchAdvanced.mock.calls[0]
    expect(call[1]).toMatchObject({ signal: controller.signal })
  })

  it('should default page_size to 40 when not provided', async () => {
    mockSearchAdvanced.mockResolvedValueOnce({
      data: { plugins: [], total: 0 },
    })

    const { getMarketplacePlugins } = await import('../utils')
    const result = await getMarketplacePlugins({ query: 'test' }, 1)

    expect(result.page_size).toBe(40)
  })

  it('should handle response with bundles fallback to plugins fallback to empty', async () => {
    // No bundles and no plugins in response
    mockSearchAdvanced.mockResolvedValueOnce({
      data: { total: 0 },
    })

    const { getMarketplacePlugins } = await import('../utils')
    const result = await getMarketplacePlugins({ query: 'test' }, 1)

    expect(result.plugins).toEqual([])
  })
})

// ================================
// Edge cases for ||/optional chaining branches
// ================================
describe('Utils branch edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should handle collectionPlugins returning undefined plugins', async () => {
    mockCollectionPlugins.mockResolvedValueOnce({
      data: { plugins: undefined },
    })

    const { getMarketplacePluginsByCollectionId } = await import('../utils')
    const result = await getMarketplacePluginsByCollectionId('test-collection')

    expect(result).toEqual([])
  })

  it('should handle collections returning undefined collections list', async () => {
    mockCollections.mockResolvedValueOnce({
      data: { collections: undefined },
    })

    const { getMarketplaceCollectionsAndPlugins } = await import('../utils')
    const result = await getMarketplaceCollectionsAndPlugins()

    // undefined || [] evaluates to [], so empty array is expected
    expect(result.marketplaceCollections).toEqual([])
  })
})
