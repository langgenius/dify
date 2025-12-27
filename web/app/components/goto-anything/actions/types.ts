import type { ReactNode } from 'react'
import type { TypeWithI18N } from '../../base/form/types'
import type { Plugin } from '../../plugins/types'
import type { CommonNodeType } from '../../workflow/types'
import type { ActionKey } from '../constants'
import type { DataSet } from '@/models/datasets'
import type { App } from '@/types/app'

export type SearchResultType = 'app' | 'knowledge' | 'plugin' | 'workflow-node' | 'command'

export type BaseSearchResult<T = unknown> = {
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

export type WorkflowNodeSearchResult = {
  type: 'workflow-node'
  metadata?: {
    nodeId: string
    nodeData: CommonNodeType
  }
} & BaseSearchResult<CommonNodeType>

export type CommandSearchResult = {
  type: 'command'
} & BaseSearchResult<{ command: string, args?: Record<string, unknown> }>

export type SearchResult = AppSearchResult | PluginSearchResult | KnowledgeSearchResult | WorkflowNodeSearchResult | CommandSearchResult

// Legacy ActionItem for backward compatibility if needed, but we should move to ScopeDescriptor
export type ActionItem = {
  key: ActionKey
  shortcut: string
  title: string | TypeWithI18N
  description: string
  /**
   * @deprecated use search() instead
   */
  action?: (data: SearchResult) => void
  /**
   * @deprecated use search() instead
   */
  searchFn?: (searchTerm: string) => SearchResult[]
  search: (
    query: string,
    searchTerm: string,
    locale?: string,
  ) => (Promise<SearchResult[]> | SearchResult[])
}

export type { ScopeContext, ScopeDescriptor } from './scope-registry'
