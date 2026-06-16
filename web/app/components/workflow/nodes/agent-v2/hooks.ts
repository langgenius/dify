import { skipToken, useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

export function useAgentRosterDetail(agentId?: string) {
  return useQuery(consoleQuery.agent.byAgentId.get.queryOptions({
    input: agentId
      ? {
          params: {
            agent_id: agentId,
          },
        }
      : skipToken,
  }))
}
