import type { ResourceVarInputs } from '../_base/types'
import type { CollectionType } from '@/app/components/tools/types'
import type { CommonNodeType } from '@/app/components/workflow/types'

export type PluginTriggerNodeType = CommonNodeType & {
  provider_id: string
  provider_type: CollectionType
  provider_name: string
  event_name: string
  event_label: string
  event_parameters: PluginTriggerVarInputs
  event_configurations: Record<string, any>
  output_schema: Record<string, any>
  parameters_schema?: Record<string, any>[]
  version?: string
  event_node_version?: string
  plugin_id?: string
  config?: Record<string, any>
  plugin_unique_identifier?: string
}

// Use base types directly
export { VarKindType as PluginTriggerVarType } from '../_base/types'
export type PluginTriggerVarInputs = ResourceVarInputs
