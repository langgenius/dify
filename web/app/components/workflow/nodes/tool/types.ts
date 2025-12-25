import type { ResourceVarInputs } from '../_base/types'
import type { Collection, CollectionType } from '@/app/components/tools/types'
import type { CommonNodeType } from '@/app/components/workflow/types'

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
  paramSchemas?: Record<string, any>[]
  version?: string
  tool_node_version?: string
  tool_description?: string
  is_team_authorization?: boolean
  params?: Record<string, any>
  plugin_id?: string
  provider_icon?: Collection['icon']
  provider_icon_dark?: Collection['icon_dark']
  plugin_unique_identifier?: string
}
