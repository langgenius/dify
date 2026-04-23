import type { Edge, Node } from '../types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { useEdges, useNodes, useStoreApi } from 'reactflow'
import { createEdge, createNode } from '../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../__tests__/workflow-test-env'
import EdgeContextmenu from '../edge-contextmenu'
import { useEdgesInteractions } from '../hooks/use-edges-interactions'

const mockSaveStateToHistory = vi.fn()

vi.mock('../hooks/use-workflow-history', () => ({
  useWorkflowHistory: () => ({ saveStateToHistory: mockSaveStateToHistory }),
  WorkflowHistoryEvent: {
    EdgeDelete: 'EdgeDelete',
    EdgeDeleteByDeleteBranch: 'EdgeDeleteByDeleteBranch',
    EdgeSourceHandleChange: 'EdgeSourceHandleChange',
  },
}))

vi.mock('../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({
    getNodesReadOnly: () => false,
  }),
}))

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>()

  return {
    ...actual,
    getNodesConnectedSourceOrTargetHandleIdsMap: vi.fn(() => ({})),
  }
})

vi.mock('../hooks', async () => {
  const { useEdgesInteractions } = await import('../hooks/use-edges-interactions')
  const { usePanelInteractions } = await import('../hooks/use-panel-interactions')

  return {
    useEdgesInteractions,
    usePanelInteractions,
  }
})

type EdgeRuntimeState = {
  _hovering?: boolean
  _isBundled?: boolean
}

type NodeRuntimeState = {
  selected?: boolean
  _isBundled?: boolean
}

const getEdgeRuntimeState = (edge?: Edge): EdgeRuntimeState =>
  (edge?.data ?? {}) as EdgeRuntimeState

const getNodeRuntimeState = (node?: Node): NodeRuntimeState =>
  (node?.data ?? {}) as NodeRuntimeState

function createFlowNodes() {
  return [
    createNode({ id: 'n1' }),
    createNode({ id: 'n2', position: { x: 100, y: 0 } }),
  ]
}

function createFlowEdges() {
  return [
    createEdge({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      sourceHandle: 'branch-a',
      data: { _hovering: false },
      selected: true,
    }),
    createEdge({
      id: 'e2',
      source: 'n1',
      target: 'n2',
      sourceHandle: 'branch-b',
      data: { _hovering: false },
    }),
  ]
}

let latestNodes: Node[] = []
let latestEdges: Edge[] = []

const RuntimeProbe = () => {
  latestNodes = useNodes() as Node[]
  latestEdges = useEdges() as Edge[]

  return null
}

const hooksStoreProps = {
  doSyncWorkflowDraft: vi.fn().mockResolvedValue(undefined),
}

const EdgeMenuHarness = () => {
  const { handleEdgeContextMenu, handleEdgeDelete } = useEdgesInteractions()
  const edges = useEdges() as Edge[]
  const reactFlowStore = useStoreApi()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace')
        return

      e.preventDefault()
      handleEdgeDelete()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleEdgeDelete])

  return (
    <div>
      <RuntimeProbe />
      <button
        type="button"
        aria-label="Right-click edge e1"
        onContextMenu={e => handleEdgeContextMenu(e as never, edges.find(edge => edge.id === 'e1') as never)}
      >
        edge-e1
      </button>
      <button
        type="button"
        aria-label="Right-click edge e2"
        onContextMenu={e => handleEdgeContextMenu(e as never, edges.find(edge => edge.id === 'e2') as never)}
      >
        edge-e2
      </button>
      <button
        type="button"
        aria-label="Remove edge e1"
        onClick={() => {
          const { edges, setEdges } = reactFlowStore.getState()
          setEdges(edges.filter(edge => edge.id !== 'e1'))
        }}
      >
        remove-e1
      </button>
      <EdgeContextmenu />
    </div>
  )
}

function renderEdgeMenu(options?: {
  nodes?: Node[]
  edges?: Edge[]
  initialStoreState?: Record<string, unknown>
}) {
  const { nodes = createFlowNodes(), edges = createFlowEdges(), initialStoreState } = options ?? {}

  return renderWorkflowFlowComponent(<EdgeMenuHarness />, {
    nodes,
    edges,
    initialStoreState,
    hooksStoreProps,
    reactFlowProps: { fitView: false },
  })
}

describe('EdgeContextmenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestNodes = []
    latestEdges = []
  })

  it('should not render when edgeMenu is absent', () => {
    renderWorkflowFlowComponent(<EdgeContextmenu />, {
      nodes: createFlowNodes(),
      edges: createFlowEdges(),
      hooksStoreProps,
      reactFlowProps: { fitView: false },
    })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('should delete the menu edge and close the menu when another edge is selected', async () => {
    const user = userEvent.setup()
    const { store } = renderEdgeMenu({
      edges: [
        createEdge({
          id: 'e1',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'branch-a',
          selected: true,
          data: { _hovering: false },
        }),
        createEdge({
          id: 'e2',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'branch-b',
          selected: false,
          data: { _hovering: false },
        }),
      ],
      initialStoreState: {
        edgeMenu: {
          clientX: 320,
          clientY: 180,
          edgeId: 'e2',
        },
      },
    })

    const deleteAction = await screen.findByRole('menuitem', { name: /common:operation\.delete/i })

    await user.click(deleteAction)

    await waitFor(() => {
      expect(latestEdges).toHaveLength(1)
      expect(latestEdges[0]!.id).toBe('e1')
      expect(latestEdges[0]!.selected).toBe(true)
      expect(store.getState().edgeMenu).toBeUndefined()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('EdgeDelete')
  })

  it('should not render the menu when the referenced edge no longer exists', () => {
    renderWorkflowFlowComponent(<EdgeContextmenu />, {
      nodes: createFlowNodes(),
      edges: createFlowEdges(),
      initialStoreState: {
        edgeMenu: {
          clientX: 320,
          clientY: 180,
          edgeId: 'missing-edge',
        },
      },
      hooksStoreProps,
      reactFlowProps: { fitView: false },
    })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('should open the edge menu at the right-click position', async () => {
    const fromRectSpy = vi.spyOn(DOMRect, 'fromRect')

    renderEdgeMenu()

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Right-click edge e2' }), {
      clientX: 320,
      clientY: 180,
    })

    expect(await screen.findByRole('menu'))!.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /common:operation\.delete/i }))!.toBeInTheDocument()
    expect(fromRectSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      x: 320,
      y: 180,
      width: 0,
      height: 0,
    }))
  })

  it('should delete the right-clicked edge and close the menu when delete is clicked', async () => {
    const user = userEvent.setup()

    renderEdgeMenu()

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Right-click edge e2' }), {
      clientX: 320,
      clientY: 180,
    })

    await user.click(await screen.findByRole('menuitem', { name: /common:operation\.delete/i }))

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(latestEdges.map(edge => edge.id)).toEqual(['e1'])
    })
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('EdgeDelete')
  })

  it.each([
    ['Delete', 'Delete'],
    ['Backspace', 'Backspace'],
  ])('should delete the right-clicked edge with %s after switching from a selected node', async (_, key) => {
    renderEdgeMenu({
      nodes: [
        createNode({
          id: 'n1',
          selected: true,
          data: { selected: true, _isBundled: true },
        }),
        createNode({
          id: 'n2',
          position: { x: 100, y: 0 },
        }),
      ],
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Right-click edge e2' }), {
      clientX: 240,
      clientY: 120,
    })

    expect(await screen.findByRole('menu'))!.toBeInTheDocument()

    fireEvent.keyDown(document.body, { key })

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(latestEdges.map(edge => edge.id)).toEqual(['e1'])
      expect(latestNodes.map(node => node.id)).toEqual(['n1', 'n2'])
      expect(latestNodes.every(node => !node.selected && !getNodeRuntimeState(node).selected)).toBe(true)
    })
  })

  it('should keep bundled multi-selection nodes intact when delete runs after right-clicking an edge', async () => {
    renderEdgeMenu({
      nodes: [
        createNode({
          id: 'n1',
          selected: true,
          data: { selected: true, _isBundled: true },
        }),
        createNode({
          id: 'n2',
          position: { x: 100, y: 0 },
          selected: true,
          data: { selected: true, _isBundled: true },
        }),
      ],
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Right-click edge e1' }), {
      clientX: 200,
      clientY: 100,
    })

    expect(await screen.findByRole('menu'))!.toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Delete' })

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(latestEdges.map(edge => edge.id)).toEqual(['e2'])
      expect(latestNodes).toHaveLength(2)
      expect(latestNodes.every(node =>
        !node.selected
        && !getNodeRuntimeState(node).selected
        && !getNodeRuntimeState(node)._isBundled,
      )).toBe(true)
    })
  })

  it('should retarget the menu and selected edge when right-clicking a different edge', async () => {
    const fromRectSpy = vi.spyOn(DOMRect, 'fromRect')

    renderEdgeMenu()
    const edgeOneButton = screen.getByLabelText('Right-click edge e1')
    const edgeTwoButton = screen.getByLabelText('Right-click edge e2')

    fireEvent.contextMenu(edgeOneButton, {
      clientX: 80,
      clientY: 60,
    })
    expect(await screen.findByRole('menu'))!.toBeInTheDocument()

    fireEvent.contextMenu(edgeTwoButton, {
      clientX: 360,
      clientY: 240,
    })

    await waitFor(() => {
      expect(screen.getAllByRole('menu')).toHaveLength(1)
      expect(fromRectSpy).toHaveBeenLastCalledWith(expect.objectContaining({
        x: 360,
        y: 240,
      }))
      expect(latestEdges.find(edge => edge.id === 'e1')?.selected).toBe(false)
      expect(latestEdges.find(edge => edge.id === 'e2')?.selected).toBe(true)
      expect(latestEdges.every(edge => !getEdgeRuntimeState(edge)._isBundled)).toBe(true)
    })
  })

  it('should hide the menu when the target edge disappears after opening it', async () => {
    const { container } = renderEdgeMenu()

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Right-click edge e1' }), {
      clientX: 160,
      clientY: 100,
    })
    expect(await screen.findByRole('menu'))!.toBeInTheDocument()

    fireEvent.click(container.querySelector('button[aria-label="Remove edge e1"]') as HTMLButtonElement)

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })
})
