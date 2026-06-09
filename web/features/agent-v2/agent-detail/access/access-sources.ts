import type { AgentRosterResponse } from '@dify/contracts/api/console/agents/types.gen'
import type { I18nKeysWithPrefix } from '@/types/i18n'

export type AgentAccessSource = {
  id: string
  nameKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.access.entries.'>
  descriptionKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.access.entries.'>
  reference: string
  status: 'enabled' | 'disabled'
  icon: string
}

const getStatus = (agent: AgentRosterResponse): AgentAccessSource['status'] =>
  agent.status === 'active' ? 'enabled' : 'disabled'

export const getAgentAccessSources = (agent?: AgentRosterResponse): AgentAccessSource[] => {
  if (!agent)
    return []

  const sources: AgentAccessSource[] = []

  if (agent.app_id) {
    sources.push({
      id: 'agent-app',
      nameKey: 'agentDetail.access.entries.agentApp.name',
      descriptionKey: 'agentDetail.access.entries.agentApp.description',
      reference: agent.app_id,
      status: getStatus(agent),
      icon: 'i-ri-window-line',
    })
  }

  if (agent.workflow_id || agent.workflow_node_id) {
    sources.push({
      id: 'workflow',
      nameKey: 'agentDetail.access.entries.workflow.name',
      descriptionKey: 'agentDetail.access.entries.workflow.description',
      reference: [
        agent.workflow_id,
        agent.workflow_node_id,
      ].filter(Boolean).join(' / '),
      status: getStatus(agent),
      icon: 'i-ri-git-branch-line',
    })
  }

  return sources
}
