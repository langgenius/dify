import type { CollectionType } from '@/app/components/tools/types'
import type { CommonNodeType } from '@/app/components/workflow/types'
import type { ResourceVarInputs } from '../_base/types'

// Use base types directly
export { VarKindType as VarType } from '../_base/types'
export type ToolVarInputs = ResourceVarInputs

export type ToolNodeType = CommonNodeType & {
  provider_id: string
  provider_type: CollectionType
  provider_name: string
  tool_name: string
  tool_label: string
  tool_parameters: ToolVarInputs
  tool_configurations: Record<string, any>
  output_schema: Record<string, any>
  paramSchemas?: Record<string, any>[]
  version?: string
  tool_node_version?: string
}
