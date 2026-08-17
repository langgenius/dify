import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  templateCollections: vi.fn(),
  templateCollectionTemplates: vi.fn(),
  templateSearch: vi.fn(),
}))

vi.mock('./client', () => ({
  marketplaceClient: {
    templateCollections: (...args: unknown[]) => mocks.templateCollections(...args),
    templateCollectionTemplates: (...args: unknown[]) => mocks.templateCollectionTemplates(...args),
    templateSearch: (...args: unknown[]) => mocks.templateSearch(...args),
  },
}))

// The collections helper keeps a module-level cache, so import a fresh copy
// per test to keep them isolated.
const importDiscovery = async () => {
  vi.resetModules()
  return import('./marketplace-template-discovery')
}

describe('marketplace template discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads each template collection and isolates a failed collection', async () => {
    const { getMarketplaceTemplateCollectionsAndTemplates } = await importDiscovery()
    mocks.templateCollections.mockResolvedValue({
      data: {
        collections: [
          { name: 'featured', label: {}, description: {}, priority: 1 },
          { name: 'partners', label: {}, description: {}, priority: 2 },
        ],
      },
    })
    mocks.templateCollectionTemplates
      .mockResolvedValueOnce({ data: { templates: [{ id: 'template-1' }] } })
      .mockRejectedValueOnce(new Error('Unavailable'))

    const result = await getMarketplaceTemplateCollectionsAndTemplates()

    expect(mocks.templateCollections).toHaveBeenCalledWith({
      query: { page: 1, page_size: 100 },
    })
    expect(mocks.templateCollectionTemplates).toHaveBeenNthCalledWith(1, {
      params: { collectionName: 'featured' },
      body: { limit: 24 },
    })
    expect(result.templatesByCollection).toEqual({
      featured: [{ id: 'template-1' }],
      partners: [],
    })
  })

  it('serves collections from the cache instead of refetching every render', async () => {
    const { getMarketplaceTemplateCollectionsAndTemplates } = await importDiscovery()
    mocks.templateCollections.mockResolvedValue({
      data: {
        collections: [{ name: 'featured', label: {}, description: {}, priority: 1 }],
      },
    })
    mocks.templateCollectionTemplates.mockResolvedValue({
      data: { templates: [{ id: 'template-1' }] },
    })

    const [first, second] = await Promise.all([
      getMarketplaceTemplateCollectionsAndTemplates(),
      getMarketplaceTemplateCollectionsAndTemplates(),
    ])
    const third = await getMarketplaceTemplateCollectionsAndTemplates()

    expect(mocks.templateCollections).toHaveBeenCalledOnce()
    expect(mocks.templateCollectionTemplates).toHaveBeenCalledOnce()
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it('does not cache a failed collections fetch', async () => {
    const { getMarketplaceTemplateCollectionsAndTemplates } = await importDiscovery()
    mocks.templateCollections.mockRejectedValueOnce(new Error('Unavailable'))

    const failed = await getMarketplaceTemplateCollectionsAndTemplates()
    expect(failed).toEqual({ collections: [], templatesByCollection: {}, ok: false })

    mocks.templateCollections.mockResolvedValue({
      data: {
        collections: [{ name: 'featured', label: {}, description: {}, priority: 1 }],
      },
    })
    mocks.templateCollectionTemplates.mockResolvedValue({
      data: { templates: [{ id: 'template-1' }] },
    })

    const recovered = await getMarketplaceTemplateCollectionsAndTemplates()
    expect(recovered.ok).toBe(true)
    expect(recovered.templatesByCollection).toEqual({ featured: [{ id: 'template-1' }] })
  })

  it('sends category searches through the Marketplace contract', async () => {
    const { searchMarketplaceTemplates } = await importDiscovery()
    mocks.templateSearch.mockResolvedValue({
      data: {
        templates: [{ id: 'template-1' }],
        total: 1,
      },
    })

    const result = await searchMarketplaceTemplates({
      category: 'marketing',
      page: 2,
      query: 'campaign',
    })

    expect(mocks.templateSearch).toHaveBeenCalledWith({
      body: {
        page: 2,
        page_size: 40,
        query: 'campaign',
        sort_by: 'usage_count',
        sort_order: 'DESC',
        categories: ['marketing'],
      },
    })
    expect(result).toEqual({ ok: true, page: 2, templates: [{ id: 'template-1' }], total: 1 })
  })

  it('marks a failed template search instead of reporting an empty result', async () => {
    const { searchMarketplaceTemplates } = await importDiscovery()
    mocks.templateSearch.mockRejectedValueOnce(new Error('Unavailable'))

    const result = await searchMarketplaceTemplates({
      category: 'all',
      query: 'campaign',
    })

    expect(result).toEqual({ ok: false, page: 1, templates: [], total: 0 })
  })
})
