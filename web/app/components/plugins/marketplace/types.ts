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
  pageSize?: number
  sortBy?: string
  sortOrder?: string
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
}
