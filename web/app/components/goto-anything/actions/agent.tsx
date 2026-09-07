import type { AgentAppPartial, AgentIconType } from '@dify/contracts/api/console/agent/types.gen'
import type { ActionItem, AgentSearchResult } from './types'
import { getI18n } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import AppIcon from '../../base/app-icon'

function getAgentResults(agents: AgentAppPartial[]): AgentSearchResult[] {
  return agents.map((agent) => {
    const imageUrl =
      agent.icon_type === 'image' || agent.icon_type === 'link' ? agent.icon : undefined
    const iconType = (imageUrl ? 'image' : agent.icon_type) as AgentIconType | null | undefined

    return {
      id: agent.id,
      title: agent.name,
      description: agent.description || agent.role || undefined,
      type: 'agent' as const,
      path: `/agents/${agent.id}/configure`,
      icon: (
        <AppIcon
          size="large"
          rounded
          iconType={iconType}
          icon={agent.icon ?? undefined}
          background={agent.icon_background}
          imageUrl={imageUrl}
        />
      ),
      data: agent,
    }
  })
}

export const agentAction: ActionItem = {
  key: '@agents',
  shortcut: '@agents',
  get title() {
    return getI18n().t(($) => $['roster.title'], { ns: 'agentV2' })
  },
  get description() {
    return getI18n().t(($) => $['roster.searchLabel'], { ns: 'agentV2' })
  },
  source: 'remote',
}

export function agentSearchQueryOptions(searchTerm: string) {
  return consoleQuery.agent.get.queryOptions({
    input: {
      query: {
        page: 1,
        limit: 10,
        name: searchTerm,
        sort_by: 'last_modified',
      },
    },
    retry: false,
    select: (response) => getAgentResults(response.data),
  })
}
