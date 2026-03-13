import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetReactFlowMockState, rfState } from './__tests__/reactflow-mock-state'
import { renderWorkflowComponent } from './__tests__/workflow-test-env'
import EdgeContextmenu from './edge-contextmenu'

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

  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: {} },
      { id: 'n2', position: { x: 100, y: 0 }, data: {} },
    ]
    rfState.edges = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        data: {},
        selected: true,
      } as typeof rfState.edges[number] & { selected: boolean },
      {
        id: 'e2',
        source: 'n2',
        target: 'n1',
        data: {},
      },
    ]
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
})
