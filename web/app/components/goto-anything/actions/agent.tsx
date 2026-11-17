import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import type { ActionItem, AgentSearchResult, SearchQueryOptions } from './types'
import { getI18n } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import AppIcon from '../../base/app-icon'

function getAgentResults(agents: AgentAppPartial[]): AgentSearchResult[] {
  return agents.map((agent) => {
    return {
      id: agent.id,
      title: agent.name,
      description: agent.description || agent.role || undefined,
      type: 'agent' as const,
      path: `/agents/${agent.id}/configure`,
      icon: <AppIcon size="large" shape="circle" icon={agent} />,
      data: agent,
    }
  })
}

export const agentAction: ActionItem = {
  key: '@agents',
  shortcut: '@agents',
  get title() {
    return getI18n().t(($) => $['roster.title'], { ns: 'agentRoster' })
  },
  get description() {
    return getI18n().t(($) => $['roster.searchLabel'], { ns: 'agentRoster' })
  },
  source: 'remote',
}

export function agentSearchQueryOptions(searchTerm: string, options: SearchQueryOptions = {}) {
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
    ...options,
    select: (response) => getAgentResults(response.data),
  })
}
