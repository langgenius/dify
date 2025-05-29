import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export enum VarType {
  variable = 'variable',
  constant = 'constant',
  mixed = 'mixed',
}

export type ToolVarInputs = Record<string, {
  type: VarType
  value?: string | ValueSelector | any
}>

export type DataSourceNodeType = CommonNodeType & {
  fileExtensions?: string[]
  provider_id: string
  provider_type: string
  provider_name: string
  datasource_name: string
  datasource_label: string
  datasource_parameters: ToolVarInputs
  datasource_configurations: Record<string, any>
}
