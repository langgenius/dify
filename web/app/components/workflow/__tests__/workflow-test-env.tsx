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
import type { WorkflowRunningData } from '../types'
import { renderHook } from '@testing-library/react'
import * as React from 'react'
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

export function createTestHooksStore(props?: Partial<HooksStoreShape>): HooksStore {
  return createHooksStore(props ?? {})
}

// ---------------------------------------------------------------------------
// renderWorkflowHook — composable hook renderer
// ---------------------------------------------------------------------------

type WorkflowTestOptions<P> = Omit<RenderHookOptions<P>, 'wrapper'> & {
  initialStoreState?: Partial<Shape>
  hooksStoreProps?: Partial<HooksStoreShape>
}

type WorkflowTestResult<R, P> = RenderHookResult<R, P> & {
  store: WorkflowStore
  hooksStore?: HooksStore
}

export function renderWorkflowHook<R, P = undefined>(
  hook: (props: P) => R,
  options?: WorkflowTestOptions<P>,
): WorkflowTestResult<R, P> {
  const { initialStoreState, hooksStoreProps, ...rest } = options ?? {}

  const store = createTestWorkflowStore(initialStoreState)
  const hooksStore = hooksStoreProps !== undefined
    ? createTestHooksStore(hooksStoreProps)
    : undefined

  const wrapper = ({ children }: { children: React.ReactNode }) => {
    let tree = React.createElement(
      WorkflowContext.Provider,
      { value: store },
      children,
    )

    if (hooksStore) {
      tree = React.createElement(
        WorkflowContext.Provider,
        { value: store },
        React.createElement(HooksStoreContext.Provider, { value: hooksStore }, children),
      )
    }

    return tree
  }

  const renderResult = renderHook(hook, { wrapper, ...rest })
  return { ...renderResult, store, hooksStore }
}
