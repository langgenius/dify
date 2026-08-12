import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getMarketplaceTemplateCollectionsAndTemplates,
  searchMarketplaceTemplates,
} from './marketplace-template-discovery'

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

describe('marketplace template discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads each template collection and isolates a failed collection', async () => {
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
      body: { limit: 100 },
    })
    expect(result.templatesByCollection).toEqual({
      featured: [{ id: 'template-1' }],
      partners: [],
    })
  })

  it('sends category searches through the Marketplace contract', async () => {
    mocks.templateSearch.mockResolvedValue({
      data: {
        templates: [{ id: 'template-1' }],
        total: 1,
      },
    })

    const result = await searchMarketplaceTemplates({
      category: 'marketing',
      query: 'campaign',
    })

    expect(mocks.templateSearch).toHaveBeenCalledWith({
      body: {
        page: 1,
        page_size: 40,
        query: 'campaign',
        sort_by: 'usage_count',
        sort_order: 'DESC',
        categories: ['marketing'],
      },
    })
    expect(result).toEqual({ templates: [{ id: 'template-1' }], total: 1 })
  })
})
