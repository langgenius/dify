import type * as React from 'react'
import type { Node, OnSelectionChangeParams } from 'reactflow'
import type { MockEdge, MockNode } from '../../__tests__/reactflow-mock-state'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useSelectionInteractions } from '../use-selection-interactions'

const rfStoreExtra = vi.hoisted(() => ({
  userSelectionRect: null as { x: number, y: number, width: number, height: number } | null,
  userSelectionActive: false,
  resetSelectedElements: vi.fn(),
  setState: vi.fn(),
}))

vi.mock('reactflow', async () => {
  const mod = await import('../../__tests__/reactflow-mock-state')
  const base = mod.createReactFlowModuleMock()
  return {
    ...base,
    useStoreApi: vi.fn(() => ({
      getState: () => ({
        getNodes: () => mod.rfState.nodes,
        setNodes: mod.rfState.setNodes,
        edges: mod.rfState.edges,
        setEdges: mod.rfState.setEdges,
        transform: mod.rfState.transform,
        userSelectionRect: rfStoreExtra.userSelectionRect,
        userSelectionActive: rfStoreExtra.userSelectionActive,
        resetSelectedElements: rfStoreExtra.resetSelectedElements,
      }),
      setState: rfStoreExtra.setState,
      subscribe: vi.fn().mockReturnValue(vi.fn()),
    })),
  }
})

describe('useSelectionInteractions', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    resetReactFlowMockState()
    rfStoreExtra.userSelectionRect = null
    rfStoreExtra.userSelectionActive = false
    rfStoreExtra.resetSelectedElements = vi.fn()
    rfStoreExtra.setState.mockReset()

    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: { _isBundled: true } },
      { id: 'n2', position: { x: 100, y: 100 }, data: { _isBundled: true } },
      { id: 'n3', position: { x: 200, y: 200 }, data: {} },
    ]
    rfState.edges = [
      { id: 'e1', source: 'n1', target: 'n2', data: { _isBundled: true } },
      { id: 'e2', source: 'n2', target: 'n3', data: {} },
    ]

    container = document.createElement('div')
    container.id = 'workflow-container'
    container.getBoundingClientRect = vi.fn().mockReturnValue({
      x: 100,
      y: 50,
      width: 800,
      height: 600,
      top: 50,
      right: 900,
      bottom: 650,
      left: 100,
    })
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('handleSelectionStart should clear _isBundled from all nodes and edges', () => {
    const { result } = renderWorkflowHook(() => useSelectionInteractions())

    result.current.handleSelectionStart()

    const updatedNodes = rfState.setNodes.mock.calls[0][0] as MockNode[]
    expect(updatedNodes.every(n => !n.data._isBundled)).toBe(true)

    const updatedEdges = rfState.setEdges.mock.calls[0][0] as MockEdge[]
    expect(updatedEdges.every(e => !e.data._isBundled)).toBe(true)
  })

  it('handleSelectionChange should mark selected nodes as bundled', () => {
    rfStoreExtra.userSelectionRect = { x: 0, y: 0, width: 100, height: 100 }

    const { result } = renderWorkflowHook(() => useSelectionInteractions())

    result.current.handleSelectionChange({
      nodes: [{ id: 'n1' }, { id: 'n3' }],
      edges: [],
    } as unknown as OnSelectionChangeParams)

    const updatedNodes = rfState.setNodes.mock.calls[0][0] as MockNode[]
    expect(updatedNodes.find(n => n.id === 'n1')!.data._isBundled).toBe(true)
    expect(updatedNodes.find(n => n.id === 'n2')!.data._isBundled).toBe(false)
    expect(updatedNodes.find(n => n.id === 'n3')!.data._isBundled).toBe(true)
  })

  it('handleSelectionChange should mark selected edges', () => {
    rfStoreExtra.userSelectionRect = { x: 0, y: 0, width: 100, height: 100 }

    const { result } = renderWorkflowHook(() => useSelectionInteractions())

    result.current.handleSelectionChange({
      nodes: [],
      edges: [{ id: 'e1' }],
    } as unknown as OnSelectionChangeParams)

    const updatedEdges = rfState.setEdges.mock.calls[0][0] as MockEdge[]
    expect(updatedEdges.find(e => e.id === 'e1')!.data._isBundled).toBe(true)
    expect(updatedEdges.find(e => e.id === 'e2')!.data._isBundled).toBe(false)
  })

  it('handleSelectionDrag should sync node positions', () => {
    const { result, store } = renderWorkflowHook(() => useSelectionInteractions())

    const draggedNodes = [
      { id: 'n1', position: { x: 50, y: 60 }, data: {} },
    ] as unknown as Node[]

    result.current.handleSelectionDrag({} as unknown as React.MouseEvent, draggedNodes)

    expect(store.getState().nodeAnimation).toBe(false)

    const updatedNodes = rfState.setNodes.mock.calls[0][0] as MockNode[]
    expect(updatedNodes.find(n => n.id === 'n1')!.position).toEqual({ x: 50, y: 60 })
    expect(updatedNodes.find(n => n.id === 'n2')!.position).toEqual({ x: 100, y: 100 })
  })

  it('handleSelectionCancel should clear all selection state', () => {
    const { result } = renderWorkflowHook(() => useSelectionInteractions())

    result.current.handleSelectionCancel()

    expect(rfStoreExtra.setState).toHaveBeenCalledWith({
      userSelectionRect: null,
      userSelectionActive: true,
    })

    const updatedNodes = rfState.setNodes.mock.calls[0][0] as MockNode[]
    expect(updatedNodes.every(n => !n.data._isBundled)).toBe(true)

    const updatedEdges = rfState.setEdges.mock.calls[0][0] as MockEdge[]
    expect(updatedEdges.every(e => !e.data._isBundled)).toBe(true)
  })

  it('handleSelectionContextMenu should set menu only when clicking on selection rect', () => {
    const { result, store } = renderWorkflowHook(() => useSelectionInteractions())

    const wrongTarget = document.createElement('div')
    wrongTarget.classList.add('some-other-class')
    result.current.handleSelectionContextMenu({
      target: wrongTarget,
      preventDefault: vi.fn(),
      clientX: 300,
      clientY: 200,
    } as unknown as React.MouseEvent)

    expect(store.getState().selectionMenu).toBeUndefined()

    const correctTarget = document.createElement('div')
    correctTarget.classList.add('react-flow__nodesselection-rect')
    result.current.handleSelectionContextMenu({
      target: correctTarget,
      preventDefault: vi.fn(),
      clientX: 300,
      clientY: 200,
    } as unknown as React.MouseEvent)

    expect(store.getState().selectionMenu).toEqual({
      top: 150,
      left: 200,
    })
  })

  it('handleSelectionContextmenuCancel should clear selectionMenu', () => {
    const { result, store } = renderWorkflowHook(() => useSelectionInteractions(), {
      initialStoreState: { selectionMenu: { top: 50, left: 60 } },
    })

    result.current.handleSelectionContextmenuCancel()

    expect(store.getState().selectionMenu).toBeUndefined()
  })
})
