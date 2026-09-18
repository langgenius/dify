import type { DataSourceNotionPage } from '@/models/common'

export type NotionPageSelectionMode = 'multiple' | 'single'

export type NotionPageTreeItem = {
  children: Set<string>
  descendants: Set<string>
  depth: number
  ancestors: string[]
} & DataSourceNotionPage

export type NotionPageTreeMap = Record<string, NotionPageTreeItem>

export type NotionPageRow = {
  page: DataSourceNotionPage
  parentExists: boolean
  depth: number
  expand: boolean
  hasChild: boolean
  ancestors: string[]
}
