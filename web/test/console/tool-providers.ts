import type { ToolProviderListResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

/** Cached provider metadata for tests whose subject is its consumer, not fetching. */
export function seedToolProviders(
  queryClient: QueryClient,
  providers: {
    builtInTools?: ToolProviderListResponse
    customTools?: ToolProviderListResponse
    workflowTools?: ToolProviderListResponse
    mcpTools?: ToolProviderListResponse
  },
) {
  const tools = consoleQuery.workspaces.current.tools
  const entries = [
    [tools.builtin.get.queryKey(), providers.builtInTools],
    [tools.api.get.queryKey(), providers.customTools],
    [tools.workflow.get.queryKey(), providers.workflowTools],
    [tools.mcp.get.queryKey(), providers.mcpTools],
  ] as const
  for (const [key, data] of entries) {
    if (data !== undefined) queryClient.setQueryData<ToolProviderListResponse>(key, data)
  }
}
