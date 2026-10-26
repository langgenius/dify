import type { HumanInputV2NodeType } from '../../nodes/human-input-v2/types'
import type { Edge, Node } from '../../types'
import { act } from '@testing-library/react'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useNodesInteractions } from '../use-nodes-interactions'

const mockHandleSyncWorkflowDraft = vi.hoisted(() => vi.fn())
const mockSaveStateToHistory = vi.hoisted(() => vi.fn())
const mockUndo = vi.hoisted(() => vi.fn())
const mockRedo = vi.hoisted(() => vi.fn())
const mockHandleNodeIterationChildrenCopy = vi.hoisted(() =>
  vi.fn(() => ({
    copyChildren: [],
    newIdMapping: {},
  })),
)
const mockHandleNodeLoopChildrenCopy = vi.hoisted(() =>
  vi.fn(() => ({
    copyChildren: [],
    newIdMapping: {},
  })),
)
const mockCreateInlineAgentBinding = vi.hoisted(() => vi.fn())
const runtimeNodesMetaDataMap = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}))

const runtimeState = vi.hoisted(() => ({
  isChatMode: false,
  nodesReadOnly: false,
  workflowReadOnly: false,
}))

let currentNodes: Node[] = []
let currentEdges: Edge[] = []

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock(),
)

vi.mock('../use-workflow', () => ({
  useIsChatMode: () => runtimeState.isChatMode,
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

vi.mock('../../nodes/agent-v2/hooks', () => ({
  useCreateInlineAgentBinding: () => ({
    createInlineAgentBinding: mockCreateInlineAgentBinding,
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

vi.mock('../use-workflow-history', async (importOriginal) => ({
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
    runtimeState.isChatMode = false
    runtimeState.nodesReadOnly = false
    runtimeState.workflowReadOnly = false
    mockCreateInlineAgentBinding.mockImplementation(
      (
        _nodeId: string,
        options?: {
          onSuccess?: (binding: {
            binding_type: 'inline_agent'
            agent_id: string
            current_snapshot_id: string
          }) => void
        },
      ) => {
        options?.onSuccess?.({
          binding_type: 'inline_agent',
          agent_id: 'inline-agent-1',
          current_snapshot_id: 'inline-snapshot-1',
        })
      },
    )
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

  it.each([undefined, BlockEnum.Iteration, BlockEnum.Loop])(
    'creates Human Input v2 with persisted type in container %s',
    (containerType) => {
      const parentId = containerType ? 'container-node' : undefined
      currentNodes = [
        createNode({
          id: 'node-1',
          parentId,
          width: 100,
          data: { type: BlockEnum.Code, title: 'Code', desc: '' },
        }),
      ]
      if (containerType) {
        currentNodes.unshift(
          createNode({
            id: parentId,
            width: 500,
            height: 400,
            data: { type: containerType, title: 'Container', desc: '' },
          }),
        )
      }
      rfState.nodes = currentNodes as unknown as typeof rfState.nodes
      rfState.edges = []
      rfState.setNodes.mockImplementation((nextNodes) => {
        rfState.nodes = nextNodes
      })
      runtimeNodesMetaDataMap.value = {
        [BlockEnum.HumanInputV2]: {
          defaultValue: {
            type: BlockEnum.HumanInput,
            title: 'Human Input v2',
            desc: '',
            version: '2',
            recipients_spec: [],
            message_template: { subject: '', body: '' },
            debug_mode: { enabled: false, channels: [] },
            form_content: '',
            inputs: [],
            user_actions: [],
            timeout: 36,
            timeout_unit: 'hour',
          },
          metaData: { isSingleton: false },
        },
      }

      const { result } = renderWorkflowHook(() => useNodesInteractions(), {
        historyStore: { nodes: currentNodes, edges: [] },
      })

      act(() => {
        result.current.handleNodeAdd({ nodeType: BlockEnum.HumanInputV2 }, { prevNodeId: 'node-1' })
      })

      const node = rfState.nodes.find((node) => node.data.version === '2')
      expect(node?.data).toMatchObject({
        type: BlockEnum.HumanInput,
        version: '2',
        recipients_spec: [],
        timeout: 36,
        timeout_unit: 'hour',
      })
      expect(node?.data).not.toHaveProperty('delivery_methods')
      expect(node?.data._connectedSourceHandleIds).toEqual([])
      expect(node?.parentId).toBe(parentId)
      if (containerType) {
        expect(node?.data).toMatchObject({
          isInIteration: containerType === BlockEnum.Iteration,
          isInLoop: containerType === BlockEnum.Loop,
          [containerType === BlockEnum.Iteration ? 'iteration_id' : 'loop_id']: parentId,
        })
      }
    },
  )

  it('blocks quick-add Human Input while a legacy node remains in the draft', () => {
    currentNodes = [
      createNode({
        id: 'legacy-human-input',
        data: {
          type: BlockEnum.HumanInput,
          title: 'Legacy Human Input',
          desc: '',
          delivery_methods: [],
        },
      }),
      createNode({ id: 'node-1', data: { type: BlockEnum.Code, title: 'Code', desc: '' } }),
    ]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes
    runtimeNodesMetaDataMap.value = {
      [BlockEnum.HumanInputV2]: {
        defaultValue: {
          type: BlockEnum.HumanInput,
          version: '2',
          title: 'Human Input',
          desc: '',
        },
        metaData: { isSingleton: false },
      },
    }
    const { result } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: { nodes: currentNodes, edges: [] },
    })

    act(() => {
      result.current.handleNodeAdd({ nodeType: BlockEnum.HumanInputV2 }, { prevNodeId: 'node-1' })
    })

    expect(rfState.setNodes).not.toHaveBeenCalled()
    expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSaveStateToHistory).not.toHaveBeenCalled()
  })

  it('blocks pasted Human Input while a legacy node remains in the draft', async () => {
    const legacyNode = createNode({
      id: 'legacy-human-input',
      data: {
        type: BlockEnum.HumanInput,
        title: 'Legacy Human Input',
        desc: '',
        delivery_methods: [],
      },
    })
    const copiedV2Node = createNode({
      id: 'copied-v2',
      data: {
        type: BlockEnum.HumanInput,
        version: '2',
        title: 'Human Input',
        desc: '',
      },
    })
    currentNodes = [legacyNode]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes
    runtimeNodesMetaDataMap.value = {
      [BlockEnum.HumanInput]: {
        defaultValue: { type: BlockEnum.HumanInput, delivery_methods: [] },
        metaData: { isSingleton: false },
      },
      [BlockEnum.HumanInputV2]: {
        defaultValue: { type: BlockEnum.HumanInput, version: '2' },
        metaData: { isSingleton: false },
      },
    }
    const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: { nodes: currentNodes, edges: [] },
    })
    store.setState({
      clipboardElements: [copiedV2Node] as never,
      clipboardEdges: [] as never,
      mousePosition: { pageX: 60, pageY: 80 } as never,
    })

    await act(async () => {
      await result.current.handleNodesPaste()
    })

    expect(rfState.setNodes).not.toHaveBeenCalled()
    expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSaveStateToHistory).not.toHaveBeenCalled()
  })

  it('blocks duplicated Human Input while a legacy node remains in the draft', async () => {
    const legacyNode = createNode({
      id: 'legacy-human-input',
      data: {
        type: BlockEnum.HumanInput,
        title: 'Legacy Human Input',
        desc: '',
        delivery_methods: [],
      },
    })
    currentNodes = [legacyNode]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes
    runtimeNodesMetaDataMap.value = {
      [BlockEnum.HumanInput]: {
        defaultValue: { type: BlockEnum.HumanInput, delivery_methods: [] },
        metaData: { isSingleton: false },
      },
    }
    const readTextSpy = vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue('')
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const { result } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: { nodes: currentNodes, edges: [] },
    })

    act(() => {
      result.current.handleNodesDuplicate('legacy-human-input')
    })
    await vi.waitFor(() => expect(readTextSpy).toHaveBeenCalled())

    expect(writeTextSpy).toHaveBeenCalled()
    expect(rfState.setNodes).not.toHaveBeenCalled()
    expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSaveStateToHistory).not.toHaveBeenCalled()
    readTextSpy.mockRestore()
    writeTextSpy.mockRestore()
  })

  it('pastes Human Input v2 without losing wire data and remaps copied dependencies', async () => {
    currentNodes = [
      createNode({ id: 'existing-node', data: { type: BlockEnum.Code, title: 'Code', desc: '' } }),
    ]
    rfState.nodes = currentNodes as unknown as typeof rfState.nodes
    rfState.edges = []
    runtimeNodesMetaDataMap.value = {
      [BlockEnum.Code]: {
        defaultValue: {
          type: BlockEnum.Code,
          title: 'Code',
          desc: '',
          variables: [],
          code_language: 'python3',
          code: '',
          outputs: {},
        },
        metaData: { isSingleton: false },
      },
      [BlockEnum.HumanInputV2]: {
        defaultValue: {
          type: BlockEnum.HumanInput,
          version: '2',
          recipients_spec: [],
          message_template: { subject: '', body: '' },
          debug_mode: { enabled: false, channels: [] },
          form_content: '',
          inputs: [],
          user_actions: [],
          timeout: 36,
          timeout_unit: 'hour',
        },
        metaData: { isSingleton: false },
      },
    }
    const copiedSourceNode = createNode({
      id: 'source-copy',
      data: {
        type: BlockEnum.Code,
        title: 'Email source',
        desc: '',
        variables: [],
        code_language: 'python3',
        code: '',
        outputs: { email: { type: 'string', children: null } },
      },
    })
    const copiedNode = createNode({
      id: 'human-input-v2-copy',
      data: {
        type: BlockEnum.HumanInput,
        version: '2',
        title: 'Review request',
        desc: '',
        recipients_spec: [
          { type: 'initiator' },
          { type: 'dynamic_email', selector: ['source-copy', 'email'] },
          { type: 'onetime_email', email: 'owner@example.com' },
        ],
        message_template: {
          subject: 'Review {{#source-copy.email#}}',
          body: 'Body {{#source-copy.email#}}',
        },
        debug_mode: { enabled: true, channels: ['email', 'slack'] },
        form_content: '{{#source-copy.email#}}',
        inputs: [],
        user_actions: [],
        timeout: 36,
        timeout_unit: 'hour',
      },
    })
    const { result, store } = renderWorkflowHook(() => useNodesInteractions(), {
      historyStore: { nodes: currentNodes, edges: [] },
    })
    store.setState({
      clipboardElements: [copiedSourceNode, copiedNode] as never,
      clipboardEdges: [] as never,
      mousePosition: { pageX: 60, pageY: 80 } as never,
    })

    await act(async () => {
      await result.current.handleNodesPaste()
    })

    const pastedNodes = rfState.setNodes.mock.calls.at(-1)?.[0] as Node[]
    const pasted = pastedNodes.find((node) => (node.data as { version?: unknown }).version === '2')
    const pastedData = pasted?.data as HumanInputV2NodeType
    const copiedData = copiedNode.data as HumanInputV2NodeType
    const pastedSource = pastedNodes.find(
      (node) => node.data.type === BlockEnum.Code && node.id !== 'existing-node',
    )
    expect(pastedData.type).toBe(BlockEnum.HumanInput)
    expect(pastedData.recipients_spec).toEqual([
      { type: 'initiator' },
      { type: 'dynamic_email', selector: [pastedSource?.id, 'email'] },
      { type: 'onetime_email', email: 'owner@example.com' },
    ])
    expect(pastedData.message_template).toEqual({
      subject: `Review {{#${pastedSource?.id}.email#}}`,
      body: `Body {{#${pastedSource?.id}.email#}}`,
    })
    expect(pastedData.form_content).toBe(`{{#${pastedSource?.id}.email#}}`)
    expect(pastedData.debug_mode).toEqual(copiedData.debug_mode)
  })

  // Paste title handling should preserve original names until the destination canvas conflicts.

  // A copied container can still be selected on the source canvas during same-canvas paste.

  // Nested container paste behavior should stay aligned with available block filtering.
})
