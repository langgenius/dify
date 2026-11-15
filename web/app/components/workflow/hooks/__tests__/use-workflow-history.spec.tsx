import { act } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useWorkflowHistory, WorkflowHistoryEvent } from '../use-workflow-history'

const nodes = [
  createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start', selected: true } }),
  createNode({ id: 'end', data: { type: BlockEnum.End, title: 'End' } }),
]
const edges = [createEdge({ id: 'connection', source: 'start', target: 'end', selected: true })]

it('coalesces saves across rerenders and supports undo, redo and callback removal for the saved graph', () => {
  vi.useFakeTimers()
  try {
    const { result, rerender } = renderWorkflowFlowHook(
      () => ({
        ...useWorkflowHistory(),
        graph: useStoreApi(),
      }),
      { nodes, edges, historyStore: { nodes, edges } },
    )
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    let unsubscribeUndo = () => {}
    let unsubscribeRedo = () => {}
    act(() => {
      unsubscribeUndo = result.current.onUndo(onUndo)
      unsubscribeRedo = result.current.onRedo(onRedo)
      result.current.saveStateToHistory(WorkflowHistoryEvent.NodeDragStop)
      vi.advanceTimersByTime(200)
    })
    rerender()
    act(() => {
      result.current.graph
        .getState()
        .setNodes(
          nodes.map((node) =>
            node.id === 'start' ? { ...node, data: { ...node.data, title: 'Updated' } } : node,
          ),
        )
      result.current.saveStateToHistory(WorkflowHistoryEvent.NodeTitleChange, { nodeId: 'start' })
      vi.advanceTimersByTime(499)
    })
    expect(result.current.store.getState().workflowHistoryEvent).toBeUndefined()
    act(() => vi.advanceTimersByTime(1))
    const saved = result.current.store.getState()
    expect(saved.workflowHistoryEvent).toBe(WorkflowHistoryEvent.NodeTitleChange)
    expect(saved.workflowHistoryEventMeta).toEqual({ nodeId: 'start' })
    expect(saved.nodes[0]?.data).toMatchObject({ title: 'Updated', selected: false })
    expect(saved.edges).toEqual([expect.objectContaining({ id: 'connection', selected: false })])

    act(() => result.current.undo())
    expect(result.current.store.getState().nodes[0]?.data.title).toBe('Start')
    expect(onUndo).toHaveBeenCalledTimes(1)
    act(() => result.current.redo())
    expect(result.current.store.getState()).toEqual(saved)
    expect(onRedo).toHaveBeenCalledTimes(1)
    act(() => {
      unsubscribeUndo()
      unsubscribeRedo()
    })
    act(() => result.current.undo())
    expect(result.current.store.getState().nodes[0]?.data.title).toBe('Start')
    act(() => result.current.redo())
    expect(result.current.store.getState()).toEqual(saved)
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(1)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})
