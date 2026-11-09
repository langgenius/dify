import type { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function invalidateAgentWorkingDirectoryFiles({
  appId,
  conversationId,
  nodeId,
  queryClient,
}: {
  appId?: string
  conversationId?: string | null
  nodeId?: string
  queryClient: QueryClient
}) {
  if (appId && nodeId) {
    void queryClient.invalidateQueries({
      queryKey:
        consoleQuery.apps.byAppId.workflowRuns.byWorkflowRunId.agentNodes.byNodeId.sandbox.files.get.key(
          { type: 'query' },
        ),
    })
    return
  }

  if (!conversationId) return

  void queryClient.invalidateQueries({
    queryKey: consoleQuery.agent.byAgentId.sandbox.files.get.key({ type: 'query' }),
  })
}
