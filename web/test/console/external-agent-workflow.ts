import type { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { seedAppDetail, seedAppDslVersion } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createAppDetailFixture } from '@/test/fixtures/app'

export function seedExternalAgentWorkflowQueries(queryClient: QueryClient, appId: string) {
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  seedAppDetail(queryClient, createAppDetailFixture({ id: appId, mode: 'workflow' }))
  seedAppDslVersion(queryClient)
  const input = { params: { app_id: appId } }
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get.queryKey({ input }),
    { items: [] },
  )
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflows.draft.systemVariables.get.queryKey({ input }),
    { items: [] },
  )
}
