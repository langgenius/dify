import type { CommonNodeType } from '@/app/components/workflow/types'
import type { ToolVarInputs } from '../tool/types'

export type AgentNodeType = CommonNodeType & {
  max_iterations: number
  agent_strategy_provider_name?: string
  agent_strategy_name?: string
  agent_strategy_label?: string
  agent_parameters?: ToolVarInputs,
  agent_configurations?: Record<string, ToolVarInputs>
}
