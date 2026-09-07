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

    expect(mocks.templateCollections).toHaveBeenCalledWith(
      {
        query: { page: 1, page_size: 100 },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(mocks.templateCollectionTemplates).toHaveBeenNthCalledWith(
      1,
      {
        params: { collectionName: 'featured' },
        body: { limit: 20 },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.ok).toBe(false)
    expect(result.templatesByCollection).toEqual({
      featured: [{ id: 'template-1' }],
      partners: [],
    })
  })

  it('does not cache a partial collection failure', async () => {
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
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({ data: { templates: [{ id: 'template-1' }] } })
      .mockResolvedValue({ data: { templates: [{ id: 'template-2' }] } })

    const failed = await getMarketplaceTemplateCollectionsAndTemplates()
    expect(failed.ok).toBe(false)

    const recovered = await getMarketplaceTemplateCollectionsAndTemplates()
    expect(recovered.ok).toBe(true)
    expect(recovered.templatesByCollection).toEqual({
      featured: [{ id: 'template-2' }],
      partners: [{ id: 'template-2' }],
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

  it('strips list-unused template fields before they can enter the RSC payload', async () => {
    const { getMarketplaceTemplateCollectionsAndTemplates } = await importDiscovery()
    mocks.templateCollections.mockResolvedValue({
      data: {
        collections: [{ name: 'featured', label: {}, description: {}, priority: 1 }],
      },
    })
    mocks.templateCollectionTemplates.mockResolvedValue({
      data: {
        templates: [
          {
            id: 'template-1',
            template_name: 'Inbox',
            readme: '# long',
            review_comment: 'ship it',
            dsl_file_key: 'dsl.yml',
            partner_link: 'https://example.com',
            asset_files: [{ name: 'a' }],
            asset_tree_nodes: [{ path: '/' }],
            dsl_raw_file_key: 'raw.yml',
          },
        ],
      },
    })

    const result = await getMarketplaceTemplateCollectionsAndTemplates()
    const [template] = result.templatesByCollection.featured ?? []

    expect(template).toMatchObject({ id: 'template-1', template_name: 'Inbox' })
    expect(template).not.toHaveProperty('readme')
    expect(template).not.toHaveProperty('review_comment')
    expect(template).not.toHaveProperty('dsl_file_key')
    expect(template).not.toHaveProperty('partner_link')
    expect(template).not.toHaveProperty('asset_files')
    expect(template).not.toHaveProperty('asset_tree_nodes')
    expect(template).not.toHaveProperty('dsl_raw_file_key')
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
