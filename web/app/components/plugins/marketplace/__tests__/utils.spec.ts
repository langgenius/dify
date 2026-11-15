import type { Plugin } from '@/app/components/plugins/types'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { PLUGIN_TYPE_SEARCH_MAP } from '../constants'

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      NEXT_PUBLIC_MARKETPLACE_API_PREFIX: 'https://marketplace.dify.ai/api/v1',
    },
  }
})

// Mock marketplace client
const mockCollectionPlugins = vi.fn()
const mockCollections = vi.fn()
const mockSearchAdvanced = vi.fn()

vi.mock('@/service/marketplace', () => ({
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

describe('plugin and bundle icons', () => {
  it.each([
    { type: 'plugin' as const, collection: 'plugins' },
    { type: 'bundle' as const, collection: 'bundles' },
  ])('builds $type icons and formats card data', async ({ type, collection }) => {
    const { getPluginIconInMarketplace, getFormattedPlugin } = await import('../utils')
    const plugin = { ...createMockPlugin({ type }), labels: { en_US: 'Bundle label' } }
    const icon = `https://marketplace.dify.ai/api/v1/${collection}/test-org/test-plugin/icon`
    expect(getPluginIconInMarketplace(plugin)).toBe(icon)
    expect(getFormattedPlugin(plugin)).toEqual({
      ...plugin,
      icon,
      ...(type === 'bundle' ? { brief: plugin.description, label: plugin.labels } : {}),
    })
  })
})

describe('catalog filters', () => {
  it.each([
    [PLUGIN_TYPE_SEARCH_MAP.tool, 'category=tool', 'plugin'],
    [PLUGIN_TYPE_SEARCH_MAP.model, 'category=model', 'plugin'],
    [PLUGIN_TYPE_SEARCH_MAP.agent, 'category=agent-strategy', 'plugin'],
    [PLUGIN_TYPE_SEARCH_MAP.datasource, 'category=datasource', 'plugin'],
    [PLUGIN_TYPE_SEARCH_MAP.trigger, 'category=trigger', 'plugin'],
    [PLUGIN_TYPE_SEARCH_MAP.extension, 'category=endpoint', 'plugin'],
    [PLUGIN_TYPE_SEARCH_MAP.bundle, 'type=bundle', 'bundle'],
    [PLUGIN_TYPE_SEARCH_MAP.all, '', undefined],
  ] as const)('maps %s into collection request filters', async (category, condition, type) => {
    const { getMarketplaceListCondition, getMarketplaceListFilterType, getCollectionsParams } =
      await import('../utils')
    expect(getMarketplaceListCondition(category)).toBe(condition)
    expect(getMarketplaceListFilterType(category)).toBe(type)
    expect(getCollectionsParams(category)).toEqual(
      category === 'all' ? {} : { category, condition, type },
    )
  })
})

describe('getMarketplacePluginsByCollectionId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards collection filters and cancellation and returns formatted cards', async () => {
    const plugin = createMockPlugin()
    mockCollectionPlugins.mockResolvedValueOnce({ data: { plugins: [plugin] } })
    const controller = new AbortController()
    const filters = { category: 'tool', exclude: ['excluded-plugin'], type: 'plugin' as const }
    const { getMarketplacePluginsByCollectionId } = await import('../utils')
    const result = await getMarketplacePluginsByCollectionId('test-collection', filters, {
      signal: controller.signal,
    })
    expect(mockCollectionPlugins).toHaveBeenCalledExactlyOnceWith(
      { params: { collectionId: 'test-collection' }, body: filters },
      { signal: controller.signal },
    )
    expect(result).toEqual([
      {
        ...plugin,
        icon: 'https://marketplace.dify.ai/api/v1/plugins/test-org/test-plugin/icon',
        introduction: '',
        endpoint: { settings: [] },
      },
    ])
  })

  it('should propagate fetch errors', async () => {
    mockCollectionPlugins.mockRejectedValueOnce(new Error('Network error'))

    const { getMarketplacePluginsByCollectionId } = await import('../utils')

    await expect(getMarketplacePluginsByCollectionId('test-collection')).rejects.toThrow(
      'Network error',
    )
  })

  it('should omit a preview limit when query is omitted', async () => {
    mockCollectionPlugins.mockResolvedValueOnce({
      data: { plugins: [] },
    })

    const { getMarketplacePluginsByCollectionId } = await import('../utils')
    await getMarketplacePluginsByCollectionId('test-collection')

    expect(mockCollectionPlugins).toHaveBeenCalledWith(
      {
        params: {
          collectionId: 'test-collection',
        },
        body: {},
      },
      expect.objectContaining({
        signal: undefined,
      }),
    )
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

    expect(result.marketplaceCollections).toEqual(mockCollectionData)
    expect(result.marketplaceCollectionPluginsMap).toEqual({
      collection1: [
        expect.objectContaining({
          org: 'test',
          name: 'plugin1',
          icon: 'https://marketplace.dify.ai/api/v1/plugins/test/plugin1/icon',
        }),
      ],
    })
    expect(mockCollections).toHaveBeenCalledWith(
      { query: { condition: 'category=tool', type: 'plugin', page: 1, page_size: 100 } },
      { signal: undefined },
    )
    expect(mockCollectionPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { collectionId: 'collection1' },
        body: {
          condition: 'category=tool',
          type: 'plugin',
        },
      }),
      expect.any(Object),
    )
  })

  it('posts without a preview limit when the catalog has no extra filters', async () => {
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

    const { getMarketplaceCollectionsAndPlugins } = await import('../utils')
    await getMarketplaceCollectionsAndPlugins()

    expect(mockCollectionPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { collectionId: 'featured' },
        body: {},
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

    expect(listed).toEqual({ ...createMockPlugin(), introduction: '', endpoint: { settings: [] } })
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

  it('forwards filters, pagination and cancellation to plugin search', async () => {
    const plugin = createMockPlugin()
    mockSearchAdvanced.mockResolvedValueOnce({ data: { plugins: [plugin], total: 45 } })
    const controller = new AbortController()
    const body = {
      query: 'test',
      sort_by: 'install_count' as const,
      sort_order: 'DESC' as const,
      category: 'tool',
      tags: ['search'],
      page_size: 20,
      page: 2,
    }
    const { getMarketplacePlugins } = await import('../utils')
    const result = await getMarketplacePlugins({ ...body, type: 'plugin' }, 2, controller.signal)
    expect(mockSearchAdvanced).toHaveBeenCalledExactlyOnceWith(
      { params: { kind: 'plugins' }, body },
      { signal: controller.signal },
    )
    expect(result).toEqual({
      plugins: [
        { ...plugin, icon: 'https://marketplace.dify.ai/api/v1/plugins/test-org/test-plugin/icon' },
      ],
      total: 45,
      page: 2,
      page_size: 20,
    })
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
    const result = await getMarketplacePlugins(
      {
        query: 'test',
        category: 'all',
      },
      1,
    )

    const call = mockSearchAdvanced.mock.calls[0]
    expect(call![0].body).toMatchObject({ category: '', page: 1, page_size: 40 })
    expect(result).toEqual({ plugins: [], total: 0, page: 1, page_size: 40 })
  })

  it('should propagate API errors instead of synthesizing an empty page', async () => {
    mockSearchAdvanced.mockRejectedValueOnce(new Error('API error'))

    const { getMarketplacePlugins } = await import('../utils')

    // A synthesized `{ plugins: [], total: 0 }` resolved as a *success*: no
    // isError, no retry, a cached empty result, and getNextPageParam saw
    // total 0 and killed pagination for that key permanently.
    await expect(getMarketplacePlugins({ query: 'fail' }, 2)).rejects.toThrow('API error')
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

describe('missing collection data', () => {
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
