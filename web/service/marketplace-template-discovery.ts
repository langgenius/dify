import type {
  MarketplaceTemplate,
  MarketplaceTemplateCollection,
} from '@dify/contracts/marketplace'
import { marketplaceClient } from './client'

export type MarketplaceTemplateCollectionsResult = {
  collections: MarketplaceTemplateCollection[]
  templatesByCollection: Record<string, MarketplaceTemplate[]>
}

type SearchMarketplaceTemplatesOptions = {
  category: string
  query: string
  sortBy?: string
  sortOrder?: string
}

const EMPTY_COLLECTIONS_RESULT: MarketplaceTemplateCollectionsResult = {
  collections: [],
  templatesByCollection: {},
}

export async function getMarketplaceTemplateCollectionsAndTemplates(): Promise<MarketplaceTemplateCollectionsResult> {
  try {
    const response = await marketplaceClient.templateCollections({
      query: {
        page: 1,
        page_size: 100,
      },
    })
    const collections = response.data?.collections ?? []
    const entries = await Promise.all(
      collections.map(async (collection) => {
        try {
          const collectionResponse = await marketplaceClient.templateCollectionTemplates({
            params: { collectionName: collection.name },
            body: { limit: 100 },
          })

          return [collection.name, collectionResponse.data?.templates ?? []] as const
        } catch {
          return [collection.name, []] as const
        }
      }),
    )

    return {
      collections,
      templatesByCollection: Object.fromEntries(entries),
    }
  } catch {
    return EMPTY_COLLECTIONS_RESULT
  }
}

export async function searchMarketplaceTemplates({
  category,
  query,
  sortBy = 'usage_count',
  sortOrder = 'DESC',
}: SearchMarketplaceTemplatesOptions) {
  try {
    const response = await marketplaceClient.templateSearch({
      body: {
        page: 1,
        page_size: 40,
        query,
        sort_by: sortBy,
        sort_order: sortOrder,
        ...(category === 'all' ? {} : { categories: [category] }),
      },
    })

    return {
      templates: response.data?.templates ?? [],
      total: response.data?.total ?? 0,
    }
  } catch {
    return {
      templates: [],
      total: 0,
    }
  }
}
