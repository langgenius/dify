import type { ReactElement } from 'react'
import type { WorkflowProviderOptions } from './workflow-test-providers'
import { ReactFlowProvider } from 'reactflow'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { fullWorkflowAccessControl } from '../hooks-store/store'
import { createStoresFromOptions, createWorkflowWrapper } from './workflow-test-providers'

// Browser fixtures own their geometry, interactions and network guards explicitly.
export async function renderWorkflowBrowserComponent(
  ui: ReactElement,
  options: WorkflowProviderOptions = {},
) {
  const { queryClient: defaultClient } = createConsoleQueryWrapper({
    appDslVersion: '0.6.0',
    systemFeatures: { enable_collaboration_mode: false },
  })
  const queryClient = options.queryClient ?? defaultClient
  seedModelProviderQueries(queryClient)
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  queryClient.setQueryData(consoleQuery.rag.pipelines.recommendedPlugins.get.queryKey(), {
    installed_recommended_plugins: [],
    uninstalled_recommended_plugins: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  const stores = createStoresFromOptions({
    ...options,
    hooksStoreProps: {
      accessControl: fullWorkflowAccessControl,
      doSyncWorkflowDraft: async () => undefined,
      ...options.hooksStoreProps,
    },
  })
  const Wrapper = createWorkflowWrapper(stores, options.historyStore, queryClient, options.resource)
  const screen = await render(
    <Wrapper>
      <ReactFlowProvider>{ui}</ReactFlowProvider>
    </Wrapper>,
  )
  return { ...screen, ...stores }
}
