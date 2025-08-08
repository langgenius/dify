import type { CommonNodeType, Memory } from '@/app/components/workflow/types'
import type { ToolVarInputs } from '../tool/types'
import type { PluginMeta } from '@/app/components/plugins/types'

export type AgentNodeType = CommonNodeType & {
  agent_strategy_provider_name?: string
  agent_strategy_name?: string
  agent_strategy_label?: string
  agent_parameters?: ToolVarInputs
  meta?: PluginMeta
  output_schema: Record<string, any>
  plugin_unique_identifier?: string
  memory?: Memory
  version?: string
  tool_node_version?: string
}

export enum AgentFeature {
  HISTORY_MESSAGES = 'history-messages',
}
