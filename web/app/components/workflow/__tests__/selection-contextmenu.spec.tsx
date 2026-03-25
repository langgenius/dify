import type { Edge, Node } from '../types'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { useNodes } from 'reactflow'
import SelectionContextmenu from '../selection-contextmenu'
import { useWorkflowHistoryStore } from '../workflow-history-store'
import { createEdge, createNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

let latestNodes: Node[] = []
let latestHistoryEvent: string | undefined
const mockGetNodesReadOnly = vi.fn()

vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks')
  return {
    ...actual,
    useNodesReadOnly: () => ({
      getNodesReadOnly: mockGetNodesReadOnly,
    }),
  }
})

const RuntimeProbe = () => {
  latestNodes = useNodes() as Node[]
  const { store } = useWorkflowHistoryStore()

  useEffect(() => {
    latestHistoryEvent = store.getState().workflowHistoryEvent
    return store.subscribe((state) => {
      latestHistoryEvent = state.workflowHistoryEvent
    })
  }, [store])

  return null
}

const hooksStoreProps = {
  doSyncWorkflowDraft: vi.fn().mockResolvedValue(undefined),
}

const renderSelectionMenu = (options?: {
  nodes?: Node[]
  edges?: Edge[]
  initialStoreState?: Record<string, unknown>
}) => {
  latestNodes = []
  latestHistoryEvent = undefined

  const nodes = options?.nodes ?? []
  const edges = options?.edges ?? []

  return renderWorkflowFlowComponent(
    <div id="workflow-container" style={{ width: 800, height: 600 }}>
      <RuntimeProbe />
      <SelectionContextmenu />
    </div>,
    {
      nodes,
      edges,
      hooksStoreProps,
      historyStore: { nodes, edges },
      initialStoreState: options?.initialStoreState,
      reactFlowProps: { fitView: false },
    },
  )
}

describe('SelectionContextmenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestNodes = []
    latestHistoryEvent = undefined
    mockGetNodesReadOnly.mockReset()
    mockGetNodesReadOnly.mockReturnValue(false)
  })

  it('should not render when selectionMenu is absent', () => {
    renderSelectionMenu()

    expect(screen.queryByText('operator.vertical')).not.toBeInTheDocument()
  })

  it('should keep the menu inside the workflow container bounds', () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 80, height: 40 }),
      createNode({ id: 'n2', selected: true, position: { x: 140, y: 0 }, width: 80, height: 40 }),
    ]
    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ selectionMenu: { left: 780, top: 590 } })
    })

    const menu = screen.getByTestId('selection-contextmenu')
    expect(menu).toHaveStyle({ left: '540px', top: '210px' })
  })

  it('should close itself when only one node is selected', async () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 80, height: 40 }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ selectionMenu: { left: 120, top: 120 } })
    })

    await waitFor(() => {
      expect(store.getState().selectionMenu).toBeUndefined()
    })
  })

  it('should align selected nodes to the left and save history', async () => {
    vi.useFakeTimers()
    const nodes = [
      createNode({ id: 'n1', selected: true, position: { x: 20, y: 40 }, width: 40, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 140, y: 90 }, width: 60, height: 30 }),
    ]

    const { store } = renderSelectionMenu({
      nodes,
      edges: [createEdge({ source: 'n1', target: 'n2' })],
      initialStoreState: {
        helpLineHorizontal: { y: 10 } as never,
        helpLineVertical: { x: 10 } as never,
      },
    })

    act(() => {
      store.setState({ selectionMenu: { left: 100, top: 100 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-left'))

    expect(latestNodes.find(node => node.id === 'n1')?.position.x).toBe(20)
    expect(latestNodes.find(node => node.id === 'n2')?.position.x).toBe(20)
    expect(store.getState().selectionMenu).toBeUndefined()
    expect(store.getState().helpLineHorizontal).toBeUndefined()
    expect(store.getState().helpLineVertical).toBeUndefined()

    act(() => {
      store.getState().flushPendingSync()
      vi.advanceTimersByTime(600)
    })

    expect(hooksStoreProps.doSyncWorkflowDraft).toHaveBeenCalled()
    expect(latestHistoryEvent).toBe('NodeDragStop')
    vi.useRealTimers()
  })

  it('should distribute selected nodes horizontally', async () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, position: { x: 0, y: 10 }, width: 20, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 100, y: 20 }, width: 20, height: 20 }),
      createNode({ id: 'n3', selected: true, position: { x: 300, y: 30 }, width: 20, height: 20 }),
    ]

    const { store } = renderSelectionMenu({
      nodes,
    })

    act(() => {
      store.setState({ selectionMenu: { left: 160, top: 120 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-distributeHorizontal'))

    expect(latestNodes.find(node => node.id === 'n2')?.position.x).toBe(150)
  })

  it('should ignore child nodes when the selected container is aligned', async () => {
    const nodes = [
      createNode({
        id: 'container',
        selected: true,
        position: { x: 200, y: 0 },
        width: 100,
        height: 80,
        data: { _children: [{ nodeId: 'child', nodeType: 'code' as never }] },
      }),
      createNode({
        id: 'child',
        selected: true,
        position: { x: 210, y: 10 },
        width: 30,
        height: 20,
      }),
      createNode({
        id: 'other',
        selected: true,
        position: { x: 40, y: 60 },
        width: 40,
        height: 20,
      }),
    ]

    const { store } = renderSelectionMenu({
      nodes,
    })

    act(() => {
      store.setState({ selectionMenu: { left: 180, top: 120 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-left'))

    expect(latestNodes.find(node => node.id === 'container')?.position.x).toBe(40)
    expect(latestNodes.find(node => node.id === 'other')?.position.x).toBe(40)
    expect(latestNodes.find(node => node.id === 'child')?.position.x).toBe(210)
  })

  it('should cancel when align bounds cannot be resolved', () => {
    const nodes = [
      createNode({ id: 'n1', selected: true }),
      createNode({ id: 'n2', selected: true, position: { x: 80, y: 20 } }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ selectionMenu: { left: 100, top: 100 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-left'))

    expect(store.getState().selectionMenu).toBeUndefined()
  })

  it('should cancel without aligning when nodes are read only', () => {
    mockGetNodesReadOnly.mockReturnValue(true)
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 40, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 80, y: 20 }, width: 40, height: 20 }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ selectionMenu: { left: 100, top: 100 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-left'))

    expect(store.getState().selectionMenu).toBeUndefined()
    expect(latestNodes.find(node => node.id === 'n1')?.position.x).toBe(0)
    expect(latestNodes.find(node => node.id === 'n2')?.position.x).toBe(80)
  })

  it('should cancel when alignable nodes shrink to one item', () => {
    const nodes = [
      createNode({
        id: 'container',
        selected: true,
        width: 40,
        height: 20,
        data: { _children: [{ nodeId: 'child', nodeType: 'code' as never }] },
      }),
      createNode({ id: 'child', selected: true, position: { x: 80, y: 20 }, width: 40, height: 20 }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ selectionMenu: { left: 100, top: 100 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-left'))

    expect(store.getState().selectionMenu).toBeUndefined()
    expect(latestNodes.find(node => node.id === 'container')?.position.x).toBe(0)
    expect(latestNodes.find(node => node.id === 'child')?.position.x).toBe(80)
  })
})
