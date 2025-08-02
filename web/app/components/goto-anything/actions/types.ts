import type { ReactNode } from 'react'
import type { TypeWithI18N } from '../../base/form/types'
import type { Collection as ToolsCollection } from '../../tools/types'

export type SearchResultType = 'app' | 'dataset' | 'tool'

export type SearchResult = {
  id: string
  title: string
  description?: string
  type: SearchResultType
  path: string
  icon?: ReactNode
}

export type ActionItem = {
  key: '@app' | '@tools' | '@knowledge'
  shortcut: string
  title: string | TypeWithI18N
  description: string
  action?: (data: ToolsCollection[]) => SearchResult[]
  search: (
    query: string,
    searchTerm?: string
  ) => SearchResult[]
}
