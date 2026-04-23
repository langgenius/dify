import type { Edge, Node } from '../../types'
import { act } from '@testing-library/react'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { collaborationManager } from '../../collaboration/core/collaboration-manager'
import { CUSTOM_NOTE_NODE } from '../../note-node/constants'
import { BlockEnum, ControlMode } from '../../types'
import { useNodesInteractions } from '../use-nodes-interactions'

const mockHandleSyncWorkflowDraft = vi.hoisted(() => vi.fn())
const mockSaveStateToHistory = vi.hoisted(() => vi.fn())
const mockUndo = vi.hoisted(() => vi.fn())
const mockRedo = vi.hoisted(() => vi.fn())
const mockHandleNodeIterationChildrenCopy = vi.hoisted(() => vi.fn(() => ({
  copyChildren: [],
  newIdMapping: {},
})))
const mockHandleNodeLoopChildrenCopy = vi.hoisted(() => vi.fn(() => ({
  copyChildren: [],
  newIdMapping: {},
})))
const runtimeNodesMetaDataMap = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}))

const runtimeState = vi.hoisted(() => ({
  nodesReadOnly: false,
  workflowReadOnly: false,
}))

let currentNodes: Node[] = []
let currentEdges: Edge[] = []

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

vi.mock('../use-workflow', () => ({
  useWorkflow: () => ({
    getAfterNodesInSameBranch: () => [],
  }),
  useNodesReadOnly: () => ({
    getNodesReadOnly: () => runtimeState.nodesReadOnly,
  }),
  useWorkflowReadOnly: () => ({
    getWorkflowReadOnly: () => runtimeState.workflowReadOnly,
  }),
}))

vi.mock('../use-helpline', () => ({
  useHelpline: () => ({
    handleSetHelpline: () => ({
      showHorizontalHelpLineNodes: [],
      showVerticalHelpLineNodes: [],
    }),
  }),
}))

vi.mock('../use-nodes-meta-data', () => ({
  useNodesMetaData: () => ({
    nodesMap: runtimeNodesMetaDataMap.value,
  }),
}))

vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
}))

vi.mock('../use-auto-generate-webhook-url', () => ({
  useAutoGenerateWebhookUrl: () => vi.fn(),
}))

vi.mock('../use-inspect-vars-crud', () => ({
  default: () => ({
    deleteNodeInspectorVars: vi.fn(),
  }),
}))

vi.mock('../../nodes/iteration/use-interactions', () => ({
  useNodeIterationInteractions: () => ({
    handleNodeIterationChildDrag: () => ({ restrictPosition: {} }),
    handleNodeIterationChildrenCopy: mockHandleNodeIterationChildrenCopy,
  }),
}))

vi.mock('../../nodes/loop/use-interactions', () => ({
  useNodeLoopInteractions: () => ({
    handleNodeLoopChildDrag: () => ({ restrictPosition: {} }),
    handleNodeLoopChildrenCopy: mockHandleNodeLoopChildrenCopy,
  }),
}))

vi.mock('../use-workflow-history', async importOriginal => ({
  ...(await importOriginal<typeof import('../use-workflow-history')>()),
  useWorkflowHistory: () => ({
    saveStateToHistory: mockSaveStateToHistory,
    undo: mockUndo,
    redo: mockRedo,
  }),
}))

describe('useNodesInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    runtimeState.nodesReadOnly = false
    runtimeState.workflowReadOnly = false
    currentNodes = [
      createNode({
        id: 'node-1',
        position: { x: 10, y: 20 },
        data: {
          type: BlockEnum.Code,
          title: 'Code',
          desc: '',
        },
      }),
    ]
    currentEdges = [
      createEdge({
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
      }),
    ]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes
    rfState.edges = currentEdges as unknown as typeof rfState.edges
    runtimeNodesMetaDataMap.value = {}
  })

  it('persists node drags only when the node position actually changes', () => {
    const node = currentNodes[0]!
    const movedNode = {
      ...node,
      position: { x: 120, y: 80 },
    }

    const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })

    act(() => {
      result.current.handleNodeDragStart({} as never, node!, currentNodes)
      result.current.handleNodeDragStop({} as never, movedNode, currentNodes)
    })

    expect(store.getState().nodeAnimation).toBe(false)
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('NodeDragStop', {
      nodeId: 'node-1',
    })
  })

  it('restores history snapshots on undo and clears the edge menu', () => {
    const historyNodes = [
      createNode({
        id: 'history-node',
        data: {
          type: BlockEnum.End,
          title: 'End',
          desc: '',
        },
      }),
    ]
    const historyEdges = [
      createEdge({
        id: 'history-edge',
        source: 'history-node',
        target: 'node-1',
      }),
    ]

    const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
      initialStoreState: {
        edgeMenu: {
          id: 'edge-1',
        } as never,
      },
      historyStore: {
        nodes: historyNodes,
        edges: historyEdges,
      },
    })

    act(() => {
      result.current.handleHistoryBack()
    })

    expect(mockUndo).toHaveBeenCalledTimes(1)
    expect(rfState.setNodes).toHaveBeenCalledWith(historyNodes)
    expect(rfState.setEdges).toHaveBeenCalledWith(historyEdges)
    expect(store.getState().edgeMenu).toBeUndefined()
  })

  it('skips undo and redo when the workflow is read-only', () => {
    runtimeState.workflowReadOnly = true
    const { result } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })

    act(() => {
      result.current.handleHistoryBack()
      result.current.handleHistoryForward()
    })

    expect(mockUndo).not.toHaveBeenCalled()
    expect(mockRedo).not.toHaveBeenCalled()
    expect(rfState.setNodes).not.toHaveBeenCalled()
    expect(rfState.setEdges).not.toHaveBeenCalled()
  })

  it('broadcasts history undo/redo actions to collaborators when connected', () => {
    const historyNodes = [
      createNode({
        id: 'history-node-2',
        data: {
          type: BlockEnum.End,
          title: 'History End',
          desc: '',
        },
      }),
    ]
    const historyEdges = [
      createEdge({
        id: 'history-edge-2',
        source: 'history-node-2',
        target: 'node-1',
      }),
    ]
    const isConnectedSpy = vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(true)
    const emitHistoryActionSpy = vi.spyOn(collaborationManager, 'emitHistoryAction').mockImplementation(() => undefined)
    const collabSetNodesSpy = vi.spyOn(collaborationManager, 'setNodes').mockImplementation(() => undefined)
    const collabSetEdgesSpy = vi.spyOn(collaborationManager, 'setEdges').mockImplementation(() => undefined)

    const { result } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: historyNodes,
        edges: historyEdges,
      },
    })

    act(() => {
      result.current.handleHistoryBack()
      result.current.handleHistoryForward()
    })

    expect(collabSetNodesSpy).toHaveBeenCalledTimes(2)
    expect(collabSetEdgesSpy).toHaveBeenCalledTimes(2)
    expect(emitHistoryActionSpy).toHaveBeenNthCalledWith(1, 'undo')
    expect(emitHistoryActionSpy).toHaveBeenNthCalledWith(2, 'redo')
    expect(isConnectedSpy).toHaveBeenCalled()
  })

  it('does not broadcast history changes when collaboration is disconnected', () => {
    const historyNodes = [
      createNode({
        id: 'history-node-3',
        data: {
          type: BlockEnum.End,
          title: 'History End',
          desc: '',
        },
      }),
    ]
    const historyEdges = [
      createEdge({
        id: 'history-edge-3',
        source: 'history-node-3',
        target: 'node-1',
      }),
    ]
    vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(false)
    const emitHistoryActionSpy = vi.spyOn(collaborationManager, 'emitHistoryAction').mockImplementation(() => undefined)
    const collabSetNodesSpy = vi.spyOn(collaborationManager, 'setNodes').mockImplementation(() => undefined)
    const collabSetEdgesSpy = vi.spyOn(collaborationManager, 'setEdges').mockImplementation(() => undefined)

    const { result } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: historyNodes,
        edges: historyEdges,
      },
    })

    act(() => {
      result.current.handleHistoryBack()
      result.current.handleHistoryForward()
    })

    expect(collabSetNodesSpy).not.toHaveBeenCalled()
    expect(collabSetEdgesSpy).not.toHaveBeenCalled()
    expect(emitHistoryActionSpy).not.toHaveBeenCalled()
  })

  it('ignores node click selection in comment control mode', () => {
    const { result } = renderWorkflowHook(() => useNodesInteractions(), {
      initialStoreState: {
        controlMode: ControlMode.Comment,
      },
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })

    act(() => {
      result.current.handleNodeClick({} as never, currentNodes[0] as Node)
    })

    expect(rfState.setNodes).not.toHaveBeenCalled()
    expect(rfState.setEdges).not.toHaveBeenCalled()
  })

  it('ignores note node selection when clicking a linked text target', () => {
    currentNodes = [
      createNode({
        id: 'note-1',
        type: CUSTOM_NOTE_NODE,
        data: {
          type: '' as unknown as BlockEnum,
          title: 'Note',
          desc: '',
          selected: false,
        },
      }),
    ]
    currentEdges = []
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes
    rfState.edges = currentEdges as unknown as typeof rfState.edges

    const { result } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })

    const link = document.createElement('a')
    link.className = 'note-editor-theme_link'

    act(() => {
      result.current.handleNodeClick({ target: link } as never, currentNodes[0] as Node)
    })

    expect(rfState.setNodes).not.toHaveBeenCalled()
    expect(rfState.setEdges).not.toHaveBeenCalled()
  })

  it('updates entering states on node enter and clears them on leave using collaborative workflow state', () => {
    currentNodes = [
      createNode({
        id: 'from-node',
        data: {
          type: BlockEnum.Code,
          title: 'From',
          desc: '',
        },
      }),
      createNode({
        id: 'to-node',
        position: { x: 120, y: 120 },
        data: {
          type: BlockEnum.Code,
          title: 'To',
          desc: '',
        },
      }),
    ]
    currentEdges = [
      createEdge({
        id: 'edge-from-to',
        source: 'from-node',
        target: 'to-node',
      }),
    ]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes
    rfState.edges = currentEdges as unknown as typeof rfState.edges

    const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })
    store.setState({
      connectingNodePayload: {
        nodeId: 'from-node',
        handleType: 'source',
        handleId: 'source',
      } as never,
    })

    act(() => {
      result.current.handleNodeEnter({} as never, currentNodes[1] as Node)
      result.current.handleNodeLeave({} as never, currentNodes[1] as Node)
    })

    expect(rfState.setNodes).toHaveBeenCalled()
    expect(rfState.setEdges).toHaveBeenCalled()
  })

  it('stores connecting payload from collaborative nodes when connect starts', () => {
    const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })

    act(() => {
      result.current.handleNodeConnectStart(
        {} as never,
        {
          nodeId: 'node-1',
          handleType: 'source',
          handleId: 'source',
        } as never,
      )
    })

    expect(store.getState().connectingNodePayload).toMatchObject({
      nodeId: 'node-1',
      handleType: 'source',
      handleId: 'source',
    })
  })

  it('returns early for node add/change when metadata for node type is missing', () => {
    const { result } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })

    act(() => {
      result.current.handleNodeAdd(
        {
          nodeType: BlockEnum.Code,
        },
        { prevNodeId: 'node-1' },
      )
      result.current.handleNodeChange('node-1', BlockEnum.Answer, 'source')
    })

    expect(rfState.setNodes).not.toHaveBeenCalled()
    expect(rfState.setEdges).not.toHaveBeenCalled()
  })

  it('cancels selection state with collaborative nodes snapshot', () => {
    currentNodes = [
      createNode({
        id: 'selected-node',
        data: {
          type: BlockEnum.Code,
          title: 'Selected',
          desc: '',
          selected: true,
        },
      }),
    ]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes

    const { result } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })

    act(() => {
      result.current.handleNodesCancelSelected()
    })

    expect(rfState.setNodes).toHaveBeenCalledTimes(1)
    const nodesArg = rfState.setNodes.mock.calls[0]?.[0] as Node[]
    expect(nodesArg[0]?.data.selected).toBe(false)
  })

  it('skips clipboard copy when bundled/selected nodes have no metadata', () => {
    currentNodes = [
      createNode({
        id: 'bundled-node',
        data: {
          type: BlockEnum.Code,
          title: 'Bundled',
          desc: '',
          _isBundled: true,
        },
      }),
      createNode({
        id: 'selected-node',
        position: { x: 100, y: 0 },
        data: {
          type: BlockEnum.Code,
          title: 'Selected',
          desc: '',
          selected: true,
        },
      }),
    ]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes

    const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })

    act(() => {
      result.current.handleNodesCopy()
    })

    expect(store.getState().clipboardElements).toEqual([])
  })

  it('loads nodes/edges from collaborative state for delete, disconnect, dim and undim actions', () => {
    currentNodes = [
      createNode({
        id: 'node-a',
        data: {
          type: BlockEnum.Code,
          title: 'A',
          desc: '',
          selected: true,
        },
      }),
      createNode({
        id: 'node-b',
        position: { x: 160, y: 0 },
        data: {
          type: BlockEnum.Code,
          title: 'B',
          desc: '',
        },
      }),
    ]
    currentEdges = [
      createEdge({
        id: 'edge-a-b',
        source: 'node-a',
        target: 'node-b',
      }),
    ]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes
    rfState.edges = currentEdges as unknown as typeof rfState.edges

    const { result } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })

    act(() => {
      result.current.handleNodesDelete()
      result.current.handleNodeDisconnect('node-a')
      result.current.dimOtherNodes()
      result.current.undimAllNodes()
    })

    expect(rfState.setNodes).toHaveBeenCalled()
    expect(rfState.setEdges).toHaveBeenCalled()
  })

  it('reads collaborative nodes when dragging/selecting/connecting nodes', () => {
    currentNodes = [
      createNode({
        id: 'drag-node-1',
        data: {
          type: BlockEnum.Code,
          title: 'Drag1',
          desc: '',
          selected: true,
        },
      }),
      createNode({
        id: 'drag-node-2',
        position: { x: 180, y: 0 },
        data: {
          type: BlockEnum.Code,
          title: 'Drag2',
          desc: '',
        },
      }),
    ]
    currentEdges = [
      createEdge({
        id: 'drag-edge',
        source: 'drag-node-1',
        target: 'drag-node-2',
      }),
    ]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes
    rfState.edges = currentEdges as unknown as typeof rfState.edges

    const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: currentEdges,
      },
    })
    store.setState({
      connectingNodePayload: {
        nodeId: 'drag-node-1',
        handleType: 'source',
        handleId: 'source',
      } as never,
      enteringNodePayload: {
        nodeId: 'drag-node-2',
      } as never,
    })

    act(() => {
      result.current.handleNodeDrag(
        { stopPropagation: vi.fn() } as never,
        currentNodes[0] as Node,
        currentNodes as Node[],
      )
      result.current.handleNodeSelect('drag-node-2')
      result.current.handleNodeConnect({
        source: 'drag-node-1',
        target: 'drag-node-2',
        sourceHandle: 'source',
        targetHandle: 'target',
      })
      result.current.handleNodeConnectEnd({ clientX: 0, clientY: 0 } as never)
    })

    expect(rfState.setNodes).toHaveBeenCalled()
    expect(rfState.setEdges).toHaveBeenCalled()
  })

  it('uses metadata defaults during add/change/paste and reads collaborative nodes on resize', () => {
    runtimeNodesMetaDataMap.value = {
      [BlockEnum.Code]: {
        defaultValue: {
          type: BlockEnum.Code,
          title: 'Code',
          desc: '',
        },
        metaData: {
          isSingleton: false,
        },
      },
      [BlockEnum.Answer]: {
        defaultValue: {
          type: BlockEnum.Answer,
          title: 'Answer',
          desc: '',
        },
        metaData: {
          isSingleton: false,
        },
      },
    }

    currentNodes = [
      createNode({
        id: 'meta-node-1',
        data: {
          type: BlockEnum.Code,
          title: 'Meta',
          desc: '',
          selected: false,
        },
      }),
    ]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes
    rfState.edges = []

    const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: {
        nodes: currentNodes,
        edges: [],
      },
    })
    store.setState({
      clipboardElements: [
        createNode({
          id: 'clipboard-node',
          data: {
            type: BlockEnum.Code,
            title: 'Clipboard',
            desc: '',
          },
        }),
      ] as never,
      mousePosition: {
        pageX: 60,
        pageY: 80,
      } as never,
    })

    act(() => {
      result.current.handleNodeAdd(
        { nodeType: BlockEnum.Code },
        { prevNodeId: 'meta-node-1' },
      )
      result.current.handleNodeChange('meta-node-1', BlockEnum.Answer, 'source')
      result.current.handleNodesPaste()
      result.current.handleNodeResize('meta-node-1', {
        x: 0,
        y: 0,
        width: 260,
        height: 140,
      } as never)
    })

    expect(rfState.setNodes).toHaveBeenCalled()
  })

  // Paste title handling should preserve original names until the destination canvas conflicts.
  describe('paste title handling', () => {
    beforeEach(() => {
      runtimeNodesMetaDataMap.value = {
        [BlockEnum.Code]: {
          defaultValue: {
            type: BlockEnum.Code,
            title: 'Code',
            desc: '',
          },
          metaData: {
            isSingleton: false,
          },
        },
      }
    })

    it('preserves the original title when the destination canvas has no conflict', async () => {
      currentNodes = [
        createNode({
          id: 'existing-node',
          data: {
            type: BlockEnum.Code,
            title: 'Existing',
            desc: '',
          },
        }),
      ]
      currentEdges = []
      rfState.nodes = currentNodes as unknown as typeof rfState.nodes
      rfState.edges = currentEdges as unknown as typeof rfState.edges

      const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
        historyStore: {
          nodes: currentNodes,
          edges: currentEdges,
        },
      })

      store.setState({
        clipboardElements: [
          createNode({
            id: 'clipboard-node',
            data: {
              type: BlockEnum.Code,
              title: 'Clipboard',
              desc: '',
            },
          }),
        ] as never,
        clipboardEdges: [] as never,
        mousePosition: {
          pageX: 60,
          pageY: 80,
        } as never,
      })

      await act(async () => {
        await result.current.handleNodesPaste()
      })

      const pastedNodes = rfState.setNodes.mock.calls.at(-1)?.[0] as Node[]
      const newNode = pastedNodes.find(node => node.id !== 'existing-node')

      expect(newNode?.data.title).toBe('Clipboard')
    })

    it('renames pasted nodes only when the destination canvas already uses the title', async () => {
      currentNodes = [
        createNode({
          id: 'existing-node',
          data: {
            type: BlockEnum.Code,
            title: 'Clipboard',
            desc: '',
          },
        }),
        createNode({
          id: 'existing-node-2',
          data: {
            type: BlockEnum.Code,
            title: 'Clipboard (1)',
            desc: '',
          },
        }),
      ]
      currentEdges = []
      rfState.nodes = currentNodes as unknown as typeof rfState.nodes
      rfState.edges = currentEdges as unknown as typeof rfState.edges

      const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
        historyStore: {
          nodes: currentNodes,
          edges: currentEdges,
        },
      })

      store.setState({
        clipboardElements: [
          createNode({
            id: 'clipboard-node',
            data: {
              type: BlockEnum.Code,
              title: 'Clipboard',
              desc: '',
            },
          }),
        ] as never,
        clipboardEdges: [] as never,
        mousePosition: {
          pageX: 60,
          pageY: 80,
        } as never,
      })

      await act(async () => {
        await result.current.handleNodesPaste()
      })

      const pastedNodes = rfState.setNodes.mock.calls.at(-1)?.[0] as Node[]
      const newNode = pastedNodes.find(node => !currentNodes.some(existingNode => existingNode.id === node.id))

      expect(newNode?.data.title).toBe('Clipboard (2)')
    })
  })

  // A copied container can still be selected on the source canvas during same-canvas paste.
  describe('container paste target detection', () => {
    beforeEach(() => {
      runtimeNodesMetaDataMap.value = {
        [BlockEnum.Iteration]: {
          defaultValue: {
            type: BlockEnum.Iteration,
            title: 'Iteration',
            desc: '',
            _children: [],
          },
          metaData: {
            isSingleton: false,
          },
        },
        [BlockEnum.Loop]: {
          defaultValue: {
            type: BlockEnum.Loop,
            title: 'Loop',
            desc: '',
            _children: [],
          },
          metaData: {
            isSingleton: false,
          },
        },
      }
    })

    it.each([
      [BlockEnum.Iteration, 'iteration-source'],
      [BlockEnum.Loop, 'loop-source'],
    ])('pastes a copied %s as a top-level node when the source container remains selected', async (containerType, nodeId) => {
      currentNodes = [
        createNode({
          id: nodeId,
          position: { x: 20, y: 20 },
          selected: true,
          data: {
            type: containerType,
            title: containerType === BlockEnum.Iteration ? 'Iteration' : 'Loop',
            desc: '',
            _children: [],
          },
        }),
      ]
      currentEdges = []
      rfState.nodes = currentNodes as unknown as typeof rfState.nodes
      rfState.edges = currentEdges as unknown as typeof rfState.edges

      const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
        historyStore: {
          nodes: currentNodes,
          edges: currentEdges,
        },
      })

      store.setState({
        clipboardElements: [
          createNode({
            id: nodeId,
            position: { x: 120, y: 120 },
            data: {
              type: containerType,
              title: containerType === BlockEnum.Iteration ? 'Iteration' : 'Loop',
              desc: '',
              _children: [],
            },
          }),
        ] as never,
        clipboardEdges: [] as never,
        mousePosition: {
          pageX: 60,
          pageY: 80,
        } as never,
      })

      await act(async () => {
        await result.current.handleNodesPaste()
      })

      const pastedNodes = rfState.setNodes.mock.calls.at(-1)?.[0] as Node[]
      const newContainer = pastedNodes.find(node => node.id !== nodeId && node.data.type === containerType)

      expect(newContainer).toBeDefined()
      expect(newContainer?.parentId).toBeUndefined()
      expect(newContainer?.data.isInIteration).toBeFalsy()
      expect(newContainer?.data.isInLoop).toBeFalsy()
    })
  })

  // Nested container paste restrictions should stay aligned with available block filtering.
  describe('nested container paste restrictions', () => {
    const disallowedNestedPasteNodeTypes = [
      BlockEnum.End,
      BlockEnum.Iteration,
      BlockEnum.Loop,
      BlockEnum.DataSource,
      BlockEnum.KnowledgeBase,
      BlockEnum.HumanInput,
    ]

    const createNodeMeta = (type: BlockEnum) => ({
      defaultValue: {
        type,
        title: `${type} node`,
        desc: '',
      },
      metaData: {
        isSingleton: false,
      },
    })

    const runDisallowedPasteScenario = async (containerType: BlockEnum.Iteration | BlockEnum.Loop, nodeType: BlockEnum) => {
      runtimeNodesMetaDataMap.value = {
        [nodeType]: createNodeMeta(nodeType),
      }

      const containerId = `${containerType}-container`
      currentNodes = [
        createNode({
          id: containerId,
          position: { x: 20, y: 20 },
          selected: true,
          data: {
            type: containerType,
            title: containerType === BlockEnum.Iteration ? 'Iteration' : 'Loop',
            desc: '',
            _children: [],
          },
        }),
      ]
      currentEdges = []
      rfState.nodes = currentNodes as unknown as typeof rfState.nodes
      rfState.edges = currentEdges as unknown as typeof rfState.edges

      const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
        historyStore: {
          nodes: currentNodes,
          edges: currentEdges,
        },
      })

      store.setState({
        clipboardElements: [
          createNode({
            id: `${nodeType}-clipboard-node`,
            position: { x: 100, y: 100 },
            data: {
              type: nodeType,
              title: `${nodeType} clipboard node`,
              desc: '',
            },
          }),
        ] as never,
        clipboardEdges: [] as never,
        mousePosition: {
          pageX: 60,
          pageY: 80,
        } as never,
      })

      await act(async () => {
        await result.current.handleNodesPaste()
      })

      const pastedNodes = rfState.setNodes.mock.calls.at(-1)?.[0] as Node[]

      expect(pastedNodes).toHaveLength(1)
      expect(pastedNodes[0]?.id).toBe(containerId)
      expect(pastedNodes[0]?.data._children).toEqual([])
      expect(pastedNodes.some(node => node.data.type === nodeType && node.parentId === containerId)).toBe(false)
    }

    it.each(disallowedNestedPasteNodeTypes)(
      'should not paste %s into an iteration container',
      async (nodeType) => {
        await runDisallowedPasteScenario(BlockEnum.Iteration, nodeType)
      },
    )

    it('should not paste human-input into a loop container', async () => {
      await runDisallowedPasteScenario(BlockEnum.Loop, BlockEnum.HumanInput)
    })
  })
})
