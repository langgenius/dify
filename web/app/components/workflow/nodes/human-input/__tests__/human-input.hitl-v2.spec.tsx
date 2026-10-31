import type { ReactNode } from 'react'
import type { HumanInputNodeType } from '@/app/components/workflow/nodes/human-input/types'
import type { Node } from '@/app/components/workflow/types'
import { describe, expect, it, vi } from 'vite-plus/test'
import humanInputDefault from '@/app/components/workflow/nodes/human-input/default'
import {
  DeliveryMethodType,
  UserActionButtonType,
} from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'

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
vi.mock('../../../hooks/use-available-blocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/use-available-blocks')>()

  return {
    ...actual,
    useAvailableBlocks: () => ({
      availableNextBlocks: [],
      availablePrevBlocks: [],
    }),
  }
})

vi.mock('../../../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/use-nodes-interactions')>()

  return {
    ...actual,
    useNodesInteractions: () => ({
      handleNodeAdd: vi.fn(),
    }),
  }
})

vi.mock('../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/use-workflow')>()

  return {
    ...actual,
    useNodesReadOnly: () => ({
      getNodesReadOnly: () => false,
      nodesReadOnly: false,
    }),
    useIsChatMode: () => false,
  }
})

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

describe('DSL Import with Human Input Node', () => {
  // ── preprocessNodesAndEdges: human-input nodes pass through without error ──

  // ── initialNodes: human-input nodes are properly initialized ──

  // ── Node registration: human-input is included in the workflow node registry ──
  // Verify via WORKFLOW_COMMON_NODES (lightweight metadata-only imports) instead
  // of NodeComponentMap/PanelComponentMap which pull in every node's heavy UI deps.

  // ── Default config & validation ──
  describe('HumanInput Default Configuration', () => {
    it('rejects an imported action ID that conflicts with the timeout branch', () => {
      const t = withSelectorKey((key: string) => key, 'workflow')
      const node = createHumanInputNode({
        delivery_methods: [{ id: 'dm-1', type: DeliveryMethodType.WebApp, enabled: true }],
        user_actions: [
          { id: '__timeout', title: 'Approve', button_style: UserActionButtonType.Primary },
        ],
      })

      expect(humanInputDefault.checkValid(node.data as HumanInputNodeType, t)).toEqual({
        isValid: false,
        errorMessage: 'nodes.humanInput.errorMsg.reservedActionId',
      })
    })
  })

  // ── Output variables generation ──

  // ── Full DSL import simulation: start → human-input → end ──
})
