import type { Edge, Node } from '../types'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { BaseEdge, internalsSymbol, Position, ReactFlowProvider, useStoreApi } from 'reactflow'
import { FlowType } from '@/types/common'
import { WORKFLOW_DATA_UPDATE } from '../constants'
import { Workflow } from '../index'
import { renderWorkflowComponent } from './workflow-test-env'

type WorkflowUpdateEvent = {
  type: string
  payload: {
    nodes: Node[]
    edges: Edge[]
  }
}

const eventEmitterState = vi.hoisted(() => ({
  subscription: null as null | ((payload: WorkflowUpdateEvent) => void),
}))

const reactFlowBridge = vi.hoisted(() => ({
  store: null as null | ReturnType<typeof useStoreApi>,
}))

const workflowHookMocks = vi.hoisted(() => ({
  handleNodeDragStart: vi.fn(),
  handleNodeDrag: vi.fn(),
  handleNodeDragStop: vi.fn(),
  handleNodeEnter: vi.fn(),
  handleNodeLeave: vi.fn(),
  handleNodeClick: vi.fn(),
  handleNodeConnect: vi.fn(),
  handleNodeConnectStart: vi.fn(),
  handleNodeConnectEnd: vi.fn(),
  handleNodeContextMenu: vi.fn(),
  handleHistoryBack: vi.fn(),
  handleHistoryForward: vi.fn(),
  handleEdgeEnter: vi.fn(),
  handleEdgeLeave: vi.fn(),
  handleEdgesChange: vi.fn(),
  handleEdgeContextMenu: vi.fn(),
  handleSelectionStart: vi.fn(),
  handleSelectionChange: vi.fn(),
  handleSelectionDrag: vi.fn(),
  handleSelectionContextMenu: vi.fn(),
  handlePaneContextMenu: vi.fn(),
  handleSyncWorkflowDraft: vi.fn(),
  fetchInspectVars: vi.fn(),
  isValidConnection: vi.fn(),
  useShortcuts: vi.fn(),
  useWorkflowSearch: vi.fn(),
}))

function createInitializedNode(id: string, x: number, label: string) {
  return {
    id,
    position: { x, y: 0 },
    positionAbsolute: { x, y: 0 },
    width: 160,
    height: 40,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { label },
    [internalsSymbol]: {
      positionAbsolute: { x, y: 0 },
      handleBounds: {
        source: [{
          id: null,
          nodeId: id,
          type: 'source',
          position: Position.Right,
          x: 160,
          y: 0,
          width: 0,
          height: 40,
        }],
        target: [{
          id: null,
          nodeId: id,
          type: 'target',
          position: Position.Left,
          x: 0,
          y: 0,
          width: 0,
          height: 40,
        }],
      },
      z: 0,
    },
  }
}

const baseNodes = [
  createInitializedNode('node-1', 0, 'Workflow node node-1'),
  createInitializedNode('node-2', 240, 'Workflow node node-2'),
] as unknown as Node[]

const baseEdges = [
  {
    id: 'edge-1',
    type: 'custom',
    source: 'node-1',
    target: 'node-2',
    data: { sourceType: 'start', targetType: 'end' },
  },
] as unknown as Edge[]

vi.mock('@/next/dynamic', () => ({
  default: () => () => null,
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: (handler: (payload: WorkflowUpdateEvent) => void) => {
        eventEmitterState.subscription = handler
      },
    },
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
}))

vi.mock('@/service/workflow', () => ({
  fetchAllInspectVars: vi.fn().mockResolvedValue([]),
}))

vi.mock('../candidate-node', () => ({
  default: () => null,
}))

vi.mock('../custom-connection-line', () => ({
  default: () => null,
}))

vi.mock('../custom-edge', () => ({
  default: () => React.createElement(BaseEdge, {
    id: 'edge-1',
    path: 'M 0 0 L 100 0',
  }),
}))

vi.mock('../help-line', () => ({
  default: () => null,
}))

vi.mock('../edge-contextmenu', () => ({
  default: () => null,
}))

vi.mock('../node-contextmenu', () => ({
  default: () => null,
}))

vi.mock('../nodes', () => ({
  default: ({ id }: { id: string }) => React.createElement('div', { 'data-testid': `workflow-node-${id}` }, `Workflow node ${id}`),
}))

vi.mock('../nodes/data-source-empty', () => ({
  default: () => null,
}))

vi.mock('../nodes/iteration-start', () => ({
  default: () => null,
}))

vi.mock('../nodes/loop-start', () => ({
  default: () => null,
}))

vi.mock('../note-node', () => ({
  default: () => null,
}))

vi.mock('../operator', () => ({
  default: () => null,
}))

vi.mock('../operator/control', () => ({
  default: () => null,
}))

vi.mock('../panel-contextmenu', () => ({
  default: () => null,
}))

vi.mock('../selection-contextmenu', () => ({
  default: () => null,
}))

vi.mock('../simple-node', () => ({
  default: () => null,
}))

vi.mock('../syncing-data-modal', () => ({
  default: () => null,
}))

vi.mock('../hooks', () => ({
  useEdgesInteractions: () => ({
    handleEdgeEnter: workflowHookMocks.handleEdgeEnter,
    handleEdgeLeave: workflowHookMocks.handleEdgeLeave,
    handleEdgesChange: workflowHookMocks.handleEdgesChange,
    handleEdgeContextMenu: workflowHookMocks.handleEdgeContextMenu,
  }),
  useNodesInteractions: () => ({
    handleNodeDragStart: workflowHookMocks.handleNodeDragStart,
    handleNodeDrag: workflowHookMocks.handleNodeDrag,
    handleNodeDragStop: workflowHookMocks.handleNodeDragStop,
    handleNodeEnter: workflowHookMocks.handleNodeEnter,
    handleNodeLeave: workflowHookMocks.handleNodeLeave,
    handleNodeClick: workflowHookMocks.handleNodeClick,
    handleNodeConnect: workflowHookMocks.handleNodeConnect,
    handleNodeConnectStart: workflowHookMocks.handleNodeConnectStart,
    handleNodeConnectEnd: workflowHookMocks.handleNodeConnectEnd,
    handleNodeContextMenu: workflowHookMocks.handleNodeContextMenu,
    handleHistoryBack: workflowHookMocks.handleHistoryBack,
    handleHistoryForward: workflowHookMocks.handleHistoryForward,
  }),
  useNodesReadOnly: () => ({
    nodesReadOnly: false,
    getNodesReadOnly: () => false,
  }),
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: workflowHookMocks.handleSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose: vi.fn(),
  }),
  usePanelInteractions: () => ({
    handlePaneContextMenu: workflowHookMocks.handlePaneContextMenu,
    handleEdgeContextmenuCancel: vi.fn(),
  }),
  useSelectionInteractions: () => ({
    handleSelectionStart: workflowHookMocks.handleSelectionStart,
    handleSelectionChange: workflowHookMocks.handleSelectionChange,
    handleSelectionDrag: workflowHookMocks.handleSelectionDrag,
    handleSelectionContextMenu: workflowHookMocks.handleSelectionContextMenu,
  }),
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: workflowHookMocks.fetchInspectVars,
  }),
  useShortcuts: workflowHookMocks.useShortcuts,
  useWorkflow: () => ({
    isValidConnection: workflowHookMocks.isValidConnection,
  }),
  useWorkflowReadOnly: () => ({
    workflowReadOnly: false,
  }),
  useWorkflowRefreshDraft: () => ({
    handleRefreshWorkflowDraft: vi.fn(),
  }),
}))

vi.mock('../hooks/use-workflow-search', () => ({
  useWorkflowSearch: workflowHookMocks.useWorkflowSearch,
}))

vi.mock('../nodes/_base/components/variable/use-match-schema-type', () => ({
  default: () => ({
    schemaTypeDefinitions: undefined,
  }),
}))

function renderSubject(options?: {
  nodes?: Node[]
  edges?: Edge[]
  initialStoreState?: Record<string, unknown>
}) {
  const { nodes = baseNodes, edges = baseEdges, initialStoreState } = options ?? {}

  return renderWorkflowComponent(
    <ReactFlowProvider>
      <Workflow
        nodes={nodes}
        edges={edges}
      >
        <ReactFlowEdgeBootstrap nodes={nodes} edges={edges} />
      </Workflow>
    </ReactFlowProvider>,
    {
      initialStoreState,
      hooksStoreProps: {
        configsMap: {
          flowId: 'flow-1',
          flowType: FlowType.appFlow,
          fileSettings: {},
        },
      },
    },
  )
}

function ReactFlowEdgeBootstrap({ nodes, edges }: { nodes: Node[], edges: Edge[] }) {
  const store = useStoreApi()

  React.useEffect(() => {
    store.setState({
      edges,
      width: 500,
      height: 500,
      nodeInternals: new Map(nodes.map(node => [node.id, node])),
    })
    reactFlowBridge.store = store

    return () => {
      reactFlowBridge.store = null
    }
  }, [edges, nodes, store])

  return null
}

function getPane(container: HTMLElement) {
  const pane = container.querySelector('.react-flow__pane') as HTMLElement | null

  if (!pane)
    throw new Error('Expected a rendered React Flow pane')

  return pane
}

describe('Workflow edge event wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventEmitterState.subscription = null
    reactFlowBridge.store = null
  })

  it('should forward pane, node and edge-change events to workflow handlers when emitted by the canvas', async () => {
    const { container } = renderSubject()
    const pane = getPane(container)

    act(() => {
      fireEvent.contextMenu(screen.getByText('Workflow node node-1'), { clientX: 24, clientY: 48 })
      fireEvent.contextMenu(pane, { clientX: 24, clientY: 48 })
    })

    await waitFor(() => {
      expect(reactFlowBridge.store?.getState().onEdgesChange).toBeTypeOf('function')
    })

    act(() => {
      reactFlowBridge.store?.getState().onEdgesChange?.([{ id: 'edge-1', type: 'select', selected: true }])
    })

    await waitFor(() => {
      expect(workflowHookMocks.handleEdgesChange).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ id: 'edge-1', type: 'select' }),
      ]))
      expect(workflowHookMocks.handleNodeContextMenu).toHaveBeenCalledWith(expect.objectContaining({
        clientX: 24,
        clientY: 48,
      }), expect.objectContaining({ id: 'node-1' }))
      expect(workflowHookMocks.handlePaneContextMenu).toHaveBeenCalledWith(expect.objectContaining({
        clientX: 24,
        clientY: 48,
      }))
    })
  })

  it('should keep edge deletion delegated to workflow shortcuts instead of React Flow defaults', async () => {
    renderSubject({
      edges: [
        {
          ...baseEdges[0],
          selected: true,
        } as Edge,
      ],
    })

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Delete' })
    })

    await waitFor(() => {
      expect(screen.getByText('Workflow node node-1')).toBeInTheDocument()
    })
    expect(workflowHookMocks.handleEdgesChange).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'edge-1', type: 'remove' }),
    ]))
  })

  it('should clear edgeMenu when workflow data updates remove the current edge', () => {
    const { store } = renderSubject({
      initialStoreState: {
        edgeMenu: {
          clientX: 320,
          clientY: 180,
          edgeId: 'edge-1',
        },
      },
    })

    act(() => {
      eventEmitterState.subscription?.({
        type: WORKFLOW_DATA_UPDATE,
        payload: {
          nodes: baseNodes,
          edges: [],
        },
      })
    })

    expect(store.getState().edgeMenu).toBeUndefined()
  })
})
