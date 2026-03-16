import type { EdgeChange, ReactFlowProps } from 'reactflow'
import type { Edge, Node } from '../types'
import { act, fireEvent, screen } from '@testing-library/react'
import * as React from 'react'
import { FlowType } from '@/types/common'
import { WORKFLOW_DATA_UPDATE } from '../constants'
import { Workflow } from '../index'
import { renderWorkflowComponent } from './workflow-test-env'

const reactFlowState = vi.hoisted(() => ({
  lastProps: null as ReactFlowProps | null,
}))

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

const baseNodes = [
  {
    id: 'node-1',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {},
  },
] as unknown as Node[]

const baseEdges = [
  {
    id: 'edge-1',
    source: 'node-1',
    target: 'node-2',
    data: { sourceType: 'start', targetType: 'end' },
  },
] as unknown as Edge[]

const edgeChanges: EdgeChange[] = [{ id: 'edge-1', type: 'remove' }]

function createMouseEvent() {
  return {
    preventDefault: vi.fn(),
    clientX: 24,
    clientY: 48,
  } as unknown as React.MouseEvent<Element, MouseEvent>
}

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

vi.mock('reactflow', async () => {
  const mod = await import('./reactflow-mock-state')
  const base = mod.createReactFlowModuleMock()
  const ReactFlowMock = (props: ReactFlowProps) => {
    reactFlowState.lastProps = props
    return React.createElement(
      'div',
      { 'data-testid': 'reactflow-mock' },
      React.createElement('button', {
        'type': 'button',
        'aria-label': 'Emit edge mouse enter',
        'onClick': () => props.onEdgeMouseEnter?.(createMouseEvent(), baseEdges[0]),
      }),
      React.createElement('button', {
        'type': 'button',
        'aria-label': 'Emit edge mouse leave',
        'onClick': () => props.onEdgeMouseLeave?.(createMouseEvent(), baseEdges[0]),
      }),
      React.createElement('button', {
        'type': 'button',
        'aria-label': 'Emit edges change',
        'onClick': () => props.onEdgesChange?.(edgeChanges),
      }),
      React.createElement('button', {
        'type': 'button',
        'aria-label': 'Emit edge context menu',
        'onClick': () => props.onEdgeContextMenu?.(createMouseEvent(), baseEdges[0]),
      }),
      React.createElement('button', {
        'type': 'button',
        'aria-label': 'Emit node context menu',
        'onClick': () => props.onNodeContextMenu?.(createMouseEvent(), baseNodes[0]),
      }),
      React.createElement('button', {
        'type': 'button',
        'aria-label': 'Emit pane context menu',
        'onClick': () => props.onPaneContextMenu?.(createMouseEvent()),
      }),
      props.children,
    )
  }

  return {
    ...base,
    SelectionMode: {
      Partial: 'partial',
    },
    ReactFlow: ReactFlowMock,
    default: ReactFlowMock,
  }
})

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
  default: () => null,
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
  default: () => null,
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

vi.mock('../workflow-history-store', () => ({
  WorkflowHistoryProvider: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))

function renderSubject() {
  return renderWorkflowComponent(
    <Workflow
      nodes={baseNodes}
      edges={baseEdges}
    />,
    {
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

describe('Workflow edge event wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reactFlowState.lastProps = null
    eventEmitterState.subscription = null
  })

  it('should forward React Flow edge events to workflow handlers when emitted by the canvas', () => {
    renderSubject()

    fireEvent.click(screen.getByRole('button', { name: 'Emit edge mouse enter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Emit edge mouse leave' }))
    fireEvent.click(screen.getByRole('button', { name: 'Emit edges change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Emit edge context menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Emit node context menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Emit pane context menu' }))

    expect(workflowHookMocks.handleEdgeEnter).toHaveBeenCalledWith(expect.objectContaining({
      clientX: 24,
      clientY: 48,
    }), baseEdges[0])
    expect(workflowHookMocks.handleEdgeLeave).toHaveBeenCalledWith(expect.objectContaining({
      clientX: 24,
      clientY: 48,
    }), baseEdges[0])
    expect(workflowHookMocks.handleEdgesChange).toHaveBeenCalledWith(edgeChanges)
    expect(workflowHookMocks.handleEdgeContextMenu).toHaveBeenCalledWith(expect.objectContaining({
      clientX: 24,
      clientY: 48,
    }), baseEdges[0])
    expect(workflowHookMocks.handleNodeContextMenu).toHaveBeenCalledWith(expect.objectContaining({
      clientX: 24,
      clientY: 48,
    }), baseNodes[0])
    expect(workflowHookMocks.handlePaneContextMenu).toHaveBeenCalledWith(expect.objectContaining({
      clientX: 24,
      clientY: 48,
    }))
  })

  it('should keep edge deletion delegated to workflow shortcuts instead of React Flow defaults', () => {
    renderSubject()

    expect(reactFlowState.lastProps?.deleteKeyCode).toBeNull()
  })

  it('should clear edgeMenu when workflow data updates remove the current edge', () => {
    const { store } = renderWorkflowComponent(
      <Workflow
        nodes={baseNodes}
        edges={baseEdges}
      />,
      {
        initialStoreState: {
          edgeMenu: {
            clientX: 320,
            clientY: 180,
            edgeId: 'edge-1',
          },
        },
        hooksStoreProps: {
          configsMap: {
            flowId: 'flow-1',
            flowType: FlowType.appFlow,
            fileSettings: {},
          },
        },
      },
    )

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
