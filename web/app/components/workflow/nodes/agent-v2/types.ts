import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentBinding, AgentRosterNodeData } from '@/app/components/workflow/block-selector/types'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

export type AgentV2NodeType = CommonNodeType & {
  agent_binding?: AgentBinding
  agent_declared_outputs?: DeclaredOutputConfig[]
  agent_node_kind: 'dify_agent'
  agent_roster?: AgentRosterNodeData
  agent_task?: string
  version: '2'
}

export function isAgentV2NodeData(data: CommonNodeType): data is AgentV2NodeType {
  const payload = data as { agent_node_kind?: string, version?: string }
  return (data.type === BlockEnum.Agent || data.type === BlockEnum.AgentV2)
    && payload.agent_node_kind === 'dify_agent'
    && payload.version === '2'
}

export function hasValidRosterAgentBinding(data: AgentV2NodeType) {
  return data.agent_binding?.binding_type === 'roster_agent'
    && !!data.agent_roster
    && data.agent_binding.agent_id === data.agent_roster.id
}

export function hasInlineAgentBinding(data: AgentV2NodeType) {
  return data.agent_binding?.binding_type === 'inline_agent'
}

export function hasValidAgentBinding(data: AgentV2NodeType) {
  return hasInlineAgentBinding(data) || hasValidRosterAgentBinding(data)
}
