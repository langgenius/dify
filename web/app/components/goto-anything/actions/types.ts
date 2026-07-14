import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { DatasetListItemResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode } from 'react'
import type { TypeWithI18N } from '../../base/form/types'
import type { Plugin } from '../../plugins/types'
import type { CommonNodeType } from '../../workflow/types'

type SearchResultType = 'app' | 'knowledge' | 'plugin' | 'workflow-node' | 'command' | 'recent'

type BaseSearchResult<T> = {
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
} & BaseSearchResult<AppPartial>

export type PluginSearchResult = {
  type: 'plugin'
} & BaseSearchResult<Plugin>

export type KnowledgeSearchResult = {
  type: 'knowledge'
} & BaseSearchResult<DatasetListItemResponse>

type WorkflowNodeSearchResult = {
  type: 'workflow-node'
  metadata?: {
    nodeId: string
    nodeData: CommonNodeType
  }
} & BaseSearchResult<CommonNodeType>

export type CommandSearchResult = {
  type: 'command'
} & BaseSearchResult<{ command: string; args?: Record<string, unknown> }>

export type RecentSearchResult = {
  type: 'recent'
  originalType: 'app' | 'knowledge'
} & BaseSearchResult<{ path: string }>

export type SearchResult =
  | AppSearchResult
  | PluginSearchResult
  | KnowledgeSearchResult
  | WorkflowNodeSearchResult
  | CommandSearchResult
  | RecentSearchResult

type ActionItemBase = {
  key: '@app' | '@knowledge' | '@plugin' | '@node' | '/'
  shortcut: string
  title: string | TypeWithI18N
  description: string
  action?: (data: SearchResult) => void
}

type RemoteActionItem = ActionItemBase & {
  source: 'remote'
}

export type LocalActionItem = ActionItemBase & {
  source: 'local'
  search: (query: string, searchTerm: string, locale?: string) => SearchResult[]
}

export type ActionItem = RemoteActionItem | LocalActionItem
