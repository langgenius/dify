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
import type { Edge, Node, WorkflowRunningData } from '../types'
import type { WorkflowHistoryStoreApi } from '../workflow-history-store'
import { render, renderHook } from '@testing-library/react'
import isDeepEqual from 'fast-deep-equal'
import * as React from 'react'
import { temporal } from 'zundo'
import { create } from 'zustand'
import { WorkflowContext } from '../context'
import { HooksStoreContext } from '../hooks-store/provider'
import { createHooksStore } from '../hooks-store/store'
import { createWorkflowStore } from '../store/workflow'
import { WorkflowRunningStatus } from '../types'
import { WorkflowHistoryStoreContext } from '../workflow-history-store'

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

export function createTestHooksStore(props?: Partial<HooksStoreShape>): HooksStore {
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
) {
  const historyCtxValue = historyConfig
    ? createTestHistoryStoreContext(historyConfig)
    : undefined

  return ({ children }: { children: React.ReactNode }) => {
    let inner: React.ReactNode = children

    if (historyCtxValue) {
      inner = React.createElement(
        WorkflowHistoryStoreContext.Provider,
        { value: historyCtxValue },
        inner,
      )
    }

    if (stores.hooksStore) {
      inner = React.createElement(
        HooksStoreContext.Provider,
        { value: stores.hooksStore },
        inner,
      )
    }

    return React.createElement(
      WorkflowContext.Provider,
      { value: stores.store },
      inner,
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
 * - **historyStore**: `WorkflowHistoryStoreContext` (real zundo temporal store)
 */
export function renderWorkflowHook<R, P = undefined>(
  hook: (props: P) => R,
  options?: WorkflowHookTestOptions<P>,
): WorkflowHookTestResult<R, P> {
  const { initialStoreState, hooksStoreProps, historyStore: historyConfig, ...rest } = options ?? {}

  const stores = createStoresFromOptions({ initialStoreState, hooksStoreProps })
  const wrapper = createWorkflowWrapper(stores, historyConfig)

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
 * - **historyStore**: `WorkflowHistoryStoreContext` (real zundo temporal store)
 */
export function renderWorkflowComponent(
  ui: React.ReactElement,
  options?: WorkflowComponentTestOptions,
): WorkflowComponentTestResult {
  const { initialStoreState, hooksStoreProps, historyStore: historyConfig, ...renderOptions } = options ?? {}

  const stores = createStoresFromOptions({ initialStoreState, hooksStoreProps })
  const wrapper = createWorkflowWrapper(stores, historyConfig)

  const renderResult = render(ui, { wrapper, ...renderOptions })
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

function createTestHistoryStoreContext(config: HistoryStoreConfig) {
  const nodes = config.nodes ?? []
  const edges = config.edges ?? []

  type HistState = {
    workflowHistoryEvent: string | undefined
    workflowHistoryEventMeta: unknown
    nodes: Node[]
    edges: Edge[]
    getNodes: () => Node[]
    setNodes: (n: Node[]) => void
    setEdges: (e: Edge[]) => void
  }

  const store = create(temporal<HistState>(
    (set, get) => ({
      workflowHistoryEvent: undefined,
      workflowHistoryEventMeta: undefined,
      nodes,
      edges,
      getNodes: () => get().nodes,
      setNodes: (n: Node[]) => set({ nodes: n }),
      setEdges: (e: Edge[]) => set({ edges: e }),
    }),
    { equality: (a, b) => isDeepEqual(a, b) },
  )) as unknown as WorkflowHistoryStoreApi

  return {
    store,
    shortcutsEnabled: true,
    setShortcutsEnabled: () => {},
  }
}
