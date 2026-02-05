import type { Plugin } from '../types'

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

export type MarketplaceCollectionsResponse = {
  collections: MarketplaceCollection[]
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
  template_id: string
  name: string
  description: Record<string, string>
  icon: string
  tags: string[]
  author: string
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

// Template Detail (full template info from API)
export type TemplateDetail = {
  id: string
  publisher_type: 'individual' | 'organization'
  publisher_unique_handle: string
  creator_email: string
  template_name: string
  icon: string
  icon_background: string
  icon_file_key: string
  dsl_file_key: string
  categories: string[]
  overview: string
  readme: string
  partner_link: string
  status: 'published' | 'draft' | 'pending' | 'rejected'
  review_comment: string
  created_at: string
  updated_at: string
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
