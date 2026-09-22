import type { AgentStrategyEntity, Meta } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ToolVarInputs } from '../tool/types'
import type { CommonNodeType, Memory } from '@/app/components/workflow/types'

export type AgentNodeType = CommonNodeType & {
  agent_strategy_provider_name?: string
  agent_strategy_name?: string
  agent_strategy_label?: string
  agent_parameters?: ToolVarInputs
  meta?: Meta
  output_schema: AgentStrategyEntity['output_schema']
  plugin_unique_identifier?: string
  memory?: Memory
  version?: string
  tool_node_version?: string
}
