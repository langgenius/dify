import type {
  DeclaredOutputConfig,
  WorkflowNodeJobConfig,
  WorkflowOutputRoutes,
} from '@dify/contracts/api/console/apps/types.gen'
import type { AgentBinding } from '@/app/components/workflow/block-selector/types'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

export type AgentV2NodeType = CommonNodeType &
  Pick<WorkflowNodeJobConfig, 'continue_agent_session'> & {
    agent_binding?: AgentBinding
    agent_declared_outputs?: DeclaredOutputConfig[]
    agent_output_routes?: WorkflowOutputRoutes
    agent_node_kind: 'dify_agent'
    readonly agent_session_generation?: WorkflowNodeJobConfig['session_generation']
    agent_task?: string
    version: '2'
  }

export function isAgentV2NodeData(data: Record<string, unknown>): data is AgentV2NodeType {
  return (
    (data.type === BlockEnum.Agent || data.type === BlockEnum.AgentV2) &&
    data.agent_node_kind === 'dify_agent' &&
    data.version === '2'
  )
}

export function hasValidRosterAgentBinding(data: AgentV2NodeType) {
  return (
    data.agent_binding?.binding_type === 'roster_agent' &&
    typeof data.agent_binding.agent_id === 'string' &&
    data.agent_binding.agent_id.length > 0
  )
}

export function hasInlineAgentBinding(data: AgentV2NodeType) {
  return data.agent_binding?.binding_type === 'inline_agent'
}

export function hasValidInlineAgentBinding(data: AgentV2NodeType) {
  return (
    data.agent_binding?.binding_type === 'inline_agent' &&
    typeof data.agent_binding.agent_id === 'string' &&
    data.agent_binding.agent_id.length > 0 &&
    typeof data.agent_binding.current_snapshot_id === 'string' &&
    data.agent_binding.current_snapshot_id.length > 0
  )
}

export function needsInlineAgentBindingCreation(data: AgentV2NodeType) {
  return hasInlineAgentBinding(data) && !hasValidInlineAgentBinding(data)
}

export function hasValidAgentBinding(data: AgentV2NodeType) {
  return hasValidInlineAgentBinding(data) || hasValidRosterAgentBinding(data)
}

export function hasAgentV2OutputRoutes(data: CommonNodeType): data is AgentV2NodeType {
  return isAgentV2NodeData(data) && !!data.agent_output_routes?.enabled
}
