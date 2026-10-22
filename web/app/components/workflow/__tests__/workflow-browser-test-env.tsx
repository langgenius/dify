import type { ReactElement } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { WorkflowContext } from '../context'
import { EditorResourceScope } from '../editor-resource/provider'
import { HooksStoreContext } from '../hooks-store/provider'
import { createHooksStore, fullWorkflowAccessControl } from '../hooks-store/store'
import { createWorkflowStore } from '../store/workflow'

const unexpectedFetch = vi.fn<typeof fetch>(() => new Promise(() => {}))
beforeEach(() => vi.stubGlobal('fetch', unexpectedFetch))
afterEach(() => {
  vi.unstubAllGlobals()
  expect(unexpectedFetch).not.toHaveBeenCalled()
})

// Browser fixtures keep their own canvas geometry and tab order, sharing real editor providers.
export async function renderWorkflowBrowserComponent(ui: ReactElement) {
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
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
  const input = { input: { params: { app_id: 'app-1' } } }
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey(input),
    createAppDetailFixture({ id: 'app-1', mode: 'workflow' }),
  )
  for (const endpoint of [
    consoleQuery.apps.byAppId.workflows.draft.systemVariables.get,
    consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get,
  ])
    queryClient.setQueryData(endpoint.queryKey(input), { items: [] })
  const store = createWorkflowStore({})
  const hooksStore = createHooksStore({
    accessControl: fullWorkflowAccessControl,
    doSyncWorkflowDraft: async () => undefined,
  })
  const screen = await render(
    <Wrapper>
      <EditorResourceScope resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}>
        <WorkflowContext value={store}>
          <HooksStoreContext value={hooksStore}>
            <ReactFlowProvider>{ui}</ReactFlowProvider>
          </HooksStoreContext>
        </WorkflowContext>
      </EditorResourceScope>
    </Wrapper>,
  )
  return { ...screen, store }
}
