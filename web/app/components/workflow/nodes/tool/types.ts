import type { CommonNodeType } from '@/app/components/workflow/types'

export enum VarType {
  selector = 'selector',
  static = 'static',
}

export type ToolVarInput = {
  variable: string
  variable_type: VarType
  value?: string
  value_selector?: string[]
}

export type ToolNodeType = CommonNodeType & {
  provider_id: string
  provider_type: 'builtin'
  provider_name: string
  tool_name: string
  tool_label: string
  tool_parameters: ToolVarInput[]
  tool_configurations: Record<string, any>
}
