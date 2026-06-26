import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import type { I18nKeysWithPrefix } from '@/types/i18n'

export type AgentAccessSource = {
  id: string
  nameKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.access.entries.'>
  descriptionKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.access.entries.'>
  reference: string
  status: 'enabled' | 'disabled'
  icon: string
}

const getStatus = (agent: AgentAppDetailWithSite): AgentAccessSource['status'] =>
  agent.id ? 'enabled' : 'disabled'

export const getAgentAccessSources = (agent?: AgentAppDetailWithSite): AgentAccessSource[] => {
  if (!agent)
    return []

  const sources: AgentAccessSource[] = []

  if (agent.id) {
    sources.push({
      id: 'agent-app',
      nameKey: 'agentDetail.access.entries.agentApp.name',
      descriptionKey: 'agentDetail.access.entries.agentApp.description',
      reference: agent.id,
      status: getStatus(agent),
      icon: 'i-ri-window-line',
    })
  }

  return sources
}
