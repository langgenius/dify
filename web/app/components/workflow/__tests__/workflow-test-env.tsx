/**
 * Workflow test environment — composable providers + render helpers.
 *
 * ## Quick start
 *
 * ```ts
 * import { renderWorkflowHook, rfState, resetReactFlowMockState } from '../../__tests__/workflow-test-env'
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
 */
import type { RenderHookOptions, RenderHookResult } from '@testing-library/react'
import type { Shape as HooksStoreShape } from '../hooks-store/store'
import type { Shape } from '../store/workflow'
import type { Edge, Node, WorkflowRunningData } from '../types'
import { renderHook } from '@testing-library/react'
import * as React from 'react'
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
  return createHooksStore(props ?? {})
}

// ---------------------------------------------------------------------------
// renderWorkflowHook — composable hook renderer
// ---------------------------------------------------------------------------

type HistoryStoreConfig = {
  nodes?: Node[]
  edges?: Edge[]
}

type WorkflowTestOptions<P> = Omit<RenderHookOptions<P>, 'wrapper'> & {
  initialStoreState?: Partial<Shape>
  hooksStoreProps?: Partial<HooksStoreShape>
  historyStore?: HistoryStoreConfig
}

type WorkflowTestResult<R, P> = RenderHookResult<R, P> & {
  store: WorkflowStore
  hooksStore?: HooksStore
}

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
  options?: WorkflowTestOptions<P>,
): WorkflowTestResult<R, P> {
  const { initialStoreState, hooksStoreProps, historyStore: historyConfig, ...rest } = options ?? {}

  const store = createTestWorkflowStore(initialStoreState)
  const hooksStore = hooksStoreProps !== undefined
    ? createTestHooksStore(hooksStoreProps)
    : undefined

  const wrapper = ({ children }: { children: React.ReactNode }) => {
    let inner: React.ReactNode = children

    if (historyConfig) {
      const historyCtxValue = createTestHistoryStoreContext(historyConfig)
      inner = React.createElement(
        WorkflowHistoryStoreContext.Provider,
        { value: historyCtxValue },
        inner,
      )
    }

    if (hooksStore) {
      inner = React.createElement(
        HooksStoreContext.Provider,
        { value: hooksStore },
        inner,
      )
    }

    return React.createElement(
      WorkflowContext.Provider,
      { value: store },
      inner,
    )
  }

  const renderResult = renderHook(hook, { wrapper, ...rest })
  return { ...renderResult, store, hooksStore }
}

// ---------------------------------------------------------------------------
// WorkflowHistoryStore test helper
// ---------------------------------------------------------------------------

function createTestHistoryStoreContext(config: HistoryStoreConfig) {
  // Lazy import to avoid circular deps at module load time
  // eslint-disable-next-line ts/no-require-imports
  const { default: isDeepEqual } = require('fast-deep-equal')
  // eslint-disable-next-line ts/no-require-imports
  const { temporal } = require('zundo')
  // eslint-disable-next-line ts/no-require-imports
  const { create } = require('zustand')

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

  const store = create(temporal(
    (set: (partial: Partial<HistState>) => void, get: () => HistState) => ({
      workflowHistoryEvent: undefined,
      workflowHistoryEventMeta: undefined,
      nodes,
      edges,
      getNodes: () => get().nodes,
      setNodes: (n: Node[]) => set({ nodes: n }),
      setEdges: (e: Edge[]) => set({ edges: e }),
    }),
    { equality: (a: unknown, b: unknown) => isDeepEqual(a, b) },
  ))

  return {
    store,
    shortcutsEnabled: true,
    setShortcutsEnabled: () => {},
  }
}
