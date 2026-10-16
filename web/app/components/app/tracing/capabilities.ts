import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import type { TracingResource } from './resource'
import { skipToken } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

/** Provider support is the same for every resource; only the authorizing endpoint differs. */
export function traceCapabilitiesQueryOptions(resource: TracingResource, provider: string | null) {
  if (resource.kind === 'agent')
    return consoleQuery.agent.byAgentId.traceCapabilities.get.queryOptions({
      input: provider
        ? { params: { agent_id: resource.agentId }, query: { tracing_provider: provider } }
        : skipToken,
    })
  return consoleQuery.apps.byAppId.traceCapabilities.get.queryOptions({
    input: provider
      ? { params: { app_id: resource.appId }, query: { tracing_provider: provider } }
      : skipToken,
  })
}

/** Deployment-wide gate for Agent tracing, known before any provider is configured. */
export const selectAgentTracingEnabled = ({
  agent_tracing_api_collection_enabled,
}: GetFeaturesResponse) => agent_tracing_api_collection_enabled
