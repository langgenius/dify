import type { Shape as HooksStoreShape } from '../../hooks-store/store'
import { act, waitFor } from '@testing-library/react'
import { useReactFlow } from 'reactflow'
import { createLoopNode, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowOrganize } from '../use-workflow-organize'

const { getLayoutForChildNodes, getLayoutByELK } = vi.hoisted(() => ({
  getLayoutForChildNodes: vi.fn(),
  getLayoutByELK: vi.fn(),
}))

// ELK owns layout calculation; applying its result, permissions and persistence stay real.
vi.mock('../../utils/elk-layout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/elk-layout')>()),
  getLayoutForChildNodes,
  getLayoutByELK,
}))

const renderOrganize = (readOnly = false) => {
  const nodes = [
    createLoopNode({ id: 'loop-node', width: 200, height: 160 }),
    createNode({
      id: 'loop-child',
      parentId: 'loop-node',
      position: { x: 20, y: 20 },
      width: 100,
      height: 60,
    }),
    createNode({ id: 'top-node', position: { x: 400, y: 0 }, width: 240, height: 100 }),
  ]
  const doSyncWorkflowDraft = vi
    .fn<HooksStoreShape['doSyncWorkflowDraft']>()
    .mockResolvedValue(undefined)
  const view = renderWorkflowFlowHook(() => ({ ...useWorkflowOrganize(), flow: useReactFlow() }), {
    nodes,
    historyStore: { nodes, edges: [] },
    initialStoreState: { canvasReadOnly: readOnly },
    hooksStoreProps: { doSyncWorkflowDraft },
    reactFlowProps: { fitView: false, defaultViewport: { x: 40, y: 60, zoom: 1.2 } },
  })
  return { ...view, doSyncWorkflowDraft }
}

describe('useWorkflowOrganize', () => {
  beforeEach(() => {
    getLayoutForChildNodes.mockResolvedValue({
      bounds: { minX: 0, minY: 0, maxX: 320, maxY: 220 },
      nodes: new Map([['loop-child', { x: 40, y: 60, width: 100, height: 60 }]]),
    })
    getLayoutByELK.mockResolvedValue({
      nodes: new Map([
        ['loop-node', { x: 10, y: 20, width: 360, height: 260, layer: 0 }],
        ['top-node', { x: 500, y: 30, width: 240, height: 100, layer: 0 }],
      ]),
    })
  })

  it('applies layout and container bounds to the canvas and records the resulting graph', async () => {
    const { result, store, doSyncWorkflowDraft } = renderOrganize()
    await act(async () => result.current.handleLayout())

    expect(result.current.flow.getNode('loop-node')).toMatchObject({
      width: 440,
      height: 340,
      position: { x: 10, y: 20 },
      data: { width: 440, height: 340 },
    })
    expect(result.current.flow.getNode('loop-child')).toMatchObject({
      position: { x: 100, y: 120 },
    })
    expect(result.current.flow.getNode('top-node')).toMatchObject({ position: { x: 500, y: 100 } })
    expect(result.current.flow.getViewport()).toEqual({ x: 0, y: 0, zoom: 0.7 })
    await waitFor(() =>
      expect(store.getState().workflowHistory.workflowHistoryEvent).toBe('LayoutOrganize'),
    )
    expect(store.getState().workflowHistory.nodes).toMatchObject(result.current.flow.getNodes())
    act(() => store.getState().flushPendingSync())
    expect(doSyncWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('preserves the graph, viewport, history and draft when read only', async () => {
    const { result, store, doSyncWorkflowDraft } = renderOrganize(true)
    const before = result.current.flow.getNodes()
    const history = store.getState().workflowHistory
    await act(async () => result.current.handleLayout())
    act(() => store.getState().flushPendingSync())

    expect(result.current.flow.getNodes()).toEqual(before)
    expect(result.current.flow.getViewport()).toEqual({ x: 40, y: 60, zoom: 1.2 })
    expect(store.getState().workflowHistory).toEqual(history)
    expect(doSyncWorkflowDraft).not.toHaveBeenCalled()
  })
})
