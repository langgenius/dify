import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { resetReactFlowMockState, rfState } from './__tests__/reactflow-mock-state'
import { renderWorkflowComponent } from './__tests__/workflow-test-env'
import EdgeContextmenu from './edge-contextmenu'
import { useEdgesInteractions } from './hooks/use-edges-interactions'

vi.mock('reactflow', async () =>
  (await import('./__tests__/reactflow-mock-state')).createReactFlowModuleMock())

const mockSaveStateToHistory = vi.fn()

vi.mock('./hooks/use-workflow-history', () => ({
  useWorkflowHistory: () => ({ saveStateToHistory: mockSaveStateToHistory }),
  WorkflowHistoryEvent: {
    EdgeDelete: 'EdgeDelete',
    EdgeDeleteByDeleteBranch: 'EdgeDeleteByDeleteBranch',
    EdgeSourceHandleChange: 'EdgeSourceHandleChange',
  },
}))

vi.mock('./hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({
    getNodesReadOnly: () => false,
  }),
}))

vi.mock('./utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils')>()

  return {
    ...actual,
    getNodesConnectedSourceOrTargetHandleIdsMap: vi.fn(() => ({})),
  }
})

vi.mock('./hooks', async () => {
  const { useEdgesInteractions } = await import('./hooks/use-edges-interactions')
  const { usePanelInteractions } = await import('./hooks/use-panel-interactions')

  return {
    useEdgesInteractions,
    usePanelInteractions,
  }
})

describe('EdgeContextmenu', () => {
  const hooksStoreProps = {
    doSyncWorkflowDraft: vi.fn().mockResolvedValue(undefined),
  }
  type TestNode = typeof rfState.nodes[number] & {
    selected?: boolean
    data: {
      selected?: boolean
      _isBundled?: boolean
    }
  }
  type TestEdge = typeof rfState.edges[number] & {
    selected?: boolean
  }
  const createNode = (id: string, selected = false): TestNode => ({
    id,
    position: { x: 0, y: 0 },
    data: { selected },
    selected,
  })
  const createEdge = (id: string, selected = false): TestEdge => ({
    id,
    source: 'n1',
    target: 'n2',
    data: {},
    selected,
  })

  const EdgeMenuHarness = () => {
    const { handleEdgeContextMenu, handleEdgeDelete } = useEdgesInteractions()

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
        <button
          type="button"
          aria-label="Right-click edge e1"
          onContextMenu={e => handleEdgeContextMenu(e as never, rfState.edges.find(edge => edge.id === 'e1') as never)}
        >
          edge-e1
        </button>
        <button
          type="button"
          aria-label="Right-click edge e2"
          onContextMenu={e => handleEdgeContextMenu(e as never, rfState.edges.find(edge => edge.id === 'e2') as never)}
        >
          edge-e2
        </button>
        <EdgeContextmenu />
      </div>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    rfState.nodes = [
      createNode('n1'),
      createNode('n2'),
    ]
    rfState.edges = [
      createEdge('e1', true) as typeof rfState.edges[number] & { selected: boolean },
      createEdge('e2'),
    ]
    rfState.setNodes.mockImplementation((nextNodes) => {
      rfState.nodes = nextNodes as typeof rfState.nodes
    })
    rfState.setEdges.mockImplementation((nextEdges) => {
      rfState.edges = nextEdges as typeof rfState.edges
    })
  })

  it('should not render when edgeMenu is absent', () => {
    renderWorkflowComponent(<EdgeContextmenu />, {
      hooksStoreProps,
    })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('should delete the menu edge and close the menu when another edge is selected', async () => {
    const user = userEvent.setup()
    ;(rfState.edges[0] as Record<string, unknown>).selected = true
    ;(rfState.edges[1] as Record<string, unknown>).selected = false

    const { store } = renderWorkflowComponent(<EdgeContextmenu />, {
      initialStoreState: {
        edgeMenu: {
          clientX: 320,
          clientY: 180,
          edgeId: 'e2',
        },
      },
      hooksStoreProps,
    })

    const deleteAction = await screen.findByRole('menuitem', { name: /common:operation\.delete/i })
    expect(screen.getByText(/^del$/i)).toBeInTheDocument()

    await user.click(deleteAction)

    const updatedEdges = rfState.setEdges.mock.calls.at(-1)?.[0]
    expect(updatedEdges).toHaveLength(1)
    expect(updatedEdges[0].id).toBe('e1')
    expect(updatedEdges[0].selected).toBe(true)
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('EdgeDelete')

    await waitFor(() => {
      expect(store.getState().edgeMenu).toBeUndefined()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('should not render the menu when the referenced edge no longer exists', () => {
    renderWorkflowComponent(<EdgeContextmenu />, {
      initialStoreState: {
        edgeMenu: {
          clientX: 320,
          clientY: 180,
          edgeId: 'missing-edge',
        },
      },
      hooksStoreProps,
    })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('should open the edge menu at the right-click position', async () => {
    const fromRectSpy = vi.spyOn(DOMRect, 'fromRect')

    renderWorkflowComponent(<EdgeMenuHarness />, {
      hooksStoreProps,
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Right-click edge e2' }), {
      clientX: 320,
      clientY: 180,
    })

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /common:operation\.delete/i })).toBeInTheDocument()
    expect(fromRectSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      x: 320,
      y: 180,
      width: 0,
      height: 0,
    }))
  })

  it('should delete the right-clicked edge and close the menu when delete is clicked', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(<EdgeMenuHarness />, {
      hooksStoreProps,
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Right-click edge e2' }), {
      clientX: 320,
      clientY: 180,
    })

    await user.click(await screen.findByRole('menuitem', { name: /common:operation\.delete/i }))

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
    expect(rfState.edges.map(edge => edge.id)).toEqual(['e1'])
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('EdgeDelete')
  })

  it.each([
    ['Delete', 'Delete'],
    ['Backspace', 'Backspace'],
  ])('should delete the right-clicked edge with %s after switching from a selected node', async (_, key) => {
    renderWorkflowComponent(<EdgeMenuHarness />, {
      hooksStoreProps,
    })
    rfState.nodes = [createNode('n1', true), createNode('n2')]

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Right-click edge e2' }), {
      clientX: 240,
      clientY: 120,
    })

    expect(await screen.findByRole('menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key })

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
    expect(rfState.edges.map(edge => edge.id)).toEqual(['e1'])
    expect(rfState.nodes.map(node => node.id)).toEqual(['n1', 'n2'])
    expect((rfState.nodes as TestNode[]).every(node => !node.selected && !node.data.selected)).toBe(true)
  })

  it('should keep bundled multi-selection nodes intact when delete runs after right-clicking an edge', async () => {
    renderWorkflowComponent(<EdgeMenuHarness />, {
      hooksStoreProps,
    })
    rfState.nodes = [
      { ...createNode('n1', true), data: { selected: true, _isBundled: true } },
      { ...createNode('n2', true), data: { selected: true, _isBundled: true } },
    ]

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Right-click edge e1' }), {
      clientX: 200,
      clientY: 100,
    })

    expect(await screen.findByRole('menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Delete' })

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
    expect(rfState.edges.map(edge => edge.id)).toEqual(['e2'])
    expect(rfState.nodes).toHaveLength(2)
    expect((rfState.nodes as TestNode[]).every(node => !node.selected && !node.data.selected && !node.data._isBundled)).toBe(true)
  })

  it('should retarget the menu and selected edge when right-clicking a different edge', async () => {
    const fromRectSpy = vi.spyOn(DOMRect, 'fromRect')

    renderWorkflowComponent(<EdgeMenuHarness />, {
      hooksStoreProps,
    })
    const edgeOneButton = screen.getByLabelText('Right-click edge e1')
    const edgeTwoButton = screen.getByLabelText('Right-click edge e2')

    fireEvent.contextMenu(edgeOneButton, {
      clientX: 80,
      clientY: 60,
    })
    expect(await screen.findByRole('menu')).toBeInTheDocument()

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
      expect((rfState.edges as TestEdge[]).find(edge => edge.id === 'e1')?.selected).toBe(false)
      expect((rfState.edges as TestEdge[]).find(edge => edge.id === 'e2')?.selected).toBe(true)
    })
  })

  it('should hide the menu when the target edge disappears after opening it', async () => {
    const { store } = renderWorkflowComponent(<EdgeMenuHarness />, {
      hooksStoreProps,
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Right-click edge e1' }), {
      clientX: 160,
      clientY: 100,
    })
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    rfState.edges = [createEdge('e2')]
    store.setState({
      edgeMenu: {
        clientX: 160,
        clientY: 100,
        edgeId: 'e1',
      },
    })

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })
})
