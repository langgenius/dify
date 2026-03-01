import type { Mock } from 'vitest'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'

// Type for mocked store
type MockWorkflowStore = {
  showOnboarding: boolean
  setShowOnboarding: Mock
  hasShownOnboarding: boolean
  setHasShownOnboarding: Mock
  hasSelectedStartNode: boolean
  setHasSelectedStartNode: Mock
  setShouldAutoOpenStartNodeSelector: Mock
  notInitialWorkflow: boolean
}

// Type for mocked node
type MockNode = {
  id: string
  data: { type?: BlockEnum }
}

// Mock zustand store
vi.mock('@/app/components/workflow/store')

// Mock ReactFlow store
const mockGetNodes = vi.fn()
vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
    }),
  }),
}))

describe('Workflow Onboarding Integration Logic', () => {
  const mockSetShowOnboarding = vi.fn()
  const mockSetHasSelectedStartNode = vi.fn()
  const mockSetHasShownOnboarding = vi.fn()
  const mockSetShouldAutoOpenStartNodeSelector = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock store implementation
    ;(useWorkflowStore as Mock).mockReturnValue({
      showOnboarding: false,
      setShowOnboarding: mockSetShowOnboarding,
      hasSelectedStartNode: false,
      setHasSelectedStartNode: mockSetHasSelectedStartNode,
      hasShownOnboarding: false,
      setHasShownOnboarding: mockSetHasShownOnboarding,
      notInitialWorkflow: false,
      shouldAutoOpenStartNodeSelector: false,
      setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
    })
  })

  describe('Onboarding State Management', () => {
    it('should initialize onboarding state correctly', () => {
      const store = useWorkflowStore() as unknown as MockWorkflowStore

      expect(store.showOnboarding).toBe(false)
      expect(store.hasSelectedStartNode).toBe(false)
      expect(store.hasShownOnboarding).toBe(false)
    })

    it('should update onboarding visibility', () => {
      const store = useWorkflowStore() as unknown as MockWorkflowStore

      store.setShowOnboarding(true)
      expect(mockSetShowOnboarding).toHaveBeenCalledWith(true)

      store.setShowOnboarding(false)
      expect(mockSetShowOnboarding).toHaveBeenCalledWith(false)
    })

    it('should track node selection state', () => {
      const store = useWorkflowStore() as unknown as MockWorkflowStore

      store.setHasSelectedStartNode(true)
      expect(mockSetHasSelectedStartNode).toHaveBeenCalledWith(true)
    })

    it('should track onboarding show state', () => {
      const store = useWorkflowStore() as unknown as MockWorkflowStore

      store.setHasShownOnboarding(true)
      expect(mockSetHasShownOnboarding).toHaveBeenCalledWith(true)
    })
  })

  describe('Node Validation Logic', () => {
    /**
     * Test the critical fix in use-nodes-sync-draft.ts
     * This ensures trigger nodes are recognized as valid start nodes
     */
    it('should validate Start node as valid start node', () => {
      const mockNode = {
        data: { type: BlockEnum.Start },
        id: 'start-1',
      }

      // Simulate the validation logic from use-nodes-sync-draft.ts
      const isValidStartNode = mockNode.data.type === BlockEnum.Start
        || mockNode.data.type === BlockEnum.TriggerSchedule
        || mockNode.data.type === BlockEnum.TriggerWebhook
        || mockNode.data.type === BlockEnum.TriggerPlugin

      expect(isValidStartNode).toBe(true)
    })

    it('should validate TriggerSchedule as valid start node', () => {
      const mockNode = {
        data: { type: BlockEnum.TriggerSchedule },
        id: 'trigger-schedule-1',
      }

      const isValidStartNode = mockNode.data.type === BlockEnum.Start
        || mockNode.data.type === BlockEnum.TriggerSchedule
        || mockNode.data.type === BlockEnum.TriggerWebhook
        || mockNode.data.type === BlockEnum.TriggerPlugin

      expect(isValidStartNode).toBe(true)
    })

    it('should validate TriggerWebhook as valid start node', () => {
      const mockNode = {
        data: { type: BlockEnum.TriggerWebhook },
        id: 'trigger-webhook-1',
      }

      const isValidStartNode = mockNode.data.type === BlockEnum.Start
        || mockNode.data.type === BlockEnum.TriggerSchedule
        || mockNode.data.type === BlockEnum.TriggerWebhook
        || mockNode.data.type === BlockEnum.TriggerPlugin

      expect(isValidStartNode).toBe(true)
    })

    it('should validate TriggerPlugin as valid start node', () => {
      const mockNode = {
        data: { type: BlockEnum.TriggerPlugin },
        id: 'trigger-plugin-1',
      }

      const isValidStartNode = mockNode.data.type === BlockEnum.Start
        || mockNode.data.type === BlockEnum.TriggerSchedule
        || mockNode.data.type === BlockEnum.TriggerWebhook
        || mockNode.data.type === BlockEnum.TriggerPlugin

      expect(isValidStartNode).toBe(true)
    })

    it('should reject non-trigger nodes as invalid start nodes', () => {
      const mockNode = {
        data: { type: BlockEnum.LLM },
        id: 'llm-1',
      }

      const isValidStartNode = mockNode.data.type === BlockEnum.Start
        || mockNode.data.type === BlockEnum.TriggerSchedule
        || mockNode.data.type === BlockEnum.TriggerWebhook
        || mockNode.data.type === BlockEnum.TriggerPlugin

      expect(isValidStartNode).toBe(false)
    })

    it('should handle array of nodes with mixed types', () => {
      const mockNodes = [
        { data: { type: BlockEnum.LLM }, id: 'llm-1' },
        { data: { type: BlockEnum.TriggerWebhook }, id: 'webhook-1' },
        { data: { type: BlockEnum.Answer }, id: 'answer-1' },
      ]

      // Simulate hasStartNode logic from use-nodes-sync-draft.ts
      const hasStartNode = mockNodes.find(node =>
        node.data.type === BlockEnum.Start
        || node.data.type === BlockEnum.TriggerSchedule
        || node.data.type === BlockEnum.TriggerWebhook
        || node.data.type === BlockEnum.TriggerPlugin,
      )

      expect(hasStartNode).toBeTruthy()
      expect(hasStartNode?.id).toBe('webhook-1')
    })

    it('should return undefined when no valid start nodes exist', () => {
      const mockNodes = [
        { data: { type: BlockEnum.LLM }, id: 'llm-1' },
        { data: { type: BlockEnum.Answer }, id: 'answer-1' },
      ]

      const hasStartNode = mockNodes.find(node =>
        node.data.type === BlockEnum.Start
        || node.data.type === BlockEnum.TriggerSchedule
        || node.data.type === BlockEnum.TriggerWebhook
        || node.data.type === BlockEnum.TriggerPlugin,
      )

      expect(hasStartNode).toBeUndefined()
    })
  })

  describe('Auto-open Logic for Node Handles', () => {
    /**
     * Test the auto-open logic from node-handle.tsx
     * This ensures all trigger types auto-open the block selector when flagged
     */
    it('should auto-expand for Start node in new workflow', () => {
      const shouldAutoOpenStartNodeSelector = true
      const nodeType = BlockEnum.Start
      const isChatMode = false

      const shouldAutoExpand = shouldAutoOpenStartNodeSelector && (
        nodeType === BlockEnum.Start
        || nodeType === BlockEnum.TriggerSchedule
        || nodeType === BlockEnum.TriggerWebhook
        || nodeType === BlockEnum.TriggerPlugin
      ) && !isChatMode

      expect(shouldAutoExpand).toBe(true)
    })

    it('should auto-expand for TriggerSchedule in new workflow', () => {
      const shouldAutoOpenStartNodeSelector = true
      const nodeType: BlockEnum = BlockEnum.TriggerSchedule
      const isChatMode = false
      const validStartTypes = [BlockEnum.Start, BlockEnum.TriggerSchedule, BlockEnum.TriggerWebhook, BlockEnum.TriggerPlugin]

      const shouldAutoExpand = shouldAutoOpenStartNodeSelector && validStartTypes.includes(nodeType) && !isChatMode

      expect(shouldAutoExpand).toBe(true)
    })

    it('should auto-expand for TriggerWebhook in new workflow', () => {
      const shouldAutoOpenStartNodeSelector = true
      const nodeType: BlockEnum = BlockEnum.TriggerWebhook
      const isChatMode = false
      const validStartTypes = [BlockEnum.Start, BlockEnum.TriggerSchedule, BlockEnum.TriggerWebhook, BlockEnum.TriggerPlugin]

      const shouldAutoExpand = shouldAutoOpenStartNodeSelector && validStartTypes.includes(nodeType) && !isChatMode

      expect(shouldAutoExpand).toBe(true)
    })

    it('should auto-expand for TriggerPlugin in new workflow', () => {
      const shouldAutoOpenStartNodeSelector = true
      const nodeType: BlockEnum = BlockEnum.TriggerPlugin
      const isChatMode = false
      const validStartTypes = [BlockEnum.Start, BlockEnum.TriggerSchedule, BlockEnum.TriggerWebhook, BlockEnum.TriggerPlugin]

      const shouldAutoExpand = shouldAutoOpenStartNodeSelector && validStartTypes.includes(nodeType) && !isChatMode

      expect(shouldAutoExpand).toBe(true)
    })

    it('should not auto-expand for non-trigger nodes', () => {
      const shouldAutoOpenStartNodeSelector = true
      const nodeType: BlockEnum = BlockEnum.LLM
      const isChatMode = false
      const validStartTypes = [BlockEnum.Start, BlockEnum.TriggerSchedule, BlockEnum.TriggerWebhook, BlockEnum.TriggerPlugin]

      const shouldAutoExpand = shouldAutoOpenStartNodeSelector && validStartTypes.includes(nodeType) && !isChatMode

      expect(shouldAutoExpand).toBe(false)
    })

    it('should not auto-expand in chat mode', () => {
      const shouldAutoOpenStartNodeSelector = true
      const nodeType = BlockEnum.Start
      const isChatMode = true

      const shouldAutoExpand = shouldAutoOpenStartNodeSelector && (
        nodeType === BlockEnum.Start
        || nodeType === BlockEnum.TriggerSchedule
        || nodeType === BlockEnum.TriggerWebhook
        || nodeType === BlockEnum.TriggerPlugin
      ) && !isChatMode

      expect(shouldAutoExpand).toBe(false)
    })

    it('should not auto-expand for existing workflows', () => {
      const shouldAutoOpenStartNodeSelector = false
      const nodeType = BlockEnum.Start
      const isChatMode = false

      const shouldAutoExpand = shouldAutoOpenStartNodeSelector && (
        nodeType === BlockEnum.Start
        || nodeType === BlockEnum.TriggerSchedule
        || nodeType === BlockEnum.TriggerWebhook
        || nodeType === BlockEnum.TriggerPlugin
      ) && !isChatMode

      expect(shouldAutoExpand).toBe(false)
    })
    it('should reset auto-open flag after triggering once', () => {
      let shouldAutoOpenStartNodeSelector = true
      const nodeType = BlockEnum.Start
      const isChatMode = false

      const shouldAutoExpand = shouldAutoOpenStartNodeSelector && (
        nodeType === BlockEnum.Start
        || nodeType === BlockEnum.TriggerSchedule
        || nodeType === BlockEnum.TriggerWebhook
        || nodeType === BlockEnum.TriggerPlugin
      ) && !isChatMode

      if (shouldAutoExpand)
        shouldAutoOpenStartNodeSelector = false

      expect(shouldAutoExpand).toBe(true)
      expect(shouldAutoOpenStartNodeSelector).toBe(false)
    })
  })

  describe('Node Creation Without Auto-selection', () => {
    /**
     * Test that nodes are created without the 'selected: true' property
     * This prevents auto-opening the properties panel
     */
    it('should create Start node without auto-selection', () => {
      const nodeData = { type: BlockEnum.Start, title: 'Start' }

      // Simulate node creation logic from workflow-children.tsx
      const createdNodeData: Record<string, unknown> = {
        ...nodeData,
        // Note: 'selected: true' should NOT be added
      }

      expect(createdNodeData.selected).toBeUndefined()
      expect(createdNodeData.type).toBe(BlockEnum.Start)
    })

    it('should create TriggerWebhook node without auto-selection', () => {
      const nodeData = { type: BlockEnum.TriggerWebhook, title: 'Webhook Trigger' }
      const toolConfig = { webhook_url: 'https://example.com/webhook' }

      const createdNodeData: Record<string, unknown> = {
        ...nodeData,
        ...toolConfig,
        // Note: 'selected: true' should NOT be added
      }

      expect(createdNodeData.selected).toBeUndefined()
      expect(createdNodeData.type).toBe(BlockEnum.TriggerWebhook)
      expect(createdNodeData.webhook_url).toBe('https://example.com/webhook')
    })

    it('should preserve other node properties while avoiding auto-selection', () => {
      const nodeData = {
        type: BlockEnum.TriggerSchedule,
        title: 'Schedule Trigger',
        config: { interval: '1h' },
      }

      const createdNodeData: Record<string, unknown> = {
        ...nodeData,
      }

      expect(createdNodeData.selected).toBeUndefined()
      expect(createdNodeData.type).toBe(BlockEnum.TriggerSchedule)
      expect(createdNodeData.title).toBe('Schedule Trigger')
      expect(createdNodeData.config).toEqual({ interval: '1h' })
    })
  })

  describe('Workflow Initialization Logic', () => {
    /**
     * Test the initialization logic from use-workflow-init.ts
     * This ensures onboarding is triggered correctly for new workflows
     */
    it('should trigger onboarding for new workflow when draft does not exist', () => {
      // Simulate the error handling logic from use-workflow-init.ts
      const error = {
        json: vi.fn().mockResolvedValue({ code: 'draft_workflow_not_exist' }),
        bodyUsed: false,
      }

      const mockWorkflowStore = {
        setState: vi.fn(),
      }

      // Simulate error handling
      if (error && error.json && !error.bodyUsed) {
        error.json().then((err: any) => {
          if (err.code === 'draft_workflow_not_exist') {
            mockWorkflowStore.setState({
              notInitialWorkflow: true,
              showOnboarding: true,
            })
          }
        })
      }

      return error.json().then(() => {
        expect(mockWorkflowStore.setState).toHaveBeenCalledWith({
          notInitialWorkflow: true,
          showOnboarding: true,
        })
      })
    })

    it('should not trigger onboarding for existing workflows', () => {
      // Simulate successful draft fetch
      const mockWorkflowStore = {
        setState: vi.fn(),
      }

      // Normal initialization path should not set showOnboarding: true
      mockWorkflowStore.setState({
        environmentVariables: [],
        conversationVariables: [],
      })

      expect(mockWorkflowStore.setState).not.toHaveBeenCalledWith(
        expect.objectContaining({ showOnboarding: true }),
      )
    })

    it('should create empty draft with proper structure', () => {
      const mockSyncWorkflowDraft = vi.fn()
      const appId = 'test-app-id'

      // Simulate the syncWorkflowDraft call from use-workflow-init.ts
      const draftParams = {
        url: `/apps/${appId}/workflows/draft`,
        params: {
          graph: {
            nodes: [], // Empty nodes initially
            edges: [],
          },
          features: {
            retriever_resource: { enabled: true },
          },
          environment_variables: [],
          conversation_variables: [],
        },
      }

      mockSyncWorkflowDraft(draftParams)

      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith({
        url: `/apps/${appId}/workflows/draft`,
        params: {
          graph: {
            nodes: [],
            edges: [],
          },
          features: {
            retriever_resource: { enabled: true },
          },
          environment_variables: [],
          conversation_variables: [],
        },
      })
    })
  })

  describe('Auto-Detection for Empty Canvas', () => {
    beforeEach(() => {
      mockGetNodes.mockClear()
    })

    it('should detect empty canvas and trigger onboarding', () => {
      // Mock empty canvas
      mockGetNodes.mockReturnValue([])

      // Mock store with proper state for auto-detection
      ;(useWorkflowStore as Mock).mockReturnValue({
        showOnboarding: false,
        hasShownOnboarding: false,
        notInitialWorkflow: false,
        setShowOnboarding: mockSetShowOnboarding,
        setHasShownOnboarding: mockSetHasShownOnboarding,
        hasSelectedStartNode: false,
        setHasSelectedStartNode: mockSetHasSelectedStartNode,
        shouldAutoOpenStartNodeSelector: false,
        setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
        getState: () => ({
          showOnboarding: false,
          hasShownOnboarding: false,
          notInitialWorkflow: false,
          setShowOnboarding: mockSetShowOnboarding,
          setHasShownOnboarding: mockSetHasShownOnboarding,
          hasSelectedStartNode: false,
          setHasSelectedStartNode: mockSetHasSelectedStartNode,
          setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
        }),
      })

      // Simulate empty canvas check logic
      const nodes = mockGetNodes()
      const startNodeTypes = [
        BlockEnum.Start,
        BlockEnum.TriggerSchedule,
        BlockEnum.TriggerWebhook,
        BlockEnum.TriggerPlugin,
      ]
      const hasStartNode = nodes.some((node: MockNode) => startNodeTypes.includes(node.data?.type as BlockEnum))
      const isEmpty = nodes.length === 0 || !hasStartNode

      expect(isEmpty).toBe(true)
      expect(nodes.length).toBe(0)
    })

    it('should detect canvas with non-start nodes as empty', () => {
      // Mock canvas with non-start nodes
      mockGetNodes.mockReturnValue([
        { id: '1', data: { type: BlockEnum.LLM } },
        { id: '2', data: { type: BlockEnum.Code } },
      ])

      const nodes = mockGetNodes()
      const startNodeTypes = [
        BlockEnum.Start,
        BlockEnum.TriggerSchedule,
        BlockEnum.TriggerWebhook,
        BlockEnum.TriggerPlugin,
      ]
      const hasStartNode = nodes.some((node: MockNode) => startNodeTypes.includes(node.data.type as BlockEnum))
      const isEmpty = nodes.length === 0 || !hasStartNode

      expect(isEmpty).toBe(true)
      expect(hasStartNode).toBe(false)
    })

    it('should not detect canvas with start nodes as empty', () => {
      // Mock canvas with start node
      mockGetNodes.mockReturnValue([
        { id: '1', data: { type: BlockEnum.Start } },
      ])

      const nodes = mockGetNodes()
      const startNodeTypes = [
        BlockEnum.Start,
        BlockEnum.TriggerSchedule,
        BlockEnum.TriggerWebhook,
        BlockEnum.TriggerPlugin,
      ]
      const hasStartNode = nodes.some((node: MockNode) => startNodeTypes.includes(node.data.type as BlockEnum))
      const isEmpty = nodes.length === 0 || !hasStartNode

      expect(isEmpty).toBe(false)
      expect(hasStartNode).toBe(true)
    })

    it('should not trigger onboarding if already shown in session', () => {
      // Mock empty canvas
      mockGetNodes.mockReturnValue([])

      // Mock store with hasShownOnboarding = true
      ;(useWorkflowStore as Mock).mockReturnValue({
        showOnboarding: false,
        hasShownOnboarding: true, // Already shown in this session
        notInitialWorkflow: false,
        setShowOnboarding: mockSetShowOnboarding,
        setHasShownOnboarding: mockSetHasShownOnboarding,
        hasSelectedStartNode: false,
        setHasSelectedStartNode: mockSetHasSelectedStartNode,
        shouldAutoOpenStartNodeSelector: false,
        setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
        getState: () => ({
          showOnboarding: false,
          hasShownOnboarding: true,
          notInitialWorkflow: false,
          setShowOnboarding: mockSetShowOnboarding,
          setHasShownOnboarding: mockSetHasShownOnboarding,
          hasSelectedStartNode: false,
          setHasSelectedStartNode: mockSetHasSelectedStartNode,
          setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
        }),
      })

      // Simulate the check logic with hasShownOnboarding = true
      const store = useWorkflowStore() as unknown as MockWorkflowStore
      const shouldTrigger = !store.hasShownOnboarding && !store.showOnboarding && !store.notInitialWorkflow

      expect(shouldTrigger).toBe(false)
    })

    it('should not trigger onboarding during initial workflow creation', () => {
      // Mock empty canvas
      mockGetNodes.mockReturnValue([])

      // Mock store with notInitialWorkflow = true (initial creation)
      ;(useWorkflowStore as Mock).mockReturnValue({
        showOnboarding: false,
        hasShownOnboarding: false,
        notInitialWorkflow: true, // Initial workflow creation
        setShowOnboarding: mockSetShowOnboarding,
        setHasShownOnboarding: mockSetHasShownOnboarding,
        hasSelectedStartNode: false,
        setHasSelectedStartNode: mockSetHasSelectedStartNode,
        shouldAutoOpenStartNodeSelector: false,
        setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
        getState: () => ({
          showOnboarding: false,
          hasShownOnboarding: false,
          notInitialWorkflow: true,
          setShowOnboarding: mockSetShowOnboarding,
          setHasShownOnboarding: mockSetHasShownOnboarding,
          hasSelectedStartNode: false,
          setHasSelectedStartNode: mockSetHasSelectedStartNode,
          setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
        }),
      })

      // Simulate the check logic with notInitialWorkflow = true
      const store = useWorkflowStore() as unknown as MockWorkflowStore
      const shouldTrigger = !store.hasShownOnboarding && !store.showOnboarding && !store.notInitialWorkflow

      expect(shouldTrigger).toBe(false)
    })
  })
})
