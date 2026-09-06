import type {
  MarketplaceTemplate,
  MarketplaceTemplateCollection,
} from '@dify/contracts/marketplace'
import { SERVER_PREFETCH_BUDGET_MS } from '@/app/components/plugins/marketplace/server-budget'
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
  languages?: string[]
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

const COLLECTION_PREVIEW_TEMPLATE_LIMIT = 20

type MarketplaceTemplateListExtras = {
  asset_files?: unknown
  asset_tree_nodes?: unknown
  dsl_file_key?: unknown
  dsl_raw_file_key?: unknown
  partner_link?: unknown
  readme?: unknown
  review_comment?: unknown
}

export const toListTemplate = (template: MarketplaceTemplate): MarketplaceTemplate => {
  const {
    asset_files: _assetFiles,
    asset_tree_nodes: _assetTreeNodes,
    dsl_file_key: _dslFileKey,
    dsl_raw_file_key: _dslRawFileKey,
    partner_link: _partnerLink,
    readme: _readme,
    review_comment: _reviewComment,
    ...listFields
  } = template as MarketplaceTemplate & MarketplaceTemplateListExtras

  return listFields
}
const COLLECTION_FETCH_BATCH_SIZE = 5
const COLLECTIONS_CACHE_TTL_MS = 5 * 60 * 1000

let collectionsCache: {
  expiresAt: number
  result: MarketplaceTemplateCollectionsResult
} | null = null
let collectionsInFlight: Promise<MarketplaceTemplateCollectionsResult> | null = null

async function fetchCollectionsAndTemplates(): Promise<MarketplaceTemplateCollectionsResult> {
  const budget = AbortSignal.timeout(SERVER_PREFETCH_BUDGET_MS)

  try {
    const response = await marketplaceClient.templateCollections(
      {
        query: {
          page: 1,
          page_size: 100,
        },
      },
      { signal: budget },
    )
    const collections = response.data?.collections ?? []
    const entries: (readonly [string, MarketplaceTemplate[]])[] = []
    let hadCollectionFailure = false

    // Bounded fan-out: fetch collection previews in small batches instead of
    // firing one uncached request per collection all at once. The route budget
    // aborts leftover work so `/templates` cannot wait N batches × 15s.
    for (
      let batchStart = 0;
      batchStart < collections.length;
      batchStart += COLLECTION_FETCH_BATCH_SIZE
    ) {
      if (budget.aborted) return FAILED_COLLECTIONS_RESULT

      const batch = collections.slice(batchStart, batchStart + COLLECTION_FETCH_BATCH_SIZE)
      entries.push(
        ...(await Promise.all(
          batch.map(async (collection) => {
            try {
              const collectionResponse = await marketplaceClient.templateCollectionTemplates(
                {
                  params: { collectionName: collection.name },
                  body: { limit: COLLECTION_PREVIEW_TEMPLATE_LIMIT },
                },
                { signal: budget },
              )

              return [
                collection.name,
                (collectionResponse.data?.templates ?? []).map(toListTemplate),
              ] as const
            } catch (error) {
              if (budget.aborted) throw error
              hadCollectionFailure = true
              return [collection.name, [] as MarketplaceTemplate[]] as const
            }
          }),
        )),
      )
    }

    return {
      collections,
      templatesByCollection: Object.fromEntries(entries),
      ok: !hadCollectionFailure,
    }
  } catch (error) {
    if (budget.aborted) return FAILED_COLLECTIONS_RESULT
    throw error
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
      if (result.ok) collectionsCache = { expiresAt: Date.now() + COLLECTIONS_CACHE_TTL_MS, result }
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
  languages,
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
        ...(languages?.length ? { languages } : {}),
      },
    })

    return {
      ok: true,
      page,
      templates: (response.data?.templates ?? []).map(toListTemplate),
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
