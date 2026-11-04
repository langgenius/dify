import type { ReactElement } from 'react'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'

/** Real workflow and query providers for editors that resolve workflow variable references. */
export function renderWorkflowEditor(
  ui: ReactElement,
  options: Parameters<typeof renderWorkflowFlowComponent>[1] = {},
) {
  const { queryClient } = createConsoleQueryWrapper({
    appDslVersion: '0.6.0',
    // Local editing tests do not establish a collaboration socket or hydrate a CRDT document.
    systemFeatures: { enable_collaboration_mode: false },
  })
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return renderWorkflowFlowComponent(ui, { queryClient, ...options })
}
