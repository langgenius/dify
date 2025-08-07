import type { ReactNode } from 'react'
import type { TypeWithI18N } from '../../base/form/types'
import type { App } from '@/types/app'
import type { Plugin } from '../../plugins/types'
import type { DataSet } from '@/models/datasets'

export type SearchResultType = 'app' | 'knowledge' | 'plugin'

export type BaseSearchResult<T = any> = {
  id: string
  title: string
  description?: string
  type: SearchResultType
  path?: string
  icon?: ReactNode
  data: T
}

export type AppSearchResult = {
  type: 'app'
} & BaseSearchResult<App>

export type PluginSearchResult = {
  type: 'plugin'
} & BaseSearchResult<Plugin>

export type KnowledgeSearchResult = {
  type: 'knowledge'
} & BaseSearchResult<DataSet>

export type SearchResult = AppSearchResult | PluginSearchResult | KnowledgeSearchResult

export type ActionItem = {
  key: '@app' | '@knowledge' | '@plugin'
  shortcut: string
  title: string | TypeWithI18N
  description: string
  action?: (data: SearchResult) => void
  search: (
    query: string,
    searchTerm: string,
    locale: string,
  ) => (Promise<SearchResult[]> | SearchResult[])
}
