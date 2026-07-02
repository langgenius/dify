import type { InferContractRouterInputs } from '@orpc/contract'
import { oc, type } from '@orpc/contract'

// This Marketplace contract is manually maintained because these APIs are not generated from Dify OpenAPI specs.

const base = oc.$route({ inputStructure: 'detailed' })

export type SearchParamsFromCollection = {
  query?: string
  sort_by?: string
  sort_order?: string
}

export type MarketplaceCollection = {
  name: string
  label: Record<string, string>
  description: Record<string, string>
  rule: string
  created_at: string
  updated_at: string
  searchable?: boolean
  search_params?: SearchParamsFromCollection
}

export type PluginsSearchParams = {
  query: string
  page?: number
  page_size?: number
  sort_by?: string
  sort_order?: string
  category?: string
  tags?: string[]
  exclude?: string[]
  type?: 'plugin' | 'bundle'
}

export type PluginsSort = {
  sortBy: string
  sortOrder: string
}

export type CollectionsAndPluginsSearchParams = {
  category?: string
  condition?: string
  exclude?: string[]
  type?: 'plugin' | 'bundle'
}

export type MarketplaceTemplate = {
  id: string
  template_name: string
  overview: string
  icon: string
  icon_background: string
  icon_file_key: string
  publisher_unique_handle: string
  usage_count: number
  categories: string[]
}

export type MarketplacePluginCategory
  = | 'tool'
    | 'model'
    | 'extension'
    | 'agent-strategy'
    | 'datasource'
    | 'trigger'

export type MarketplacePluginType
  = | 'plugin'
    | 'bundle'
    | 'model'
    | 'extension'
    | 'tool'
    | 'agent_strategy'
    | 'datasource'
    | 'trigger'

export type MarketplacePluginDependencySource = 'github' | 'marketplace' | 'package'

export type MarketplaceI18nObject = Partial<Record<string, string>>

export type MarketplacePlugin = {
  type: MarketplacePluginType
  org: string
  author?: string
  name: string
  plugin_id: string
  version: string
  latest_version: string
  latest_package_identifier: string
  icon: string
  icon_dark?: string
  verified: boolean
  label?: MarketplaceI18nObject
  labels?: MarketplaceI18nObject
  brief?: MarketplaceI18nObject | string
  description?: MarketplaceI18nObject | string
  introduction: string
  repository: string
  category: MarketplacePluginCategory
  install_count: number
  endpoint: {
    settings: Array<Record<string, unknown>>
  }
  tags: Array<{ name: string }>
  badges: string[] | null
  verification: {
    authorized_category: 'langgenius' | 'partner' | 'community'
  }
  from: MarketplacePluginDependencySource
}

export type PluginInfoFromMarketPlace = {
  category: MarketplacePluginCategory
  latest_package_identifier: string
  latest_version: string
}

export type PluginsFromMarketplaceResponse = {
  plugins: MarketplacePlugin[]
  bundles?: MarketplacePlugin[]
  total: number
}

export type PluginsFromMarketplaceByInfoResponse = {
  list: Array<{
    plugin: MarketplacePlugin
    version: {
      plugin_name: string
      plugin_org: string
      unique_identifier: string
    }
  }>
}

export type CollectionsResponse = {
  data?: {
    collections?: MarketplaceCollection[]
  }
}

export type CollectionPluginsResponse = {
  data?: {
    plugins?: MarketplacePlugin[]
  }
}

export type SearchAdvancedResponse = {
  data: PluginsFromMarketplaceResponse
}

export type TemplateDetailResponse = {
  data: MarketplaceTemplate
}

export type DownloadPluginResponse = Blob

const collectionsContract = base
  .route({
    path: '/collections',
    method: 'GET',
  })
  .input(
    type<{
      query?: CollectionsAndPluginsSearchParams & { page?: number, page_size?: number }
    }>(),
  )
  .output(type<CollectionsResponse>())

const collectionPluginsContract = base
  .route({
    path: '/collections/{collectionId}/plugins',
    method: 'POST',
  })
  .input(
    type<{
      params: {
        collectionId: string
      }
      body?: CollectionsAndPluginsSearchParams
    }>(),
  )
  .output(type<CollectionPluginsResponse>())

const searchAdvancedContract = base
  .route({
    path: '/{kind}/search/advanced',
    method: 'POST',
  })
  .input(type<{
    params: {
      kind: 'plugins' | 'bundles'
    }
    body: Omit<PluginsSearchParams, 'type'>
  }>())
  .output(type<SearchAdvancedResponse>())

const templateDetailContract = base
  .route({
    path: '/templates/{templateId}',
    method: 'GET',
  })
  .input(type<{
    params: {
      templateId: string
    }
  }>())
  .output(type<TemplateDetailResponse>())

const downloadPluginContract = base
  .route({
    path: '/plugins/{organization}/{pluginName}/{version}/download',
    method: 'GET',
  })
  .input(type<{
    params: {
      organization: string
      pluginName: string
      version: string
    }
  }>())
  .output(type<DownloadPluginResponse>())

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
  templateDetail: templateDetailContract,
  downloadPlugin: downloadPluginContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>
