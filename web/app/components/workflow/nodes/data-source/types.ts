import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export enum VarType {
  variable = 'variable',
  constant = 'constant',
  mixed = 'mixed',
}

export enum DataSourceClassification {
  localFile = 'local_file',
  websiteCrawl = 'website_crawl',
  onlineDocument = 'online_document',
  onlineDrive = 'online_drive',
}

export type ToolVarInputs = Record<string, {
  type: VarType
  value?: string | ValueSelector | any
}>

export type DataSourceNodeType = CommonNodeType & {
  fileExtensions?: string[]
  plugin_id: string
  provider_type: string
  provider_name: string
  datasource_name: string
  datasource_label: string
  datasource_parameters: ToolVarInputs
  datasource_configurations: Record<string, any>
}

export type CustomRunFormProps = {
  payload: CommonNodeType
  onSuccess: () => void
  onCancel: () => void
}
