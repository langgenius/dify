import { getQueryClient } from '@/app/get-query-client'
import { consoleQuery } from '@/service/console'

export async function getAgentAccessAppId(agentId: string) {
  const agent = await getQueryClient().query(
    consoleQuery.agent.byAgentId.get.queryOptions({
      input: { params: { agent_id: agentId } },
      context: { silent: true },
      staleTime: Infinity,
      retry: false,
    }),
  )
  return agent.hidden_app_backed ? undefined : agent.app_id
}
