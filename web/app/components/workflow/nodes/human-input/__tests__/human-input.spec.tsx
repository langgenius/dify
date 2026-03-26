import type { ReactNode } from 'react'
import type { HumanInputNodeType } from '@/app/components/workflow/nodes/human-input/types'
import type {
  Edge,
  Node,
} from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import humanInputDefault from '@/app/components/workflow/nodes/human-input/default'
import HumanInputNode from '@/app/components/workflow/nodes/human-input/node'
import {
  DeliveryMethodType,
  UserActionButtonType,
} from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { initialNodes, preprocessNodesAndEdges } from '@/app/components/workflow/utils/workflow-init'

// Mock reactflow which is needed by initialNodes and NodeSourceHandle
vi.mock('reactflow', async () => {
  const reactflow = await vi.importActual('reactflow')
  return {
    ...reactflow,
    Handle: ({ children }: { children?: ReactNode }) => <div data-testid="handle">{children}</div>,
  }
})

// Minimal store state mirroring the fields that NodeSourceHandle selects
const mockStoreState = {
  shouldAutoOpenStartNodeSelector: false,
  setShouldAutoOpenStartNodeSelector: vi.fn(),
  setHasSelectedStartNode: vi.fn(),
}

// Mock workflow store used by NodeSourceHandle
// useStore accepts a selector and applies it to the state, so tests break
// if the component starts selecting fields that aren't provided here.
vi.mock('@/app/components/workflow/store', () => ({
  useStore: vi.fn((selector?: (s: typeof mockStoreState) => unknown) =>
    selector ? selector(mockStoreState) : mockStoreState,
  ),
  useWorkflowStore: vi.fn(() => ({
    getState: () => ({
      getNodes: () => [],
    }),
  })),
}))

// Mock workflow hooks barrel (used by NodeSourceHandle via ../../../hooks)
vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesInteractions: () => ({
    handleNodeAdd: vi.fn(),
  }),
  useNodesReadOnly: () => ({
    getNodesReadOnly: () => false,
    nodesReadOnly: false,
  }),
  useAvailableBlocks: () => ({
    availableNextBlocks: [],
    availablePrevBlocks: [],
  }),
  useIsChatMode: () => false,
}))

// ── Factory: Build a realistic human-input node as it would appear after DSL import ──
const createHumanInputNode = (overrides?: Partial<HumanInputNodeType>): Node => ({
  id: 'human-input-1',
  type: 'custom',
  position: { x: 400, y: 200 },
  data: {
    type: BlockEnum.HumanInput,
    title: 'Human Input',
    desc: 'Wait for human input',
    delivery_methods: [
      {
        id: 'dm-1',
        type: DeliveryMethodType.WebApp,
        enabled: true,
      },
      {
        id: 'dm-2',
        type: DeliveryMethodType.Email,
        enabled: true,
        config: {
          recipients: { whole_workspace: false, items: [] },
          subject: 'Please review',
          body: 'Please review the form',
          debug_mode: false,
        },
      },
    ],
    form_content: '# Review Form\nPlease fill in the details below.',
    inputs: [
      {
        type: 'text-input',
        output_variable_name: 'review_result',
        default: { selector: [], type: 'constant' as const, value: '' },
      },
    ],
    user_actions: [
      {
        id: 'approve',
        title: 'Approve',
        button_style: UserActionButtonType.Primary,
      },
      {
        id: 'reject',
        title: 'Reject',
        button_style: UserActionButtonType.Default,
      },
    ],
    timeout: 3,
    timeout_unit: 'day' as const,
    ...overrides,
  } as HumanInputNodeType,
})

const createStartNode = (): Node => ({
  id: 'start-1',
  type: 'custom',
  position: { x: 100, y: 200 },
  data: {
    type: BlockEnum.Start,
    title: 'Start',
    desc: '',
  } as Node['data'],
})

const createEdge = (source: string, target: string, sourceHandle = 'source', targetHandle = 'target'): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  type: 'custom',
  source,
  sourceHandle,
  target,
  targetHandle,
  data: {},
} as Edge)

describe('DSL Import with Human Input Node', () => {
  // ── preprocessNodesAndEdges: human-input nodes pass through without error ──
  describe('preprocessNodesAndEdges', () => {
    it('should pass through a workflow containing a human-input node unchanged', () => {
      const humanInputNode = createHumanInputNode()
      const startNode = createStartNode()
      const nodes = [startNode, humanInputNode]
      const edges = [createEdge('start-1', 'human-input-1')]

      const result = preprocessNodesAndEdges(nodes as Node[], edges as Edge[])

      expect(result.nodes).toHaveLength(2)
      expect(result.edges).toHaveLength(1)
      expect(result.nodes).toEqual(nodes)
      expect(result.edges).toEqual(edges)
    })

    it('should not treat human-input node as an iteration or loop node', () => {
      const humanInputNode = createHumanInputNode()
      const nodes = [humanInputNode]

      const result = preprocessNodesAndEdges(nodes as Node[], [])

      // No extra iteration/loop start nodes should be injected
      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].data.type).toBe(BlockEnum.HumanInput)
    })
  })

  // ── initialNodes: human-input nodes are properly initialized ──
  describe('initialNodes', () => {
    it('should initialize a human-input node with connected handle IDs', () => {
      const humanInputNode = createHumanInputNode()
      const startNode = createStartNode()
      const nodes = [startNode, humanInputNode]
      const edges = [createEdge('start-1', 'human-input-1')]

      const result = initialNodes(nodes as Node[], edges as Edge[])

      const processedHumanInput = result.find(n => n.id === 'human-input-1')
      expect(processedHumanInput).toBeDefined()
      expect(processedHumanInput!.data.type).toBe(BlockEnum.HumanInput)
      // initialNodes sets _connectedSourceHandleIds and _connectedTargetHandleIds
      expect(processedHumanInput!.data._connectedSourceHandleIds).toBeDefined()
      expect(processedHumanInput!.data._connectedTargetHandleIds).toBeDefined()
    })

    it('should preserve human-input node data after initialization', () => {
      const humanInputNode = createHumanInputNode()
      const nodes = [humanInputNode]

      const result = initialNodes(nodes as Node[], [])

      const processed = result[0]
      const nodeData = processed.data as HumanInputNodeType
      expect(nodeData.delivery_methods).toHaveLength(2)
      expect(nodeData.user_actions).toHaveLength(2)
      expect(nodeData.form_content).toBe('# Review Form\nPlease fill in the details below.')
      expect(nodeData.timeout).toBe(3)
      expect(nodeData.timeout_unit).toBe('day')
    })

    it('should set node type to custom if not set', () => {
      const humanInputNode = createHumanInputNode()
      delete (humanInputNode as Record<string, unknown>).type

      const result = initialNodes([humanInputNode] as Node[], [])

      expect(result[0].type).toBe('custom')
    })
  })

  // ── Node component: renders without crashing for all data variations ──
  describe('HumanInputNode Component', () => {
    it('should render without crashing with full DSL data', () => {
      const node = createHumanInputNode()

      expect(() => {
        render(
          <HumanInputNode
            id={node.id}
            data={node.data as HumanInputNodeType}
          />,
        )
      }).not.toThrow()
    })

    it('should display delivery method labels when methods are present', () => {
      const node = createHumanInputNode()

      render(
        <HumanInputNode
          id={node.id}
          data={node.data as HumanInputNodeType}
        />,
      )

      // Delivery method type labels are rendered in lowercase
      expect(screen.getByText('webapp')).toBeInTheDocument()
      expect(screen.getByText('email')).toBeInTheDocument()
    })

    it('should display user action IDs', () => {
      const node = createHumanInputNode()

      render(
        <HumanInputNode
          id={node.id}
          data={node.data as HumanInputNodeType}
        />,
      )

      expect(screen.getByText('approve')).toBeInTheDocument()
      expect(screen.getByText('reject')).toBeInTheDocument()
    })

    it('should always display Timeout handle', () => {
      const node = createHumanInputNode()

      render(
        <HumanInputNode
          id={node.id}
          data={node.data as HumanInputNodeType}
        />,
      )

      expect(screen.getByText('Timeout')).toBeInTheDocument()
    })

    it('should render without crashing when delivery_methods is empty', () => {
      const node = createHumanInputNode({ delivery_methods: [] })

      expect(() => {
        render(
          <HumanInputNode
            id={node.id}
            data={node.data as HumanInputNodeType}
          />,
        )
      }).not.toThrow()

      // Delivery method section should not be rendered
      expect(screen.queryByText('webapp')).not.toBeInTheDocument()
      expect(screen.queryByText('email')).not.toBeInTheDocument()
    })

    it('should render without crashing when user_actions is empty', () => {
      const node = createHumanInputNode({ user_actions: [] })

      expect(() => {
        render(
          <HumanInputNode
            id={node.id}
            data={node.data as HumanInputNodeType}
          />,
        )
      }).not.toThrow()

      // Timeout handle should still exist
      expect(screen.getByText('Timeout')).toBeInTheDocument()
    })

    it('should render without crashing when both delivery_methods and user_actions are empty', () => {
      const node = createHumanInputNode({
        delivery_methods: [],
        user_actions: [],
        form_content: '',
        inputs: [],
      })

      expect(() => {
        render(
          <HumanInputNode
            id={node.id}
            data={node.data as HumanInputNodeType}
          />,
        )
      }).not.toThrow()
    })

    it('should render with only webapp delivery method', () => {
      const node = createHumanInputNode({
        delivery_methods: [
          { id: 'dm-1', type: DeliveryMethodType.WebApp, enabled: true },
        ],
      })

      render(
        <HumanInputNode
          id={node.id}
          data={node.data as HumanInputNodeType}
        />,
      )

      expect(screen.getByText('webapp')).toBeInTheDocument()
      expect(screen.queryByText('email')).not.toBeInTheDocument()
    })

    it('should render with multiple user actions', () => {
      const node = createHumanInputNode({
        user_actions: [
          { id: 'action_1', title: 'Approve', button_style: UserActionButtonType.Primary },
          { id: 'action_2', title: 'Reject', button_style: UserActionButtonType.Default },
          { id: 'action_3', title: 'Escalate', button_style: UserActionButtonType.Accent },
        ],
      })

      render(
        <HumanInputNode
          id={node.id}
          data={node.data as HumanInputNodeType}
        />,
      )

      expect(screen.getByText('action_1')).toBeInTheDocument()
      expect(screen.getByText('action_2')).toBeInTheDocument()
      expect(screen.getByText('action_3')).toBeInTheDocument()
    })
  })

  // ── Node registration: human-input is included in the workflow node registry ──
  // Verify via WORKFLOW_COMMON_NODES (lightweight metadata-only imports) instead
  // of NodeComponentMap/PanelComponentMap which pull in every node's heavy UI deps.
  describe('Node Registration', () => {
    it('should have HumanInput included in WORKFLOW_COMMON_NODES', () => {
      const entry = WORKFLOW_COMMON_NODES.find(
        n => n.metaData.type === BlockEnum.HumanInput,
      )
      expect(entry).toBeDefined()
    })
  })

  // ── Default config & validation ──
  describe('HumanInput Default Configuration', () => {
    it('should provide default values for a new human-input node', () => {
      const defaultValue = humanInputDefault.defaultValue

      expect(defaultValue.delivery_methods).toEqual([])
      expect(defaultValue.user_actions).toEqual([])
      expect(defaultValue.form_content).toBe('')
      expect(defaultValue.inputs).toEqual([])
      expect(defaultValue.timeout).toBe(3)
      expect(defaultValue.timeout_unit).toBe('day')
    })

    it('should validate that delivery methods are required', () => {
      const t = (key: string) => key
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBeTruthy()
    })

    it('should validate that at least one delivery method is enabled', () => {
      const t = (key: string) => key
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [
          { id: 'dm-1', type: DeliveryMethodType.WebApp, enabled: false },
        ],
        user_actions: [
          { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
        ],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result.isValid).toBe(false)
    })

    it('should validate that user actions are required', () => {
      const t = (key: string) => key
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [
          { id: 'dm-1', type: DeliveryMethodType.WebApp, enabled: true },
        ],
        user_actions: [],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result.isValid).toBe(false)
    })

    it('should validate that user action IDs are not duplicated', () => {
      const t = (key: string) => key
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [
          { id: 'dm-1', type: DeliveryMethodType.WebApp, enabled: true },
        ],
        user_actions: [
          { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
          { id: 'approve', title: 'Also Approve', button_style: UserActionButtonType.Default },
        ],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result.isValid).toBe(false)
    })

    it('should pass validation with correct configuration', () => {
      const t = (key: string) => key
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [
          { id: 'dm-1', type: DeliveryMethodType.WebApp, enabled: true },
        ],
        user_actions: [
          { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
          { id: 'reject', title: 'Reject', button_style: UserActionButtonType.Default },
        ],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })
  })

  // ── Output variables generation ──
  describe('HumanInput Output Variables', () => {
    it('should generate output variables from form inputs', () => {
      const payload = {
        ...humanInputDefault.defaultValue,
        inputs: [
          { type: 'text-input', output_variable_name: 'review_result', default: { selector: [], type: 'constant' as const, value: '' } },
          { type: 'text-input', output_variable_name: 'comment', default: { selector: [], type: 'constant' as const, value: '' } },
        ],
      } as HumanInputNodeType

      const outputVars = humanInputDefault.getOutputVars!(payload, {}, [])

      expect(outputVars).toEqual([
        { variable: 'review_result', type: 'string' },
        { variable: 'comment', type: 'string' },
      ])
    })

    it('should return empty output variables when no form inputs exist', () => {
      const payload = {
        ...humanInputDefault.defaultValue,
        inputs: [],
      } as HumanInputNodeType

      const outputVars = humanInputDefault.getOutputVars!(payload, {}, [])

      expect(outputVars).toEqual([])
    })
  })

  // ── Full DSL import simulation: start → human-input → end ──
  describe('Full Workflow with Human Input Node', () => {
    it('should process a start → human-input → end workflow without errors', () => {
      const startNode = createStartNode()
      const humanInputNode = createHumanInputNode()
      const endNode: Node = {
        id: 'end-1',
        type: 'custom',
        position: { x: 700, y: 200 },
        data: {
          type: BlockEnum.End,
          title: 'End',
          desc: '',
          outputs: [],
        } as Node['data'],
      }

      const nodes = [startNode, humanInputNode, endNode]
      const edges = [
        createEdge('start-1', 'human-input-1'),
        createEdge('human-input-1', 'end-1', 'approve', 'target'),
      ]

      const processed = preprocessNodesAndEdges(nodes as Node[], edges as Edge[])
      expect(processed.nodes).toHaveLength(3)
      expect(processed.edges).toHaveLength(2)

      const initialized = initialNodes(nodes as Node[], edges as Edge[])
      expect(initialized).toHaveLength(3)

      // All node types should be preserved
      const types = initialized.map(n => n.data.type)
      expect(types).toContain(BlockEnum.Start)
      expect(types).toContain(BlockEnum.HumanInput)
      expect(types).toContain(BlockEnum.End)
    })

    it('should handle multiple branches from human-input user actions', () => {
      const startNode = createStartNode()
      const humanInputNode = createHumanInputNode()
      const approveEndNode: Node = {
        id: 'approve-end',
        type: 'custom',
        position: { x: 700, y: 100 },
        data: { type: BlockEnum.End, title: 'Approve End', desc: '', outputs: [] } as Node['data'],
      }
      const rejectEndNode: Node = {
        id: 'reject-end',
        type: 'custom',
        position: { x: 700, y: 300 },
        data: { type: BlockEnum.End, title: 'Reject End', desc: '', outputs: [] } as Node['data'],
      }

      const nodes = [startNode, humanInputNode, approveEndNode, rejectEndNode]
      const edges = [
        createEdge('start-1', 'human-input-1'),
        createEdge('human-input-1', 'approve-end', 'approve', 'target'),
        createEdge('human-input-1', 'reject-end', 'reject', 'target'),
      ]

      const initialized = initialNodes(nodes as Node[], edges as Edge[])
      expect(initialized).toHaveLength(4)

      // Human input node should still have correct data
      const hiNode = initialized.find(n => n.id === 'human-input-1')!
      expect((hiNode.data as HumanInputNodeType).user_actions).toHaveLength(2)
      expect((hiNode.data as HumanInputNodeType).delivery_methods).toHaveLength(2)
    })
  })
})
