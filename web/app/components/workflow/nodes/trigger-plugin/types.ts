import type { CommonNodeType } from '@/app/components/workflow/types'
import type { CollectionType } from '@/app/components/tools/types'
import type { ResourceVarInputs } from '../_base/types'

export type PluginTriggerNodeType = CommonNodeType & {
  provider_id: string
  provider_type: CollectionType
  provider_name: string
  trigger_name: string
  trigger_label: string
  trigger_parameters: PluginTriggerVarInputs
  trigger_configurations: Record<string, any>
  output_schema: Record<string, any>
  parameters_schema?: Record<string, any>[]
  version?: string
  trigger_node_version?: string
  plugin_id?: string
  config?: Record<string, any>
}

// Use base types directly
export { VarKindType as PluginTriggerVarType } from '../_base/types'
export type PluginTriggerVarInputs = ResourceVarInputs
