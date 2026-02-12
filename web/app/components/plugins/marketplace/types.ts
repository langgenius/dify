import type { Plugin } from '../types'

export type SearchParamsFromCollection = {
  query?: string
  sort_by?: string
  sort_order?: string
}

export type PluginCollection = {
  name: string
  label: Record<string, string>
  description: Record<string, string>
  rule: string
  created_at: string
  updated_at: string
  searchable?: boolean
  search_params?: SearchParamsFromCollection
}

export type MarketplaceCollectionsResponse = {
  collections: PluginCollection[]
  total: number
}

export type MarketplaceCollectionPluginsResponse = {
  plugins: Plugin[]
  total: number
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

export type SearchParams = {
  language?: string
  q?: string
  tags?: string
  category?: string
  creationType?: string
}

export type TemplateCollection = {
  id: string
  name: string
  label: Record<string, string>
  description: Record<string, string>
  conditions: string[]
  searchable: boolean
  search_params?: SearchParamsFromCollection
  created_at?: string
  updated_at?: string
}

export type Template = {
  id: string
  index_id: string
  template_name: string
  icon: string
  icon_background?: string
  icon_file_key: string
  categories: string[]
  overview: string
  readme: string
  partner_link: string
  deps_plugins: string[]
  preferred_languages: string[]
  publisher_handle: string
  publisher_type: string
  kind: string
  status: string
  usage_count: number
  created_at: string
  updated_at: string
}

export type CreateTemplateCollectionRequest = {
  name: string
  description: Record<string, string>
  label: Record<string, string>
  conditions: string[]
  searchable: boolean
  search_params: SearchParamsFromCollection
}

export type GetCollectionTemplatesRequest = {
  categories?: string[]
  exclude?: string[]
  limit?: number
}

export type AddTemplateToCollectionRequest = {
  template_id: string
}

export type BatchAddTemplatesToCollectionRequest = {
  template_id: string
}[]

// Creator types
export type Creator = {
  id?: string
  email: string
  name: string
  display_name: string
  unique_handle: string
  display_email: string
  description: string
  avatar: string
  social_links: string[]
  status: 'active' | 'inactive'
  public?: boolean
  plugin_count?: number
  template_count?: number
  created_at: string
  updated_at: string
}

export type CreatorSearchParams = {
  query?: string
  page?: number
  page_size?: number
  categories?: string[]
  sort_by?: string
  sort_order?: string
}

export type CreatorSearchResponse = {
  creators: Creator[]
  total: number
}

export type SyncCreatorProfileRequest = {
  email: string
  name?: string
  display_name?: string
  unique_handle: string
  display_email?: string
  description?: string
  avatar?: string
  social_links?: string[]
  status?: 'active' | 'inactive'
}

// Template Detail (full template info from API, extends Template with extra fields)
export type TemplateDetail = Template & {
  publisher_unique_handle: string
  creator_email: string
  dsl_file_key: string
  review_comment: string
}

export type TemplatesListResponse = {
  templates: TemplateDetail[]
  total: number
}

export type TemplateSearchParams = {
  query?: string
  page?: number
  page_size?: number
  categories?: string[]
  sort_by?: string
  sort_order?: string
  languages?: string[]
}

// Unified search types

export type UnifiedSearchScope = 'creators' | 'organizations' | 'plugins' | 'templates'

export type UnifiedSearchParams = {
  query: string
  scope?: UnifiedSearchScope[]
  page?: number
  page_size?: number
}

// Plugin item shape from /search/unified (superset of Plugin with index_id)
export type UnifiedPluginItem = Plugin & {
  index_id: string
}

// Template item shape from /search/unified (same as Template)
export type UnifiedTemplateItem = Template

// Creator item shape from /search/unified (superset of Creator with index_id)
export type UnifiedCreatorItem = Creator & {
  index_id: string
}

export type UnifiedSearchResponse = {
  data: {
    creators: { items: UnifiedCreatorItem[], total: number }
    organizations: { items: unknown[], total: number }
    plugins: { items: UnifiedPluginItem[], total: number }
    templates: { items: UnifiedTemplateItem[], total: number }
  }
}
