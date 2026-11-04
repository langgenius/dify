/**
 * Workflow test environment — composable providers + render helpers.
 *
 * Use renderWorkflowCanvasHook for graph-reading hooks and seed nodes/edges in options.
 * Use renderWorkflowFlowComponent when the contract needs a mounted ReactFlow canvas.
 * Assert resulting graph, workflow store or DOM state; keep owner hooks real.
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
import type {
  RenderHookOptions,
  RenderHookResult,
  RenderOptions,
  RenderResult,
} from '@testing-library/react'
import type { Edge, Node, WorkflowRunningData } from '../types'
import type { StoreInstances, WorkflowProviderOptions } from './workflow-test-providers'
import * as React from 'react'
import ReactFlow, { ReactFlowProvider, useStoreApi } from 'reactflow'
import { render, renderHook } from '@/test/console/render'
import { WorkflowRunningStatus } from '../types'
import {
  createTestWorkflowStore as createProviderWorkflowStore,
  createStoresFromOptions,
  createWorkflowWrapper,
} from './workflow-test-providers'

export function createTestWorkflowStore(...args: Parameters<typeof createProviderWorkflowStore>) {
  return createProviderWorkflowStore(...args)
}

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
  const {
    initialStoreState,
    injectWorkflowStoreSliceFn,
    hooksStoreProps,
    historyStore: historyConfig,
    queryClient,
    resource,
    ...rest
  } = options ?? {}

  const stores = createStoresFromOptions({
    initialStoreState,
    hooksStoreProps,
    injectWorkflowStoreSliceFn,
  })
  const wrapper = createWorkflowWrapper(stores, historyConfig, queryClient, resource)

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
  const {
    initialStoreState,
    injectWorkflowStoreSliceFn,
    hooksStoreProps,
    historyStore: historyConfig,
    queryClient,
    resource,
    ...renderOptions
  } = options ?? {}

  const stores = createStoresFromOptions({
    initialStoreState,
    hooksStoreProps,
    injectWorkflowStoreSliceFn,
  })
  const wrapper = createWorkflowWrapper(stores, historyConfig, queryClient, resource)

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
    resource,
    queryClient,
  }: WorkflowFlowOptions,
) {
  const workflowWrapper = createWorkflowWrapper(stores, historyConfig, queryClient, resource)

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(
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
    injectWorkflowStoreSliceFn,
    hooksStoreProps,
    historyStore,
    nodes,
    edges,
    reactFlowProps,
    canvasStyle,
    resource,
    queryClient,
    ...renderOptions
  } = options ?? {}

  const stores = createStoresFromOptions({
    initialStoreState,
    hooksStoreProps,
    injectWorkflowStoreSliceFn,
  })
  const wrapper = createWorkflowFlowWrapper(stores, {
    historyStore,
    nodes,
    edges,
    reactFlowProps,
    canvasStyle,
    resource,
    queryClient,
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
    injectWorkflowStoreSliceFn,
    hooksStoreProps,
    historyStore,
    nodes,
    edges,
    reactFlowProps,
    canvasStyle,
    resource,
    queryClient,
    ...rest
  } = options ?? {}

  const stores = createStoresFromOptions({
    initialStoreState,
    hooksStoreProps,
    injectWorkflowStoreSliceFn,
  })
  const wrapper = createWorkflowFlowWrapper(stores, {
    historyStore,
    nodes,
    edges,
    reactFlowProps,
    canvasStyle,
    resource,
    queryClient,
  })

  const renderResult = renderHook(hook, { wrapper, ...rest })
  return { ...renderResult, ...stores }
}

// ---------------------------------------------------------------------------
// renderWorkflowCanvasHook — real ReactFlow store without a mounted canvas
// ---------------------------------------------------------------------------

type WorkflowCanvasState = {
  nodes?: Node[]
  edges?: Edge[]
  transform?: [number, number, number]
}

type WorkflowCanvasHookTestOptions<P> = Omit<RenderHookOptions<P>, 'wrapper'> &
  WorkflowProviderOptions &
  WorkflowCanvasState & {
    /** Extra providers rendered inside the workflow and ReactFlow providers. */
    wrapper?: React.ComponentType<{ children: React.ReactNode }>
  }

type WorkflowCanvasHookTestResult<R, P> = WorkflowHookTestResult<R, P> & {
  /** Replace the graph or viewport the hook reads from the ReactFlow store. */
  setCanvas: (canvas: WorkflowCanvasState) => void
}

/**
 * Renders a hook against real workflow, hooks, and ReactFlow stores without mounting
 * `<ReactFlow>`, so the graph and viewport stay exactly as seeded. Use it for hooks that
 * read the canvas through `useStoreApi()`, such as draft persistence.
 */
export function renderWorkflowCanvasHook<R, P = undefined>(
  hook: (props: P) => R,
  options?: WorkflowCanvasHookTestOptions<P>,
): WorkflowCanvasHookTestResult<R, P> {
  const {
    initialStoreState,
    injectWorkflowStoreSliceFn,
    hooksStoreProps,
    historyStore: historyConfig,
    queryClient,
    resource,
    nodes = [],
    edges = [],
    transform = [0, 0, 1],
    wrapper: ExtraWrapper,
    ...rest
  } = options ?? {}

  const stores = createStoresFromOptions({
    initialStoreState,
    hooksStoreProps,
    injectWorkflowStoreSliceFn,
  })
  const workflowWrapper = createWorkflowWrapper(stores, historyConfig, queryClient, resource)
  let flowStore: ReturnType<typeof useStoreApi> | undefined

  const setCanvas = (canvas: WorkflowCanvasState) => {
    if (!flowStore) throw new Error('The ReactFlow store is not mounted.')
    const state = flowStore.getState()
    if (canvas.nodes) state.setNodes(canvas.nodes)
    if (canvas.edges) state.setEdges(canvas.edges)
    if (canvas.transform) flowStore.setState({ transform: canvas.transform })
  }

  function CanvasSeed({ children }: { children: React.ReactNode }) {
    const store = useStoreApi()
    const [seeded] = React.useState(() => {
      flowStore = store
      setCanvas({ nodes, edges, transform })
      return true
    })
    return seeded ? children : null
  }

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      workflowWrapper,
      null,
      React.createElement(
        ReactFlowProvider,
        null,
        React.createElement(
          CanvasSeed,
          null,
          ExtraWrapper ? React.createElement(ExtraWrapper, null, children) : children,
        ),
      ),
    )

  const renderResult = renderHook(hook, { wrapper, ...rest })
  return { ...renderResult, ...stores, setCanvas }
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
