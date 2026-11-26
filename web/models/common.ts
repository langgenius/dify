import type { AppConfigJsonValue } from '@dify/contracts/api/console/apps/types.gen'

export type DataSourceNotionPage = {
  page_icon: null | {
    type: string | null
    url: string | null
    emoji: string | null
  }
  page_id: string
  page_name: string
  parent_id: string
  type: string
  is_bound: boolean
}

export type NotionPage = DataSourceNotionPage & {
  workspace_id: string
}

export type DataSourceNotionPageMap = Record<
  string,
  DataSourceNotionPage & { workspace_id: string }
>

export type DataSourceNotionWorkspace = {
  workspace_name: string
  workspace_id: string
  workspace_icon: string | null
  total?: number
  pages: DataSourceNotionPage[]
}

export const DataSourceProvider = {
  fireCrawl: 'firecrawl',
  jinaReader: 'jinareader',
  waterCrawl: 'watercrawl',
} as const
export type DataSourceProvider = (typeof DataSourceProvider)[keyof typeof DataSourceProvider]

export type ExternalDataTool = {
  type?: string
  label?: string
  icon?: string
  icon_background?: string
  variable?: string
  enabled?: boolean
  config?: {
    api_based_extension_id?: string
  } & Record<string, AppConfigJsonValue>
}
