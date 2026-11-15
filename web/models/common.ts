import type { AppConfigJsonValue } from '@dify/contracts/api/console/apps/types.gen'
import type { I18nText } from '@/i18n/language'

export type CommonResponse = {
  result: 'success' | 'fail'
}

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

export type CodeBasedExtensionForm = {
  type: string
  label: I18nText
  variable: string
  required: boolean
  options: { label: I18nText; value: string }[]
  default?: string
  placeholder: string
  max_length?: number
}

export type CodeBasedExtensionItem = {
  name: string
  label: I18nText
  form_schema: CodeBasedExtensionForm[]
}
export type CodeBasedExtension = {
  module: string
  data: CodeBasedExtensionItem[]
}

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
