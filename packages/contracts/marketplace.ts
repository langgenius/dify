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

export type MarketplaceTimestamp = string | number
export type MarketplaceCreatorStatus = 'pending' | 'active' | 'inactive' | 'deleted'
export type MarketplaceOrganizationStatus = 'active' | 'inactive' | 'deleted'

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
  publisher_unique_handle?: string
  publisher_handle?: string
  publisher_type?: string
  creator_email?: string
  usage_count: number
  categories: string[]
  deps_plugins?: string[]
  preferred_languages?: string[]
  badges?: string[]
  created_at?: MarketplaceTimestamp
  updated_at?: MarketplaceTimestamp
}

export type MarketplaceCreator = {
  id?: string
  email?: string
  name?: string
  display_name?: string
  unique_handle: string
  display_email?: string
  description?: string
  avatar?: string
  background_image?: string
  social_links?: string[]
  badges?: string[]
  verified?: boolean
  status?: MarketplaceCreatorStatus
  public?: boolean
  plugin_count?: number
  template_count?: number
  created_at?: string
  updated_at?: string
}

export type MarketplaceOrganization = {
  id?: string
  email?: string
  name?: string
  display_name?: string
  unique_handle?: string
  display_email?: string
  description?: string
  avatar?: string
  background_image?: string
  social_links?: string[]
  badges?: string[]
  verified?: boolean
  status?: MarketplaceOrganizationStatus
  created_at?: string
  updated_at?: string
}

export type MarketplaceTemplateCollection = {
  name: string
  description: Record<string, string>
  label: Record<string, string>
  searchable?: boolean
  search_params?: SearchParamsFromCollection
  priority: number
}

export type MarketplacePluginCategory =
  | 'tool'
  | 'model'
  | 'extension'
  | 'agent-strategy'
  | 'datasource'
  | 'trigger'

export type MarketplacePluginType =
  | 'plugin'
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
  created_at?: MarketplaceTimestamp
  updated_at?: MarketplaceTimestamp
  version_updated_at?: MarketplaceTimestamp | null
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

export type TemplateCollectionsResponse = {
  data?: {
    collections?: MarketplaceTemplateCollection[]
    total?: number
  }
}

export type TemplateCollectionTemplatesResponse = {
  data?: {
    templates?: MarketplaceTemplate[]
    total?: number
  }
}

export type TemplateSearchResponse = {
  data?: {
    templates?: MarketplaceTemplate[]
    total?: number
  }
}

export type DownloadPluginResponse = Blob

export type CreatorDetailResponse = {
  code?: number
  data?: {
    creator?: MarketplaceCreator
  }
  msg?: string
}

export type OrganizationDetailResponse = {
  code?: number
  data?: {
    organization?: MarketplaceOrganization
  }
  msg?: string
}

export type PublisherPluginsResponse = {
  code?: number
  data?: {
    plugins?: MarketplacePlugin[]
    total?: number
  }
  msg?: string
}

export type PublisherTemplatesResponse = {
  code?: number
  data?: {
    templates?: MarketplaceTemplate[]
    total?: number
  }
  msg?: string
}

// Banner payload shapes shared by the standalone marketplace and the embedded
// console. The banners endpoint output stays `unknown` in the contract because
// the delivery format is normalized and runtime-validated in
// `web/app/components/plugins/marketplace/home/banners.ts`.
export type BannerBase = {
  id: string
  title: string
  sort: number
  language: string
}

export type BannerRecommendCard = {
  item_type: 'plugin' | 'template'
  item_id: string
  display_name: string
  icon_url?: string
  icon?: string
  icon_background?: string
  creator?: string
  badges?: Array<'partner' | 'verified'>
  link: string
  card_position: number
}

export type BannerRecommend = BannerBase & {
  style_type: 'recommend'
  content: {
    theme_type: 'newest' | 'hottest' | 'partner'
    heading?: string
    subheadings?: string[]
    description?: string
    cards: BannerRecommendCard[]
  }
}

export type BannerBlog = BannerBase & {
  style_type: 'blog'
  content: {
    blog_title: string
    subtitle?: string
    description?: string
    link: string
    link_target_type: 'blog' | 'github'
  }
}

export type BannerImageContent = {
  images: {
    desktop: string
    tablet?: string
    mobile?: string
  }
  link: string
  alt_text?: string
  activity_id?: string
}

export type BannerEvent = BannerBase & {
  style_type: 'event'
  content: BannerImageContent
}

export type BannerAd = BannerBase & {
  style_type: 'ad'
  content: BannerImageContent & {
    partner_id?: string
    campaign_id?: string
  }
}

export type PluginBanner = BannerRecommend | BannerBlog | BannerEvent | BannerAd

const bannerListContract = base
  .route({
    path: '/banners',
    method: 'GET',
  })
  .input(
    type<{
      query: {
        page: 'plugins'
        language: string
      }
    }>(),
  )
  .output(type<unknown>())

const collectionsContract = base
  .route({
    path: '/collections',
    method: 'GET',
  })
  .input(
    type<{
      query?: CollectionsAndPluginsSearchParams & { page?: number; page_size?: number }
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
  .input(
    type<{
      params: {
        kind: 'plugins' | 'bundles'
      }
      body: Omit<PluginsSearchParams, 'type'>
    }>(),
  )
  .output(type<SearchAdvancedResponse>())

const templateDetailContract = base
  .route({
    path: '/templates/{templateId}',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        templateId: string
      }
    }>(),
  )
  .output(type<TemplateDetailResponse>())

const templateCollectionsContract = base
  .route({
    path: '/template-collections',
    method: 'GET',
  })
  .input(
    type<{
      query?: {
        page?: number
        page_size?: number
      }
    }>(),
  )
  .output(type<TemplateCollectionsResponse>())

const templateCollectionTemplatesContract = base
  .route({
    path: '/template-collections/{collectionName}/templates',
    method: 'POST',
  })
  .input(
    type<{
      params: {
        collectionName: string
      }
      body?: {
        limit?: number
      }
    }>(),
  )
  .output(type<TemplateCollectionTemplatesResponse>())

const templateSearchContract = base
  .route({
    path: '/templates/search/advanced',
    method: 'POST',
  })
  .input(
    type<{
      body: {
        page: number
        page_size: number
        query: string
        sort_by: string
        sort_order: string
        categories?: string[]
      }
    }>(),
  )
  .output(type<TemplateSearchResponse>())

const downloadPluginContract = base
  .route({
    path: '/plugins/{organization}/{pluginName}/{version}/download',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        organization: string
        pluginName: string
        version: string
      }
    }>(),
  )
  .output(type<DownloadPluginResponse>())

const creatorDetailContract = base
  .route({
    path: '/creators/{uniqueHandle}',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        uniqueHandle: string
      }
    }>(),
  )
  .output(type<CreatorDetailResponse>())

const organizationDetailContract = base
  .route({
    path: '/organizations/{id}',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        id: string
      }
    }>(),
  )
  .output(type<OrganizationDetailResponse>())

const publisherPluginsContract = base
  .route({
    path: '/plugins/publisher/{uniqueHandle}',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        uniqueHandle: string
      }
      query: {
        page: number
        page_size: number
      }
    }>(),
  )
  .output(type<PublisherPluginsResponse>())

const publisherTemplatesContract = base
  .route({
    path: '/templates/publisher/{uniqueHandle}',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        uniqueHandle: string
      }
      query: {
        page: number
        page_size: number
      }
    }>(),
  )
  .output(type<PublisherTemplatesResponse>())

export const marketplaceRouterContract = {
  banners: {
    list: bannerListContract,
  },
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
  templateCollections: templateCollectionsContract,
  templateCollectionTemplates: templateCollectionTemplatesContract,
  templateDetail: templateDetailContract,
  templateSearch: templateSearchContract,
  downloadPlugin: downloadPluginContract,
  creatorDetail: creatorDetailContract,
  organizationDetail: organizationDetailContract,
  publisherPlugins: publisherPluginsContract,
  publisherTemplates: publisherTemplatesContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>
