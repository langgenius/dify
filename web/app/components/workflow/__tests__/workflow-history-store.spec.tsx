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
  it('deduplicates cloned graphs and preserves nested edits through undo and redo', () => {
    const store = createWorkflowStore({})
    const history: WorkflowHistoryState = {
      nodes: [
        createNode({
          id: 'llm',
          data: {
            type: BlockEnum.LLM,
            model: { name: 'gpt-4.1', completion_params: { temperature: 0.2 } },
          },
        }),
      ],
      edges: [createEdge({ id: 'connection', source: 'start', target: 'llm' })],
      workflowHistoryEvent: undefined,
    }
    store.temporal.getState().pause()
    store.getState().initializeWorkflowHistory(history)
    store.temporal.getState().resume()

    const equivalentGraph = structuredClone(history)
    // Signed zero represents the same canvas position.
    equivalentGraph.nodes[0]!.position.x = -0
    store.getState().setWorkflowHistory(equivalentGraph)
    expect(store.temporal.getState().pastStates).toHaveLength(0)

    const edited = structuredClone(history)
    edited.nodes[0] = createNode({
      ...edited.nodes[0],
      data: {
        ...edited.nodes[0]!.data,
        model: { name: 'gpt-4.1', completion_params: { temperature: 0.8 } },
      },
    })
    store.getState().setWorkflowHistory(edited)
    store.getState().setWorkflowHistory(structuredClone(edited))
    expect(store.temporal.getState().pastStates).toHaveLength(1)

    store.temporal.getState().undo()
    expect(store.getState().workflowHistory).toEqual(equivalentGraph)
    store.temporal.getState().redo()
    expect(store.getState().workflowHistory).toEqual(edited)
  })

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
