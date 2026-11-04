import type { WorkflowHistoryState } from '../store/workflow/history-slice'
import { renderHook } from '@testing-library/react'
import { WorkflowContext } from '../context'
import { createWorkflowStore } from '../store/workflow'
import { BlockEnum } from '../types'
import { useWorkflowHistoryStore } from '../workflow-history-store'
import { createEdge, createNode } from './fixtures'

const nodes = [
  createNode({ id: 'node-1', selected: true, data: { type: BlockEnum.Start, selected: true } }),
]
const edges = [createEdge({ id: 'edge-1', source: 'node-1', target: 'node-2', selected: true })]

const createWrapper = () => {
  const workflowStore = createWorkflowStore({})
  workflowStore.temporal.getState().pause()
  workflowStore.getState().setWorkflowHistory({
    nodes,
    edges,
    workflowHistoryEvent: undefined,
    workflowHistoryEventMeta: undefined,
  })
  workflowStore.temporal.getState().clear()
  workflowStore.temporal.getState().resume()

  return ({ children }: { children: React.ReactNode }) => (
    <WorkflowContext.Provider value={workflowStore}>{children}</WorkflowContext.Provider>
  )
}

describe('workflow history store', () => {
  it('sanitizes selected flags when history state is replaced through the exposed store api', () => {
    const wrapper = createWrapper()

    const { result } = renderHook(() => useWorkflowHistoryStore(), { wrapper })
    const nextState: WorkflowHistoryState = {
      workflowHistoryEvent: undefined,
      workflowHistoryEventMeta: undefined,
      nodes,
      edges,
    }

    result.current.store.setState(nextState)

    expect(result.current.store.getState().nodes[0]!.data.selected).toBe(false)
    expect(result.current.store.getState().edges[0]!.selected).toBe(false)
  })
})
