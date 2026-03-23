import type * as React from 'react'
import type { OnSelectionChangeParams } from 'reactflow'
import { act, waitFor } from '@testing-library/react'
import { useEdges, useNodes, useStoreApi } from 'reactflow'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { useSelectionInteractions } from '../use-selection-interactions'

type BundledState = {
  _isBundled?: boolean
}

const getBundledState = (item?: { data?: unknown }): BundledState =>
  (item?.data ?? {}) as BundledState

function createFlowNodes() {
  return [
    createNode({ id: 'n1', data: { _isBundled: true } }),
    createNode({ id: 'n2', position: { x: 100, y: 100 }, data: { _isBundled: true } }),
    createNode({ id: 'n3', position: { x: 200, y: 200 }, data: {} }),
  ]
}

function createFlowEdges() {
  return [
    createEdge({ id: 'e1', source: 'n1', target: 'n2', data: { _isBundled: true } }),
    createEdge({ id: 'e2', source: 'n2', target: 'n3', data: {} }),
  ]
}

function renderSelectionInteractions(initialStoreState?: Record<string, unknown>) {
  return renderWorkflowFlowHook(() => ({
    ...useSelectionInteractions(),
    nodes: useNodes(),
    edges: useEdges(),
    reactFlowStore: useStoreApi(),
  }), {
    nodes: createFlowNodes(),
    edges: createFlowEdges(),
    reactFlowProps: { fitView: false },
    initialStoreState,
  })
}

describe('useSelectionInteractions', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()

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

  it('handleSelectionStart should clear _isBundled from all nodes and edges', async () => {
    const { result } = renderSelectionInteractions()

    act(() => {
      result.current.handleSelectionStart()
    })

    await waitFor(() => {
      expect(result.current.nodes.every(node => !getBundledState(node)._isBundled)).toBe(true)
      expect(result.current.edges.every(edge => !getBundledState(edge)._isBundled)).toBe(true)
    })
  })

  it('handleSelectionChange should mark selected nodes as bundled', async () => {
    const { result } = renderSelectionInteractions()

    act(() => {
      result.current.reactFlowStore.setState({
        userSelectionRect: { x: 0, y: 0, width: 100, height: 100 },
      } as never)
    })

    act(() => {
      result.current.handleSelectionChange({
        nodes: [{ id: 'n1' }, { id: 'n3' }],
        edges: [],
      } as unknown as OnSelectionChangeParams)
    })

    await waitFor(() => {
      expect(getBundledState(result.current.nodes.find(node => node.id === 'n1'))._isBundled).toBe(true)
      expect(getBundledState(result.current.nodes.find(node => node.id === 'n2'))._isBundled).toBe(false)
      expect(getBundledState(result.current.nodes.find(node => node.id === 'n3'))._isBundled).toBe(true)
    })
  })

  it('handleSelectionChange should mark selected edges', async () => {
    const { result } = renderSelectionInteractions()

    act(() => {
      result.current.reactFlowStore.setState({
        userSelectionRect: { x: 0, y: 0, width: 100, height: 100 },
      } as never)
    })

    act(() => {
      result.current.handleSelectionChange({
        nodes: [],
        edges: [{ id: 'e1' }],
      } as unknown as OnSelectionChangeParams)
    })

    await waitFor(() => {
      expect(getBundledState(result.current.edges.find(edge => edge.id === 'e1'))._isBundled).toBe(true)
      expect(getBundledState(result.current.edges.find(edge => edge.id === 'e2'))._isBundled).toBe(false)
    })
  })

  it('handleSelectionDrag should sync node positions', async () => {
    const { result, store } = renderSelectionInteractions()
    const draggedNodes = [
      { id: 'n1', position: { x: 50, y: 60 }, data: {} },
    ] as never

    act(() => {
      result.current.handleSelectionDrag({} as unknown as React.MouseEvent, draggedNodes)
    })

    expect(store.getState().nodeAnimation).toBe(false)

    await waitFor(() => {
      expect(result.current.nodes.find(node => node.id === 'n1')?.position).toEqual({ x: 50, y: 60 })
      expect(result.current.nodes.find(node => node.id === 'n2')?.position).toEqual({ x: 100, y: 100 })
    })
  })

  it('handleSelectionCancel should clear all selection state', async () => {
    const { result } = renderSelectionInteractions()

    act(() => {
      result.current.reactFlowStore.setState({
        userSelectionRect: { x: 0, y: 0, width: 100, height: 100 },
        userSelectionActive: false,
      } as never)
    })

    act(() => {
      result.current.handleSelectionCancel()
    })

    expect(result.current.reactFlowStore.getState().userSelectionRect).toBeNull()
    expect(result.current.reactFlowStore.getState().userSelectionActive).toBe(true)

    await waitFor(() => {
      expect(result.current.nodes.every(node => !getBundledState(node)._isBundled)).toBe(true)
      expect(result.current.edges.every(edge => !getBundledState(edge)._isBundled)).toBe(true)
    })
  })

  it('handleSelectionContextMenu should set menu only when clicking on selection rect', () => {
    const { result, store } = renderSelectionInteractions({
      nodeMenu: { top: 10, left: 20, nodeId: 'n1' },
      panelMenu: { top: 30, left: 40 },
      edgeMenu: { clientX: 320, clientY: 180, edgeId: 'e1' },
    })

    const wrongTarget = document.createElement('div')
    wrongTarget.classList.add('some-other-class')

    act(() => {
      result.current.handleSelectionContextMenu({
        target: wrongTarget,
        preventDefault: vi.fn(),
        clientX: 300,
        clientY: 200,
      } as unknown as React.MouseEvent)
    })

    expect(store.getState().selectionMenu).toBeUndefined()

    const correctTarget = document.createElement('div')
    correctTarget.classList.add('react-flow__nodesselection-rect')

    act(() => {
      result.current.handleSelectionContextMenu({
        target: correctTarget,
        preventDefault: vi.fn(),
        clientX: 300,
        clientY: 200,
      } as unknown as React.MouseEvent)
    })

    expect(store.getState().selectionMenu).toEqual({
      top: 150,
      left: 200,
    })
    expect(store.getState().nodeMenu).toBeUndefined()
    expect(store.getState().panelMenu).toBeUndefined()
    expect(store.getState().edgeMenu).toBeUndefined()
  })

  it('handleSelectionContextmenuCancel should clear selectionMenu', () => {
    const { result, store } = renderSelectionInteractions({
      selectionMenu: { top: 50, left: 60 },
    })

    act(() => {
      result.current.handleSelectionContextmenuCancel()
    })

    expect(store.getState().selectionMenu).toBeUndefined()
  })
})
