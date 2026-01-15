import type { MockedFunction } from 'vitest'
import type { Node } from '@/app/components/workflow/types'
import { getWorkflowEntryNode } from '@/app/components/workflow/utils/workflow-entry'

// Mock the getWorkflowEntryNode function
vi.mock('@/app/components/workflow/utils/workflow-entry', () => ({
  getWorkflowEntryNode: vi.fn(),
}))

const mockGetWorkflowEntryNode = getWorkflowEntryNode as MockedFunction<typeof getWorkflowEntryNode>

// Mock entry node for testing (truthy value)
const mockEntryNode = { id: 'start-node', data: { type: 'start' } } as Node

describe('App Card Toggle Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper function that mirrors the actual logic from app-card.tsx
  const calculateToggleState = (
    appMode: string,
    currentWorkflow: any,
    isCurrentWorkspaceEditor: boolean,
    isCurrentWorkspaceManager: boolean,
    cardType: 'webapp' | 'api',
  ) => {
    const isWorkflowApp = appMode === 'workflow'
    const appUnpublished = isWorkflowApp && !currentWorkflow?.graph
    const hasEntryNode = mockGetWorkflowEntryNode(currentWorkflow?.graph?.nodes || [])
    const missingEntryNode = isWorkflowApp && !hasEntryNode
    const hasInsufficientPermissions = cardType === 'webapp' ? !isCurrentWorkspaceEditor : !isCurrentWorkspaceManager
    const toggleDisabled = hasInsufficientPermissions || appUnpublished || missingEntryNode
    const isMinimalState = appUnpublished || missingEntryNode

    return {
      toggleDisabled,
      isMinimalState,
      appUnpublished,
      missingEntryNode,
      hasInsufficientPermissions,
    }
  }

  describe('Entry Node Detection Logic', () => {
    it('should disable toggle when workflow missing entry node', () => {
      mockGetWorkflowEntryNode.mockReturnValue(undefined)

      const result = calculateToggleState(
        'workflow',
        { graph: { nodes: [] } },
        true,
        true,
        'webapp',
      )

      expect(result.toggleDisabled).toBe(true)
      expect(result.missingEntryNode).toBe(true)
      expect(result.isMinimalState).toBe(true)
    })

    it('should enable toggle when workflow has entry node', () => {
      mockGetWorkflowEntryNode.mockReturnValue(mockEntryNode)

      const result = calculateToggleState(
        'workflow',
        { graph: { nodes: [{ data: { type: 'start' } }] } },
        true,
        true,
        'webapp',
      )

      expect(result.toggleDisabled).toBe(false)
      expect(result.missingEntryNode).toBe(false)
      expect(result.isMinimalState).toBe(false)
    })
  })

  describe('Published State Logic', () => {
    it('should disable toggle when workflow unpublished (no graph)', () => {
      const result = calculateToggleState(
        'workflow',
        null, // No workflow data = unpublished
        true,
        true,
        'webapp',
      )

      expect(result.toggleDisabled).toBe(true)
      expect(result.appUnpublished).toBe(true)
      expect(result.isMinimalState).toBe(true)
    })

    it('should disable toggle when workflow unpublished (empty graph)', () => {
      const result = calculateToggleState(
        'workflow',
        {}, // No graph property = unpublished
        true,
        true,
        'webapp',
      )

      expect(result.toggleDisabled).toBe(true)
      expect(result.appUnpublished).toBe(true)
      expect(result.isMinimalState).toBe(true)
    })

    it('should consider published state when workflow has graph', () => {
      mockGetWorkflowEntryNode.mockReturnValue(mockEntryNode)

      const result = calculateToggleState(
        'workflow',
        { graph: { nodes: [] } },
        true,
        true,
        'webapp',
      )

      expect(result.appUnpublished).toBe(false)
    })
  })

  describe('Permissions Logic', () => {
    it('should disable webapp toggle when user lacks editor permissions', () => {
      mockGetWorkflowEntryNode.mockReturnValue(mockEntryNode)

      const result = calculateToggleState(
        'workflow',
        { graph: { nodes: [] } },
        false, // No editor permission
        true,
        'webapp',
      )

      expect(result.toggleDisabled).toBe(true)
      expect(result.hasInsufficientPermissions).toBe(true)
    })

    it('should disable api toggle when user lacks manager permissions', () => {
      mockGetWorkflowEntryNode.mockReturnValue(mockEntryNode)

      const result = calculateToggleState(
        'workflow',
        { graph: { nodes: [] } },
        true,
        false, // No manager permission
        'api',
      )

      expect(result.toggleDisabled).toBe(true)
      expect(result.hasInsufficientPermissions).toBe(true)
    })

    it('should enable toggle when user has proper permissions', () => {
      mockGetWorkflowEntryNode.mockReturnValue(mockEntryNode)

      const webappResult = calculateToggleState(
        'workflow',
        { graph: { nodes: [] } },
        true, // Has editor permission
        false,
        'webapp',
      )

      const apiResult = calculateToggleState(
        'workflow',
        { graph: { nodes: [] } },
        false,
        true, // Has manager permission
        'api',
      )

      expect(webappResult.toggleDisabled).toBe(false)
      expect(apiResult.toggleDisabled).toBe(false)
    })
  })

  describe('Combined Conditions Logic', () => {
    it('should handle multiple disable conditions correctly', () => {
      mockGetWorkflowEntryNode.mockReturnValue(undefined)

      const result = calculateToggleState(
        'workflow',
        null, // Unpublished
        false, // No permissions
        false,
        'webapp',
      )

      // All three conditions should be true
      expect(result.appUnpublished).toBe(true)
      expect(result.missingEntryNode).toBe(true)
      expect(result.hasInsufficientPermissions).toBe(true)
      expect(result.toggleDisabled).toBe(true)
      expect(result.isMinimalState).toBe(true)
    })

    it('should enable when all conditions are satisfied', () => {
      mockGetWorkflowEntryNode.mockReturnValue(mockEntryNode)

      const result = calculateToggleState(
        'workflow',
        { graph: { nodes: [{ data: { type: 'start' } }] } }, // Published
        true, // Has permissions
        true,
        'webapp',
      )

      expect(result.appUnpublished).toBe(false)
      expect(result.missingEntryNode).toBe(false)
      expect(result.hasInsufficientPermissions).toBe(false)
      expect(result.toggleDisabled).toBe(false)
      expect(result.isMinimalState).toBe(false)
    })
  })

  describe('Non-Workflow Apps', () => {
    it('should not check workflow-specific conditions for non-workflow apps', () => {
      const result = calculateToggleState(
        'chat', // Non-workflow mode
        null,
        true,
        true,
        'webapp',
      )

      expect(result.appUnpublished).toBe(false) // isWorkflowApp is false
      expect(result.missingEntryNode).toBe(false) // isWorkflowApp is false
      expect(result.toggleDisabled).toBe(false)
      expect(result.isMinimalState).toBe(false)
    })
  })
})
