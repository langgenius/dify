import type {
  MarketplaceTemplate,
  MarketplaceTemplateCollection,
} from '@dify/contracts/marketplace'
import { marketplaceClient } from './client'

export type MarketplaceTemplateCollectionsResult = {
  collections: MarketplaceTemplateCollection[]
  templatesByCollection: Record<string, MarketplaceTemplate[]>
  /**
   * False when the Marketplace API request failed, so the UI can render an
   * error state instead of claiming the catalog is empty.
   */
  ok: boolean
}

export const TEMPLATE_SEARCH_PAGE_SIZE = 40

type SearchMarketplaceTemplatesOptions = {
  category: string
  page?: number
  query: string
  sortBy?: string
  sortOrder?: string
}

const FAILED_COLLECTIONS_RESULT: MarketplaceTemplateCollectionsResult = {
  collections: [],
  templatesByCollection: {},
  ok: false,
}

const COLLECTION_PREVIEW_TEMPLATE_LIMIT = 24
const COLLECTION_FETCH_BATCH_SIZE = 5
const COLLECTIONS_CACHE_TTL_MS = 5 * 60 * 1000

let collectionsCache: {
  expiresAt: number
  result: MarketplaceTemplateCollectionsResult
} | null = null
let collectionsInFlight: Promise<MarketplaceTemplateCollectionsResult> | null = null

async function fetchCollectionsAndTemplates(): Promise<MarketplaceTemplateCollectionsResult> {
  const response = await marketplaceClient.templateCollections({
    query: {
      page: 1,
      page_size: 100,
    },
  })
  const collections = response.data?.collections ?? []
  const entries: (readonly [string, MarketplaceTemplate[]])[] = []

  // Bounded fan-out: fetch collection previews in small batches instead of
  // firing one uncached request per collection all at once.
  for (
    let batchStart = 0;
    batchStart < collections.length;
    batchStart += COLLECTION_FETCH_BATCH_SIZE
  ) {
    const batch = collections.slice(batchStart, batchStart + COLLECTION_FETCH_BATCH_SIZE)
    entries.push(
      ...(await Promise.all(
        batch.map(async (collection) => {
          try {
            const collectionResponse = await marketplaceClient.templateCollectionTemplates({
              params: { collectionName: collection.name },
              body: { limit: COLLECTION_PREVIEW_TEMPLATE_LIMIT },
            })

            return [collection.name, collectionResponse.data?.templates ?? []] as const
          } catch {
            return [collection.name, [] as MarketplaceTemplate[]] as const
          }
        }),
      )),
    )
  }

  return {
    collections,
    templatesByCollection: Object.fromEntries(entries),
    ok: true,
  }
}

/**
 * Server-side cached view of the template collections and their previews.
 * `marketplaceClient` opts out of the framework fetch cache (`no-store`), so
 * without this cache every server render of /templates would fan out to up to
 * 1 + N external requests. Successful results are reused for a few minutes and
 * concurrent renders share a single in-flight fetch; failures are not cached.
 */
export async function getMarketplaceTemplateCollectionsAndTemplates(): Promise<MarketplaceTemplateCollectionsResult> {
  if (collectionsCache && collectionsCache.expiresAt > Date.now()) return collectionsCache.result
  if (collectionsInFlight) return collectionsInFlight

  collectionsInFlight = fetchCollectionsAndTemplates()
    .then((result) => {
      collectionsCache = { expiresAt: Date.now() + COLLECTIONS_CACHE_TTL_MS, result }
      return result
    })
    .catch(() => FAILED_COLLECTIONS_RESULT)
    .finally(() => {
      collectionsInFlight = null
    })

  return collectionsInFlight
}

export async function searchMarketplaceTemplates({
  category,
  page = 1,
  query,
  sortBy = 'usage_count',
  sortOrder = 'DESC',
}: SearchMarketplaceTemplatesOptions) {
  try {
    const response = await marketplaceClient.templateSearch({
      body: {
        page,
        page_size: TEMPLATE_SEARCH_PAGE_SIZE,
        query,
        sort_by: sortBy,
        sort_order: sortOrder,
        ...(category === 'all' ? {} : { categories: [category] }),
      },
    })

    return {
      ok: true,
      page,
      templates: response.data?.templates ?? [],
      total: response.data?.total ?? 0,
    }
  } catch {
    // Marked as failed so callers can distinguish an API outage from a
    // genuinely empty search result.
    return {
      ok: false,
      page,
      templates: [],
      total: 0,
    }
  }
}
