import type { Plugin } from '@/app/components/plugins/types'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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
    expect(formatted.icon).toBe(
      'https://marketplace.dify.ai/api/v1/plugins/test-org/test-plugin/icon',
    )
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
    expect(formatted.icon).toBe(
      'https://marketplace.dify.ai/api/v1/bundles/test-org/test-bundle/icon',
    )
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
  it('should return the local detail link for a regular plugin', async () => {
    const { getPluginDetailLinkInMarketplace } = await import('../utils')
    const plugin = createMockPlugin({ org: 'test-org', name: 'test-plugin', type: 'plugin' })

    expect(getPluginDetailLinkInMarketplace(plugin)).toBe('/plugin/test-org/test-plugin')
  })

  it('should return the local detail link for a bundle', async () => {
    const { getPluginDetailLinkInMarketplace } = await import('../utils')
    const bundle = createMockPlugin({ org: 'test-org', name: 'test-bundle', type: 'bundle' })

    expect(getPluginDetailLinkInMarketplace(bundle)).toBe('/bundles/test-org/test-bundle')
  })
})

describe('getTemplateDetailLinkInMarketplace', () => {
  it('should return the local template detail link', async () => {
    const { getTemplateDetailLinkInMarketplace } = await import('../utils')

    expect(
      getTemplateDetailLinkInMarketplace({
        id: 'template-1',
        template_name: 'Legal Research Agent',
        publisher_handle: 'dify',
        publisher_unique_handle: 'dify-unique',
      }),
    ).toBe('/template/dify/Legal%20Research%20Agent?templateId=template-1')
  })

  it('should fall back to the unique publisher handle', async () => {
    const { getTemplateDetailLinkInMarketplace } = await import('../utils')

    expect(
      getTemplateDetailLinkInMarketplace({
        id: 'template-2',
        template_name: 'Inbox',
        publisher_handle: '',
        publisher_unique_handle: 'langgenius',
      }),
    ).toBe('/template/langgenius/Inbox?templateId=template-2')
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

  it('should propagate fetch errors', async () => {
    mockCollectionPlugins.mockRejectedValueOnce(new Error('Network error'))

    const { getMarketplacePluginsByCollectionId } = await import('../utils')

    await expect(getMarketplacePluginsByCollectionId('test-collection')).rejects.toThrow(
      'Network error',
    )
  })

  it('should send the warmed preview limit when query is omitted', async () => {
    mockCollectionPlugins.mockResolvedValueOnce({
      data: { plugins: [] },
    })

    const { COLLECTION_PREVIEW_PLUGIN_LIMIT, getMarketplacePluginsByCollectionId } =
      await import('../utils')
    await getMarketplacePluginsByCollectionId('test-collection')

    expect(mockCollectionPlugins).toHaveBeenCalledWith(
      {
        params: {
          collectionId: 'test-collection',
        },
        body: { limit: COLLECTION_PREVIEW_PLUGIN_LIMIT },
      },
      expect.objectContaining({
        signal: undefined,
      }),
    )
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
    expect(call![1]).toMatchObject({ signal: controller.signal })
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

    const { COLLECTION_PREVIEW_PLUGIN_LIMIT, getMarketplaceCollectionsAndPlugins } =
      await import('../utils')
    const result = await getMarketplaceCollectionsAndPlugins({
      condition: 'category=tool',
      type: 'plugin',
    })

    expect(result.marketplaceCollections).toBeDefined()
    expect(result.marketplaceCollectionPluginsMap).toBeDefined()
    expect(mockCollectionPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { collectionId: 'collection1' },
        body: {
          condition: 'category=tool',
          type: 'plugin',
          limit: COLLECTION_PREVIEW_PLUGIN_LIMIT,
        },
      }),
      expect.any(Object),
    )
  })

  it('posts the warmed preview limit when the catalog has no extra filters', async () => {
    mockCollections.mockResolvedValueOnce({
      data: {
        collections: [
          {
            name: 'featured',
            label: {},
            description: {},
            rule: '',
            created_at: '',
            updated_at: '',
          },
        ],
      },
    })
    mockCollectionPlugins.mockResolvedValue({ data: { plugins: [] } })

    const { COLLECTION_PREVIEW_PLUGIN_LIMIT, getMarketplaceCollectionsAndPlugins } =
      await import('../utils')
    await getMarketplaceCollectionsAndPlugins()

    expect(mockCollectionPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { collectionId: 'featured' },
        body: { limit: COLLECTION_PREVIEW_PLUGIN_LIMIT },
      }),
      expect.any(Object),
    )
  })

  it('should propagate a failing collections request', async () => {
    mockCollections.mockRejectedValueOnce(new Error('Network error'))

    const { getMarketplaceCollectionsAndPlugins } = await import('../utils')

    // Resolving an empty catalog here made a backend outage indistinguishable
    // from "no collections", cached as a success for the whole staleTime.
    await expect(getMarketplaceCollectionsAndPlugins()).rejects.toThrow('Network error')
  })

  it('should keep the catalog when a single collection fails', async () => {
    mockCollections.mockResolvedValueOnce({
      data: {
        collections: [
          { name: 'ok', label: {}, description: {}, rule: '', created_at: '', updated_at: '' },
          { name: 'broken', label: {}, description: {}, rule: '', created_at: '', updated_at: '' },
        ],
      },
    })
    mockCollectionPlugins
      .mockResolvedValueOnce({ data: { plugins: [{ type: 'plugin', org: 'a', name: 'b' }] } })
      .mockRejectedValueOnce(new Error('collection down'))

    const { getMarketplaceCollectionsAndPlugins } = await import('../utils')
    const result = await getMarketplaceCollectionsAndPlugins()

    expect(result.marketplaceCollections).toHaveLength(2)
    expect(result.marketplaceCollectionPluginsMap.ok).toHaveLength(1)
    expect(result.marketplaceCollectionPluginsMap.broken).toEqual([])
  })

  it('propagates cancellation instead of resolving empty carousels', async () => {
    const controller = new AbortController()
    mockCollections.mockResolvedValueOnce({
      data: {
        collections: [
          { name: 'ok', label: {}, description: {}, rule: '', created_at: '', updated_at: '' },
          { name: 'slow', label: {}, description: {}, rule: '', created_at: '', updated_at: '' },
        ],
      },
    })
    mockCollectionPlugins
      .mockResolvedValueOnce({ data: { plugins: [{ type: 'plugin', org: 'a', name: 'b' }] } })
      .mockImplementationOnce(async () => {
        controller.abort()
        const error = new Error('Aborted')
        error.name = 'AbortError'
        throw error
      })

    const { getMarketplaceCollectionsAndPlugins } = await import('../utils')

    await expect(
      getMarketplaceCollectionsAndPlugins({}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
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
    expect(call![0]).toMatchObject({
      query: expect.objectContaining({ condition: 'category=tool', type: 'bundle' }),
    })
  })
})

describe('getCollectionsParams', () => {
  it('should return the warmed preview limit for all category', async () => {
    const { COLLECTION_PREVIEW_PLUGIN_LIMIT, getCollectionsParams } = await import('../utils')
    expect(getCollectionsParams(PLUGIN_TYPE_SEARCH_MAP.all)).toEqual({
      limit: COLLECTION_PREVIEW_PLUGIN_LIMIT,
    })
    expect(COLLECTION_PREVIEW_PLUGIN_LIMIT).toBe(20)
  })

  it('should return category, condition, type, and preview limit for tool category', async () => {
    const { COLLECTION_PREVIEW_PLUGIN_LIMIT, getCollectionsParams } = await import('../utils')
    const result = getCollectionsParams(PLUGIN_TYPE_SEARCH_MAP.tool)
    expect(result).toEqual({
      category: PluginCategoryEnum.tool,
      condition: 'category=tool',
      type: 'plugin',
      limit: COLLECTION_PREVIEW_PLUGIN_LIMIT,
    })
  })
})

describe('toListPlugin', () => {
  it('keeps card fields and drops list-unused payload', async () => {
    const { toListPlugin } = await import('../utils')
    const plugin = {
      ...createMockPlugin({
        introduction: 'A very long readme that must not enter the catalog RSC payload',
      }),
      resource: { memory: 256 },
      plugins: { tools: ['x'] },
      tool: { identity: { name: 'search' } },
      model: { provider: 'openai' },
      agent_strategy: { features: ['a'] },
      data_sources: { items: [] },
      triggers: { events: [] },
      privacy_policy: 'https://example.com/privacy',
      privacy_options: 'all',
      readme_meta: { available_languages: ['en_US'] },
      endpoint: { settings: [{ name: 'api_key' }] },
    } as unknown as Plugin

    const listed = toListPlugin(plugin)

    expect(listed.org).toBe('test-org')
    expect(listed.name).toBe('test-plugin')
    expect(listed.plugin_id).toBe('plugin-1')
    expect(listed.label).toEqual({ 'en-US': 'Test Plugin' })
    expect(listed.brief).toEqual({ 'en-US': 'Test plugin brief' })
    expect(listed.badges).toEqual([])
    expect(listed.verification).toEqual({ authorized_category: 'community' })
    expect(listed.install_count).toBe(1000)
    expect(listed.category).toBe(PluginCategoryEnum.tool)
    expect(listed.tags).toEqual([{ name: 'search' }])
    expect(listed.type).toBe('plugin')
    expect(listed.introduction).toBe('')
    expect(listed.endpoint).toEqual({ settings: [] })
    expect(listed).not.toHaveProperty('resource')
    expect(listed).not.toHaveProperty('plugins')
    expect(listed).not.toHaveProperty('tool')
    expect(listed).not.toHaveProperty('model')
    expect(listed).not.toHaveProperty('agent_strategy')
    expect(listed).not.toHaveProperty('data_sources')
    expect(listed).not.toHaveProperty('triggers')
    expect(listed).not.toHaveProperty('privacy_policy')
    expect(listed).not.toHaveProperty('privacy_options')
    expect(listed).not.toHaveProperty('readme_meta')
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
    const result = await getMarketplacePlugins(
      {
        query: 'test',
        sort_by: 'install_count',
        sort_order: 'DESC',
        category: 'tool',
        tags: ['search'],
        type: 'plugin',
        page_size: 20,
      },
      1,
    )

    expect(result.plugins).toHaveLength(1)
    expect(result.total).toBe(1)
    expect(result.page).toBe(1)
    expect(result.page_size).toBe(20)
  })

  it('should use bundles endpoint when type is bundle', async () => {
    mockSearchAdvanced.mockResolvedValueOnce({
      data: {
        bundles: [
          { type: 'bundle', org: 'test', name: 'b1', tags: [], description: 'desc', labels: {} },
        ],
        total: 1,
      },
    })

    const { getMarketplacePlugins } = await import('../utils')
    const result = await getMarketplacePlugins(
      {
        query: 'bundle',
        type: 'bundle',
      },
      1,
    )

    expect(result.plugins).toHaveLength(1)
    const call = mockSearchAdvanced.mock.calls[0]
    expect(call![0].params.kind).toBe('bundles')
  })

  it('should use empty category when category is all', async () => {
    mockSearchAdvanced.mockResolvedValueOnce({
      data: { plugins: [], total: 0 },
    })

    const { getMarketplacePlugins } = await import('../utils')
    await getMarketplacePlugins(
      {
        query: 'test',
        category: 'all',
      },
      1,
    )

    const call = mockSearchAdvanced.mock.calls[0]
    expect(call![0].body.category).toBe('')
  })

  it('should propagate API errors instead of synthesizing an empty page', async () => {
    mockSearchAdvanced.mockRejectedValueOnce(new Error('API error'))

    const { getMarketplacePlugins } = await import('../utils')

    // A synthesized `{ plugins: [], total: 0 }` resolved as a *success*: no
    // isError, no retry, a cached empty result, and getNextPageParam saw
    // total 0 and killed pagination for that key permanently.
    await expect(getMarketplacePlugins({ query: 'fail' }, 2)).rejects.toThrow('API error')
  })

  it('should pass abort signal when provided', async () => {
    mockSearchAdvanced.mockResolvedValueOnce({
      data: { plugins: [], total: 0 },
    })

    const controller = new AbortController()
    const { getMarketplacePlugins } = await import('../utils')
    await getMarketplacePlugins({ query: 'test' }, 1, controller.signal)

    const call = mockSearchAdvanced.mock.calls[0]
    expect(call![1]).toMatchObject({ signal: controller.signal })
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
