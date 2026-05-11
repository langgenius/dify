import type { WorkflowHistoryState } from '../store/workflow/history-slice'
import type { Edge, Node } from '../types'
import { renderHook } from '@testing-library/react'
import { WorkflowContext } from '../context'
import { createWorkflowStore } from '../store/workflow'
import { BlockEnum } from '../types'
import { useWorkflowHistoryStore } from '../workflow-history-store'

const nodes: Node[] = [
  {
    id: 'node-1',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      title: 'Start',
      desc: '',
      type: BlockEnum.Start,
      selected: true,
    },
    selected: true,
  },
]

const edges: Edge[] = [
  {
    id: 'edge-1',
    source: 'node-1',
    target: 'node-2',
    sourceHandle: null,
    targetHandle: null,
    type: 'custom',
    selected: true,
    data: {
      sourceType: BlockEnum.Start,
      targetType: BlockEnum.End,
    },
  },
]

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
    <WorkflowContext.Provider value={workflowStore}>
      {children}
    </WorkflowContext.Provider>
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

  it('throws when consumed outside the provider', () => {
    expect(() => renderHook(() => useWorkflowHistoryStore())).toThrow(
      'Missing WorkflowContext.Provider in the tree',
    )
  })
})
