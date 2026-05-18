/**
 * Workflow test environment — composable providers + render helpers.
 *
 * ## Quick start (hook)
 *
 * ```ts
 * import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
 * import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
 *
 * // Mock ReactFlow (one line, only needed when the hook imports reactflow)
 * vi.mock('reactflow', async () =>
 *   (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock(),
 * )
 *
 * it('example', () => {
 *   resetReactFlowMockState()
 *   rfState.nodes = [{ id: 'n1', position: { x: 0, y: 0 }, data: {} }]
 *
 *   const { result, store } = renderWorkflowHook(
 *     () => useMyHook(),
 *     {
 *       initialStoreState: { workflowRunningData: {...} },
 *       hooksStoreProps: { doSyncWorkflowDraft: vi.fn() },
 *     },
 *   )
 *
 *   result.current.doSomething()
 *   expect(store.getState().someValue).toBe(expected)
 *   expect(rfState.setNodes).toHaveBeenCalled()
 * })
 * ```
 *
 * ## Quick start (component)
 *
 * ```ts
 * import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
 *
 * it('renders correctly', () => {
 *   const { getByText, store } = renderWorkflowComponent(
 *     <MyComponent someProp="value" />,
 *     { initialStoreState: { showConfirm: undefined } },
 *   )
 *   expect(getByText('value')).toBeInTheDocument()
 *   expect(store.getState().showConfirm).toBeUndefined()
 * })
 * ```
 *
 * ## Quick start (node component)
 *
 * ```ts
 * import { renderNodeComponent } from '../../__tests__/workflow-test-env'
 *
 * it('renders node', () => {
 *   const { getByText, store } = renderNodeComponent(
 *     MyNodeComponent,
 *     { type: BlockEnum.Code, title: 'My Node', desc: '' },
 *     { nodeId: 'n-1', initialStoreState: { ... } },
 *   )
 *   expect(getByText('My Node')).toBeInTheDocument()
 * })
 * ```
 */
import type { RenderHookOptions, RenderHookResult, RenderOptions, RenderResult } from '@testing-library/react'
import type { Shape as HooksStoreShape } from '../hooks-store/store'
import type { Shape } from '../store/workflow'
import type { WorkflowHistoryState } from '../store/workflow/history-slice'
import type { Edge, Node, WorkflowRunningData } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook } from '@testing-library/react'
import * as React from 'react'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import { seedSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { WorkflowContext } from '../context'
import { HooksStoreContext } from '../hooks-store/provider'
import { createHooksStore } from '../hooks-store/store'
import { createWorkflowStore } from '../store/workflow'
import { WorkflowRunningStatus } from '../types'

// Re-exports are in a separate non-JSX file to avoid react-refresh warnings.
// Import directly from the individual modules:
//   reactflow-mock-state.ts  → rfState, resetReactFlowMockState, createReactFlowModuleMock
//   service-mock-factory.ts  → createToolServiceMock, createTriggerServiceMock, ...
//   fixtures.ts              → createNode, createEdge, createLinearGraph, ...

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

export function baseRunningData(overrides: Record<string, unknown> = {}) {
  return {
    task_id: 'task-1',
    result: { status: WorkflowRunningStatus.Running } as WorkflowRunningData['result'],
    tracing: [],
    resultText: '',
    resultTabActive: false,
    ...overrides,
  } as WorkflowRunningData
}

// ---------------------------------------------------------------------------
// Store creation helpers
// ---------------------------------------------------------------------------

type WorkflowStore = ReturnType<typeof createWorkflowStore>
type HooksStore = ReturnType<typeof createHooksStore>

export function createTestWorkflowStore(initialState?: Partial<Shape>): WorkflowStore {
  const store = createWorkflowStore({})
  if (initialState)
    store.setState(initialState)
  return store
}

function createTestHooksStore(props?: Partial<HooksStoreShape>): HooksStore {
  const store = createHooksStore(props ?? {})
  if (props)
    store.setState(props)
  return store
}

// ---------------------------------------------------------------------------
// Shared provider options & wrapper factory
// ---------------------------------------------------------------------------

type HistoryStoreConfig = {
  nodes?: Node[]
  edges?: Edge[]
}

type WorkflowProviderOptions = {
  initialStoreState?: Partial<Shape>
  hooksStoreProps?: Partial<HooksStoreShape>
  historyStore?: HistoryStoreConfig
  queryClient?: QueryClient
}

type StoreInstances = {
  store: WorkflowStore
  hooksStore?: HooksStore
}

function createStoresFromOptions(options: WorkflowProviderOptions): StoreInstances {
  const store = createTestWorkflowStore(options.initialStoreState)
  const hooksStore = options.hooksStoreProps !== undefined
    ? createTestHooksStore(options.hooksStoreProps)
    : undefined
  return { store, hooksStore }
}

function createWorkflowWrapper(
  stores: StoreInstances,
  historyConfig?: HistoryStoreConfig,
  externalQueryClient?: QueryClient,
) {
  if (historyConfig) {
    stores.store.temporal.getState().pause()
    stores.store.getState().setWorkflowHistory(createTestWorkflowHistoryState(historyConfig))
    stores.store.temporal.getState().clear()
    stores.store.temporal.getState().resume()
  }

  const queryClient = externalQueryClient ?? new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  if (!externalQueryClient)
    seedSystemFeatures(queryClient)

  return ({ children }: { children: React.ReactNode }) => {
    let inner: React.ReactNode = children

    if (stores.hooksStore) {
      inner = React.createElement(
        HooksStoreContext.Provider,
        { value: stores.hooksStore },
        inner,
      )
    }

    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        WorkflowContext.Provider,
        { value: stores.store },
        inner,
      ),
    )
  }
}

// ---------------------------------------------------------------------------
// renderWorkflowHook — composable hook renderer
// ---------------------------------------------------------------------------

type WorkflowHookTestOptions<P> = Omit<RenderHookOptions<P>, 'wrapper'> & WorkflowProviderOptions

type WorkflowHookTestResult<R, P> = RenderHookResult<R, P> & StoreInstances

/**
 * Renders a hook inside composable workflow providers.
 *
 * Contexts provided based on options:
 * - **Always**: `WorkflowContext` (real zustand store)
 * - **hooksStoreProps**: `HooksStoreContext` (real zustand store)
 * - **historyStore**: workflow history zundo store on `WorkflowContext`
 */
export function renderWorkflowHook<R, P = undefined>(
  hook: (props: P) => R,
  options?: WorkflowHookTestOptions<P>,
): WorkflowHookTestResult<R, P> {
  const { initialStoreState, hooksStoreProps, historyStore: historyConfig, queryClient, ...rest } = options ?? {}

  const stores = createStoresFromOptions({ initialStoreState, hooksStoreProps })
  const wrapper = createWorkflowWrapper(stores, historyConfig, queryClient)

  const renderResult = renderHook(hook, { wrapper, ...rest })
  return { ...renderResult, ...stores }
}

// ---------------------------------------------------------------------------
// renderWorkflowComponent — composable component renderer
// ---------------------------------------------------------------------------

type WorkflowComponentTestOptions = Omit<RenderOptions, 'wrapper'> & WorkflowProviderOptions

type WorkflowComponentTestResult = RenderResult & StoreInstances

/**
 * Renders a React element inside composable workflow providers.
 *
 * Provides the same context layers as `renderWorkflowHook`:
 * - **Always**: `WorkflowContext` (real zustand store)
 * - **hooksStoreProps**: `HooksStoreContext` (real zustand store)
 * - **historyStore**: workflow history zundo store on `WorkflowContext`
 */
export function renderWorkflowComponent(
  ui: React.ReactElement,
  options?: WorkflowComponentTestOptions,
): WorkflowComponentTestResult {
  const { initialStoreState, hooksStoreProps, historyStore: historyConfig, queryClient, ...renderOptions } = options ?? {}

  const stores = createStoresFromOptions({ initialStoreState, hooksStoreProps })
  const wrapper = createWorkflowWrapper(stores, historyConfig, queryClient)

  const renderResult = render(ui, { wrapper, ...renderOptions })
  return { ...renderResult, ...stores }
}

// ---------------------------------------------------------------------------
// renderWorkflowFlowComponent / renderWorkflowFlowHook — real ReactFlow wrappers
// ---------------------------------------------------------------------------

type WorkflowFlowOptions = WorkflowProviderOptions & {
  nodes?: Node[]
  edges?: Edge[]
  reactFlowProps?: Omit<React.ComponentProps<typeof ReactFlow>, 'children' | 'nodes' | 'edges'>
  canvasStyle?: React.CSSProperties
}

type WorkflowFlowComponentTestOptions = Omit<RenderOptions, 'wrapper'> & WorkflowFlowOptions
type WorkflowFlowHookTestOptions<P> = Omit<RenderHookOptions<P>, 'wrapper'> & WorkflowFlowOptions

function createWorkflowFlowWrapper(
  stores: StoreInstances,
  {
    historyStore: historyConfig,
    nodes = [],
    edges = [],
    reactFlowProps,
    canvasStyle,
  }: WorkflowFlowOptions,
) {
  const workflowWrapper = createWorkflowWrapper(stores, historyConfig)

  return ({ children }: { children: React.ReactNode }) => React.createElement(
    workflowWrapper,
    null,
    React.createElement(
      'div',
      { style: { width: 800, height: 600, ...canvasStyle } },
      React.createElement(
        ReactFlowProvider,
        null,
        React.createElement(ReactFlow, { fitView: true, ...reactFlowProps, nodes, edges }),
        children,
      ),
    ),
  )
}

export function renderWorkflowFlowComponent(
  ui: React.ReactElement,
  options?: WorkflowFlowComponentTestOptions,
): WorkflowComponentTestResult {
  const {
    initialStoreState,
    hooksStoreProps,
    historyStore,
    nodes,
    edges,
    reactFlowProps,
    canvasStyle,
    ...renderOptions
  } = options ?? {}

  const stores = createStoresFromOptions({ initialStoreState, hooksStoreProps })
  const wrapper = createWorkflowFlowWrapper(stores, {
    historyStore,
    nodes,
    edges,
    reactFlowProps,
    canvasStyle,
  })

  const renderResult = render(ui, { wrapper, ...renderOptions })
  return { ...renderResult, ...stores }
}

export function renderWorkflowFlowHook<R, P = undefined>(
  hook: (props: P) => R,
  options?: WorkflowFlowHookTestOptions<P>,
): WorkflowHookTestResult<R, P> {
  const {
    initialStoreState,
    hooksStoreProps,
    historyStore,
    nodes,
    edges,
    reactFlowProps,
    canvasStyle,
    ...rest
  } = options ?? {}

  const stores = createStoresFromOptions({ initialStoreState, hooksStoreProps })
  const wrapper = createWorkflowFlowWrapper(stores, {
    historyStore,
    nodes,
    edges,
    reactFlowProps,
    canvasStyle,
  })

  const renderResult = renderHook(hook, { wrapper, ...rest })
  return { ...renderResult, ...stores }
}

// ---------------------------------------------------------------------------
// renderNodeComponent — convenience wrapper for node components
// ---------------------------------------------------------------------------

type NodeComponentProps<T = Record<string, unknown>> = {
  id: string
  data: T
  selected?: boolean
}

type NodeTestOptions = WorkflowComponentTestOptions & {
  nodeId?: string
  selected?: boolean
}

/**
 * Renders a workflow node component inside composable workflow providers.
 *
 * Automatically provides `id`, `data`, and `selected` props that
 * ReactFlow would normally inject into custom node components.
 */
export function renderNodeComponent<T extends Record<string, unknown>>(
  Component: React.ComponentType<NodeComponentProps<T>>,
  data: T,
  options?: NodeTestOptions,
): WorkflowComponentTestResult {
  const { nodeId = 'test-node-1', selected = false, ...rest } = options ?? {}
  return renderWorkflowComponent(
    React.createElement(Component, { id: nodeId, data, selected }),
    rest,
  )
}

// ---------------------------------------------------------------------------
// WorkflowHistoryStore test helper
// ---------------------------------------------------------------------------

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
