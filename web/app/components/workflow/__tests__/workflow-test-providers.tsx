import type { ReactNode } from 'react'
import type { EditorResource } from '../editor-resource/resource'
import type { Shape as HooksStoreShape } from '../hooks-store/store'
import type { InjectWorkflowStoreSliceFn, Shape } from '../store/workflow'
import type { WorkflowHistoryState } from '../store/workflow/history-slice'
import type { Edge, Node } from '../types'
import { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { seedAppDetail, seedAppDslVersion, seedSystemFeatures } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { WorkflowContext } from '../context'
import { EditorResourceScope } from '../editor-resource/provider'
import { HooksStoreContext } from '../hooks-store/provider'
import { createHooksStore } from '../hooks-store/store'
import { createWorkflowStore } from '../store/workflow'

// Provider construction shared by RTL and Browser Mode; importing it registers no test hooks.
type WorkflowStore = ReturnType<typeof createWorkflowStore>
type HooksStore = ReturnType<typeof createHooksStore>

export function createTestWorkflowStore(
  initialState?: Partial<Shape>,
  injectWorkflowStoreSliceFn?: InjectWorkflowStoreSliceFn,
): WorkflowStore {
  const store = createWorkflowStore({ injectWorkflowStoreSliceFn })
  if (initialState) store.setState(initialState)
  return store
}

function createTestHooksStore(props?: Partial<HooksStoreShape>): HooksStore {
  const store = createHooksStore(props ?? {})
  if (props) store.setState(props)
  return store
}

// ---------------------------------------------------------------------------
// Shared provider options & wrapper factory
// ---------------------------------------------------------------------------

type HistoryStoreConfig = {
  nodes?: Node[]
  edges?: Edge[]
}

export type WorkflowProviderOptions = {
  injectWorkflowStoreSliceFn?: InjectWorkflowStoreSliceFn
  resource?: EditorResource
  initialStoreState?: Partial<Shape>
  hooksStoreProps?: Partial<HooksStoreShape>
  historyStore?: HistoryStoreConfig
  queryClient?: QueryClient
}

export type StoreInstances = {
  store: WorkflowStore
  hooksStore?: HooksStore
}

export function createStoresFromOptions(options: WorkflowProviderOptions): StoreInstances {
  const store = createTestWorkflowStore(
    options.initialStoreState,
    options.injectWorkflowStoreSliceFn,
  )
  const hooksStore = createTestHooksStore(options.hooksStoreProps)
  return { store, hooksStore }
}

export function createWorkflowWrapper(
  stores: StoreInstances,
  historyConfig?: HistoryStoreConfig,
  externalQueryClient?: QueryClient,
  resource: EditorResource = { kind: 'app', appId: 'app-1', mode: 'workflow' },
) {
  if (historyConfig) {
    stores.store.temporal.getState().pause()
    stores.store.getState().setWorkflowHistory(createTestWorkflowHistoryState(historyConfig))
    stores.store.temporal.getState().clear()
    stores.store.temporal.getState().resume()
  }

  const queryClient =
    externalQueryClient ??
    new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
          staleTime: Infinity,
        },
      },
    })
  if (!externalQueryClient) seedSystemFeatures(queryClient)
  if (!externalQueryClient) seedAppDslVersion(queryClient)
  if (!externalQueryClient) seedAccountProfileQuery(queryClient)
  if (resource.kind === 'app') {
    const input = { input: { params: { app_id: resource.appId } } }
    for (const endpoint of [
      consoleQuery.apps.byAppId.workflows.draft.systemVariables.get,
      consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get,
    ]) {
      const variableKey = endpoint.queryKey(input)
      if (!queryClient.getQueryData(variableKey))
        queryClient.setQueryData(variableKey, { items: [] })
    }
    const key = consoleQuery.apps.byAppId.get.queryKey({
      input: { params: { app_id: resource.appId } },
    })
    if (!queryClient.getQueryData(key))
      seedAppDetail(
        queryClient,
        createAppDetailFixture({ id: resource.appId, mode: resource.mode }),
      )
  }
  const QueryClientWrapper = createQueryClientWrapper(queryClient)

  return ({ children }: { children: ReactNode }) => (
    <QueryClientWrapper>
      <EditorResourceScope resource={resource}>
        <WorkflowContext value={stores.store}>
          {stores.hooksStore ? (
            <HooksStoreContext value={stores.hooksStore}>{children}</HooksStoreContext>
          ) : (
            children
          )}
        </WorkflowContext>
      </EditorResourceScope>
    </QueryClientWrapper>
  )
}

function createTestWorkflowHistoryState(config: HistoryStoreConfig): WorkflowHistoryState {
  const nodes = config.nodes ?? []
  const edges = config.edges ?? []
  return {
    nodes,
    edges,
    workflowHistoryEvent: undefined,
    workflowHistoryEventMeta: undefined,
  }
}
