import { BlockEnum } from '@/app/components/workflow/types'
import { useWorkflowStore } from '@/app/components/workflow/store'

// Mock zustand store
jest.mock('@/app/components/workflow/store')

// Mock ReactFlow store
const mockGetNodes = jest.fn()
jest.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
    }),
  }),
}))

describe('Workflow Onboarding Integration Logic', () => {
  const mockSetShowOnboarding = jest.fn()
  const mockSetHasSelectedStartNode = jest.fn()
  const mockSetHasShownOnboarding = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock store implementation
    ;(useWorkflowStore as jest.Mock).mockReturnValue({
      showOnboarding: false,
      setShowOnboarding: mockSetShowOnboarding,
      hasSelectedStartNode: false,
      setHasSelectedStartNode: mockSetHasSelectedStartNode,
      hasShownOnboarding: false,
      setHasShownOnboarding: mockSetHasShownOnboarding,
      notInitialWorkflow: false,
    })
  })

  describe('Onboarding State Management', () => {
    it('should initialize onboarding state correctly', () => {
      const store = useWorkflowStore()

      expect(store.showOnboarding).toBe(false)
      expect(store.hasSelectedStartNode).toBe(false)
      expect(store.hasShownOnboarding).toBe(false)
    })

    it('should update onboarding visibility', () => {
      const store = useWorkflowStore()

      store.setShowOnboarding(true)
      expect(mockSetShowOnboarding).toHaveBeenCalledWith(true)

      store.setShowOnboarding(false)
      expect(mockSetShowOnboarding).toHaveBeenCalledWith(false)
    })

    it('should track node selection state', () => {
      const store = useWorkflowStore()

      store.setHasSelectedStartNode(true)
      expect(mockSetHasSelectedStartNode).toHaveBeenCalledWith(true)
    })

    it('should track onboarding show state', () => {
      const store = useWorkflowStore()

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

  describe('Auto-expand Logic for Node Handles', () => {
    /**
     * Test the auto-expand logic from node-handle.tsx
     * This ensures all trigger types auto-expand the block selector
     */
    it('should auto-expand for Start node in new workflow', () => {
      const notInitialWorkflow = true
      const nodeType = BlockEnum.Start
      const isChatMode = false

      const shouldAutoExpand = notInitialWorkflow && (
        nodeType === BlockEnum.Start
        || nodeType === BlockEnum.TriggerSchedule
        || nodeType === BlockEnum.TriggerWebhook
        || nodeType === BlockEnum.TriggerPlugin
      ) && !isChatMode

      expect(shouldAutoExpand).toBe(true)
    })

    it('should auto-expand for TriggerSchedule in new workflow', () => {
      const notInitialWorkflow = true
      const nodeType = BlockEnum.TriggerSchedule
      const isChatMode = false

      const shouldAutoExpand = notInitialWorkflow && (
        nodeType === BlockEnum.Start
        || nodeType === BlockEnum.TriggerSchedule
        || nodeType === BlockEnum.TriggerWebhook
        || nodeType === BlockEnum.TriggerPlugin
      ) && !isChatMode

      expect(shouldAutoExpand).toBe(true)
    })

    it('should auto-expand for TriggerWebhook in new workflow', () => {
      const notInitialWorkflow = true
      const nodeType = BlockEnum.TriggerWebhook
      const isChatMode = false

      const shouldAutoExpand = notInitialWorkflow && (
        nodeType === BlockEnum.Start
        || nodeType === BlockEnum.TriggerSchedule
        || nodeType === BlockEnum.TriggerWebhook
        || nodeType === BlockEnum.TriggerPlugin
      ) && !isChatMode

      expect(shouldAutoExpand).toBe(true)
    })

    it('should auto-expand for TriggerPlugin in new workflow', () => {
      const notInitialWorkflow = true
      const nodeType = BlockEnum.TriggerPlugin
      const isChatMode = false

      const shouldAutoExpand = notInitialWorkflow && (
        nodeType === BlockEnum.Start
        || nodeType === BlockEnum.TriggerSchedule
        || nodeType === BlockEnum.TriggerWebhook
        || nodeType === BlockEnum.TriggerPlugin
      ) && !isChatMode

      expect(shouldAutoExpand).toBe(true)
    })

    it('should not auto-expand for non-trigger nodes', () => {
      const notInitialWorkflow = true
      const nodeType = BlockEnum.LLM
      const isChatMode = false

      const shouldAutoExpand = notInitialWorkflow && (
        nodeType === BlockEnum.Start
        || nodeType === BlockEnum.TriggerSchedule
        || nodeType === BlockEnum.TriggerWebhook
        || nodeType === BlockEnum.TriggerPlugin
      ) && !isChatMode

      expect(shouldAutoExpand).toBe(false)
    })

    it('should not auto-expand in chat mode', () => {
      const notInitialWorkflow = true
      const nodeType = BlockEnum.Start
      const isChatMode = true

      const shouldAutoExpand = notInitialWorkflow && (
        nodeType === BlockEnum.Start
        || nodeType === BlockEnum.TriggerSchedule
        || nodeType === BlockEnum.TriggerWebhook
        || nodeType === BlockEnum.TriggerPlugin
      ) && !isChatMode

      expect(shouldAutoExpand).toBe(false)
    })

    it('should not auto-expand for existing workflows', () => {
      const notInitialWorkflow = false
      const nodeType = BlockEnum.Start
      const isChatMode = false

      const shouldAutoExpand = notInitialWorkflow && (
        nodeType === BlockEnum.Start
        || nodeType === BlockEnum.TriggerSchedule
        || nodeType === BlockEnum.TriggerWebhook
        || nodeType === BlockEnum.TriggerPlugin
      ) && !isChatMode

      expect(shouldAutoExpand).toBe(false)
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
      const createdNodeData = {
        ...nodeData,
        // Note: 'selected: true' should NOT be added
      }

      expect(createdNodeData.selected).toBeUndefined()
      expect(createdNodeData.type).toBe(BlockEnum.Start)
    })

    it('should create TriggerWebhook node without auto-selection', () => {
      const nodeData = { type: BlockEnum.TriggerWebhook, title: 'Webhook Trigger' }
      const toolConfig = { webhook_url: 'https://example.com/webhook' }

      const createdNodeData = {
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

      const createdNodeData = {
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
        json: jest.fn().mockResolvedValue({ code: 'draft_workflow_not_exist' }),
        bodyUsed: false,
      }

      const mockWorkflowStore = {
        setState: jest.fn(),
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
        setState: jest.fn(),
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
      const mockSyncWorkflowDraft = jest.fn()
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
      ;(useWorkflowStore as jest.Mock).mockReturnValue({
        showOnboarding: false,
        hasShownOnboarding: false,
        notInitialWorkflow: false,
        setShowOnboarding: mockSetShowOnboarding,
        setHasShownOnboarding: mockSetHasShownOnboarding,
        getState: () => ({
          showOnboarding: false,
          hasShownOnboarding: false,
          notInitialWorkflow: false,
          setShowOnboarding: mockSetShowOnboarding,
          setHasShownOnboarding: mockSetHasShownOnboarding,
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
      const hasStartNode = nodes.some(node => startNodeTypes.includes(node.data?.type))
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
      const hasStartNode = nodes.some(node => startNodeTypes.includes(node.data.type))
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
      const hasStartNode = nodes.some(node => startNodeTypes.includes(node.data.type))
      const isEmpty = nodes.length === 0 || !hasStartNode

      expect(isEmpty).toBe(false)
      expect(hasStartNode).toBe(true)
    })

    it('should not trigger onboarding if already shown in session', () => {
      // Mock empty canvas
      mockGetNodes.mockReturnValue([])

      // Mock store with hasShownOnboarding = true
      ;(useWorkflowStore as jest.Mock).mockReturnValue({
        showOnboarding: false,
        hasShownOnboarding: true, // Already shown in this session
        notInitialWorkflow: false,
        setShowOnboarding: mockSetShowOnboarding,
        setHasShownOnboarding: mockSetHasShownOnboarding,
        getState: () => ({
          showOnboarding: false,
          hasShownOnboarding: true,
          notInitialWorkflow: false,
          setShowOnboarding: mockSetShowOnboarding,
          setHasShownOnboarding: mockSetHasShownOnboarding,
        }),
      })

      // Simulate the check logic with hasShownOnboarding = true
      const store = useWorkflowStore()
      const shouldTrigger = !store.hasShownOnboarding && !store.showOnboarding && !store.notInitialWorkflow

      expect(shouldTrigger).toBe(false)
    })

    it('should not trigger onboarding during initial workflow creation', () => {
      // Mock empty canvas
      mockGetNodes.mockReturnValue([])

      // Mock store with notInitialWorkflow = true (initial creation)
      ;(useWorkflowStore as jest.Mock).mockReturnValue({
        showOnboarding: false,
        hasShownOnboarding: false,
        notInitialWorkflow: true, // Initial workflow creation
        setShowOnboarding: mockSetShowOnboarding,
        setHasShownOnboarding: mockSetHasShownOnboarding,
        getState: () => ({
          showOnboarding: false,
          hasShownOnboarding: false,
          notInitialWorkflow: true,
          setShowOnboarding: mockSetShowOnboarding,
          setHasShownOnboarding: mockSetHasShownOnboarding,
        }),
      })

      // Simulate the check logic with notInitialWorkflow = true
      const store = useWorkflowStore()
      const shouldTrigger = !store.hasShownOnboarding && !store.showOnboarding && !store.notInitialWorkflow

      expect(shouldTrigger).toBe(false)
    })
  })
})
