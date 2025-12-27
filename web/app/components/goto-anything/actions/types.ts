import type { ReactNode } from 'react'
import type { Plugin } from '../../plugins/types'
import type { CommonNodeType } from '../../workflow/types'
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

export type { ScopeContext, ScopeDescriptor } from './scope-registry'
