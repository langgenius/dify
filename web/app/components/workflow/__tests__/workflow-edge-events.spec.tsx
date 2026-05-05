import type { Edge, Node } from '../types'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { BaseEdge, internalsSymbol, Position, ReactFlowProvider, useStoreApi } from 'reactflow'
import { FlowType } from '@/types/common'
import { WORKFLOW_DATA_UPDATE } from '../constants'
import { Workflow } from '../index'
import { ControlMode } from '../types'
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

const collaborationBridge = vi.hoisted(() => ({
  graphImportHandler: null as null | ((payload: { nodes: Node[], edges: Edge[] }) => void),
  historyActionHandler: null as null | ((payload: unknown) => void),
}))

const toastInfoMock = vi.hoisted(() => vi.fn())

const workflowCommentState = vi.hoisted(() => ({
  comments: [] as Array<Record<string, unknown>>,
  pendingComment: null as null | { elementX: number, elementY: number },
  activeComment: null as null | Record<string, unknown>,
  activeCommentLoading: false,
  replySubmitting: false,
  replyUpdating: false,
  handleCommentSubmit: vi.fn(),
  handleCommentCancel: vi.fn(),
  handleCommentIconClick: vi.fn(),
  handleActiveCommentClose: vi.fn(),
  handleCommentResolve: vi.fn(),
  handleCommentDelete: vi.fn(async () => {}),
  handleCommentReply: vi.fn(),
  handleCommentReplyUpdate: vi.fn(),
  handleCommentReplyDelete: vi.fn(async () => {}),
  handleCommentPositionUpdate: vi.fn(),
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

vi.mock('@/next/navigation', () => ({
  useParams: () => ({
    appId: 'app-1',
  }),
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

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    info: toastInfoMock,
  },
}))

vi.mock('../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onGraphImport: (handler: (payload: { nodes: Node[], edges: Edge[] }) => void) => {
      collaborationBridge.graphImportHandler = handler
      return vi.fn()
    },
    onHistoryAction: (handler: (payload: unknown) => void) => {
      collaborationBridge.historyActionHandler = handler
      return vi.fn()
    },
  },
}))

vi.mock('../comment-manager', () => ({
  default: () => <div data-testid="comment-manager" />,
}))

vi.mock('../comment/cursor', () => ({
  CommentCursor: () => <div data-testid="comment-cursor" />,
}))

vi.mock('../comment/comment-input', () => ({
  CommentInput: ({ disabled, onCancel }: { disabled?: boolean, onCancel?: () => void }) => (
    <button
      type="button"
      data-testid={disabled ? 'comment-input-preview' : 'comment-input-active'}
      onClick={onCancel}
    >
      comment-input
    </button>
  ),
}))

vi.mock('../comment/comment-icon', () => ({
  CommentIcon: ({
    comment,
    onClick,
    onPositionUpdate,
  }: {
    comment: { id: string }
    onClick?: () => void
    onPositionUpdate?: (position: { elementX: number, elementY: number }) => void
  }) => (
    <button
      type="button"
      data-testid={`comment-icon-${comment.id}`}
      onClick={() => {
        onClick?.()
        onPositionUpdate?.({ elementX: 1, elementY: 2 })
      }}
    >
      icon
    </button>
  ),
}))

vi.mock('../comment/thread', () => ({
  CommentThread: ({
    onDelete,
    onReplyDelete,
    onNext,
  }: {
    onDelete?: () => void
    onReplyDelete?: (replyId: string) => void
    onNext?: () => void
  }) => (
    <div data-testid="comment-thread">
      <button type="button" onClick={onDelete}>delete-thread</button>
      <button type="button" onClick={() => onReplyDelete?.('reply-1')}>delete-reply</button>
      <button type="button" onClick={onNext}>next-comment</button>
    </div>
  ),
}))

vi.mock('../hooks/use-workflow-comment', () => ({
  useWorkflowComment: () => workflowCommentState,
}))

vi.mock('../base/confirm', () => ({
  default: ({
    isShow,
    title,
    desc,
    onConfirm,
    onCancel,
  }: {
    isShow: boolean
    title?: string
    desc?: string
    onConfirm: () => void
    onCancel: () => void
  }) => isShow
    ? (
        <div role="alertdialog" data-testid="confirm-dialog">
          {title && <div>{title}</div>}
          {desc && <div>{desc}</div>}
          <button type="button" onClick={onConfirm}>common.operation.confirm</button>
          <button type="button" onClick={onCancel}>common.operation.cancel</button>
        </div>
      )
    : null,
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
  NodeContextmenu: () => null,
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

vi.mock('../shortcuts/use-workflow-hotkeys', () => ({
  useWorkflowHotkeys: workflowHookMocks.useShortcuts,
  useWorkflowShortcut: vi.fn(),
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
  useLeaderRestoreListener: vi.fn(),
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
    collaborationBridge.graphImportHandler = null
    collaborationBridge.historyActionHandler = null
    workflowCommentState.comments = []
    workflowCommentState.pendingComment = null
    workflowCommentState.activeComment = null
    workflowCommentState.activeCommentLoading = false
    workflowCommentState.replySubmitting = false
    workflowCommentState.replyUpdating = false
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

  it('should render confirm description and clear showConfirm when cancelled', async () => {
    const onConfirm = vi.fn()
    const { store } = renderSubject({
      initialStoreState: {
        showConfirm: {
          title: 'Confirm title',
          desc: 'Confirm description',
          onConfirm,
        },
      },
    })

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Confirm title')).toBeInTheDocument()
    expect(screen.getByText('Confirm description')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(store.getState().showConfirm).toBeUndefined()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('should call showConfirm.onConfirm when confirm is clicked', () => {
    const onConfirm = vi.fn()

    renderSubject({
      initialStoreState: {
        showConfirm: {
          title: 'Confirm title',
          onConfirm,
        },
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('should sync graph import events and show history action toast', async () => {
    renderSubject()

    const importedNodes = [createInitializedNode('node-3', 480, 'Workflow node node-3')] as unknown as Node[]

    act(() => {
      collaborationBridge.graphImportHandler?.({
        nodes: importedNodes,
        edges: [],
      })
      collaborationBridge.historyActionHandler?.({ action: 'undo' })
    })

    await waitFor(() => {
      expect(screen.getByText('Workflow node node-3')).toBeInTheDocument()
      expect(toastInfoMock).toHaveBeenCalledTimes(1)
    })
  })

  it('should render comment overlays and execute comment actions in comment mode', async () => {
    workflowCommentState.comments = [
      { id: 'comment-1', resolved: false },
      { id: 'comment-2', resolved: false },
    ]
    workflowCommentState.activeComment = { id: 'comment-1', resolved: false }
    workflowCommentState.pendingComment = { elementX: 20, elementY: 30 }

    const { container, store } = renderSubject({
      initialStoreState: {
        controlMode: ControlMode.Comment,
        showUserComments: true,
        showResolvedComments: false,
        isCommentPlacing: true,
        pendingComment: null,
        isCommentPreviewHovering: true,
        mousePosition: {
          pageX: 100,
          pageY: 120,
          elementX: 40,
          elementY: 60,
        },
      },
    })

    const pane = getPane(container)
    act(() => {
      fireEvent.mouseMove(pane, { clientX: 150, clientY: 180 })
    })

    expect(screen.getByTestId('comment-cursor')).toBeInTheDocument()
    expect(screen.getByTestId('comment-input-preview')).toBeInTheDocument()
    expect(screen.getByTestId('comment-input-active')).toBeInTheDocument()
    expect(screen.getByTestId('comment-icon-comment-1')).toBeInTheDocument()
    expect(screen.getByTestId('comment-icon-comment-2')).toBeInTheDocument()
    expect(screen.getByTestId('comment-thread')).toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'next-comment' }))
    })
    expect(workflowCommentState.handleCommentIconClick).toHaveBeenCalledWith({ id: 'comment-2', resolved: false })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'delete-thread' }))
    })
    expect(store.getState().showConfirm).toBeDefined()

    await act(async () => {
      await store.getState().showConfirm?.onConfirm()
    })
    expect(workflowCommentState.handleCommentDelete).toHaveBeenCalledWith('comment-1')

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'delete-reply' }))
    })
    expect(store.getState().showConfirm).toBeDefined()
    await act(async () => {
      await store.getState().showConfirm?.onConfirm()
    })
    expect(workflowCommentState.handleCommentReplyDelete).toHaveBeenCalledWith('comment-1', 'reply-1')

    const wheelEvent = new WheelEvent('wheel', {
      cancelable: true,
      ctrlKey: true,
    })
    act(() => {
      window.dispatchEvent(wheelEvent)
    })

    const gestureEvent = new Event('gesturestart', { cancelable: true })
    act(() => {
      window.dispatchEvent(gestureEvent)
    })
  })
})
