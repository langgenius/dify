import type { Plugin } from '../types'

export type MarketplaceCollection = {
  name: string
  description: string
  rule: string
  created_at: string
  updated_at: string
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
}

export type PluginsSort = {
  sortBy: string
  sortOrder: string
}

export type CollectionsAndPluginsSearchParams = {
  category?: string
}

export type SearchParams = {
  language?: string
  q?: string
  tags?: string
  category?: string
}
