/**
 * useDynamicTestRunOptions Hook Test
 *
 * Tests for the dynamic test run options generation hook that replaces mock data
 * with real workflow node data for the test run dropdown.
 */

import { renderHook } from '@testing-library/react'
import React from 'react'
import type { Node } from 'reactflow'
import { useDynamicTestRunOptions } from '@/app/components/workflow/hooks/use-dynamic-test-run-options'
import { BlockEnum } from '@/app/components/workflow/types'
import { CollectionType } from '@/app/components/tools/types'

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'workflow.blocks.start': 'User Input',
        'workflow.blocks.trigger-schedule': 'Schedule Trigger',
        'workflow.blocks.trigger-webhook': 'Webhook Trigger',
        'workflow.blocks.trigger-plugin': 'Plugin Trigger',
        'workflow.common.runAllTriggers': 'Run all triggers',
      }
      return translations[key] || key
    },
  }),
}))

// Mock reactflow
const mockNodes: Node[] = []
jest.mock('reactflow', () => ({
  useNodes: () => mockNodes,
}))

// Mock workflow store
const mockStore = {
  buildInTools: [
    {
      id: 'builtin-tool-1',
      name: 'Built-in Tool',
      icon: 'builtin-icon.png',
    },
  ],
  customTools: [
    {
      id: 'custom-tool-1',
      name: 'Custom Tool',
      icon: { content: 'custom-icon', background: '#fff' },
    },
  ],
  workflowTools: [
    {
      id: 'workflow-tool-1',
      name: 'Workflow Tool',
      icon: 'workflow-icon.png',
    },
  ],
  mcpTools: [
    {
      id: 'mcp-tool-1',
      name: 'MCP Tool',
      icon: 'mcp-icon.png',
    },
  ],
}

jest.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: any) => selector(mockStore),
}))

// Mock utils
jest.mock('@/utils', () => ({
  canFindTool: (toolId: string, providerId: string) => toolId === providerId,
}))

// Mock useGetIcon
jest.mock('@/app/components/plugins/install-plugin/base/use-get-icon', () => ({
  __esModule: true,
  default: () => ({
    getIconUrl: (icon: string) => `https://example.com/icons/${icon}`,
  }),
}))

// Mock workflow entry utils
jest.mock('@/app/components/workflow/utils/workflow-entry', () => ({
  getWorkflowEntryNode: (nodes: Node[]) => {
    return nodes.find(node => node.data.type === BlockEnum.Start) || null
  },
}))

// Mock icon components
jest.mock('@/app/components/base/icons/src/vender/workflow/Home', () => {
  return function MockHome({ className }: { className: string }) {
    return <div data-testid="home-icon" className={className}>Home</div>
  }
})

jest.mock('@/app/components/base/icons/src/vender/workflow', () => ({
  Schedule: function MockSchedule({ className }: { className: string }) {
    return <div data-testid="schedule-icon" className={className}>Schedule</div>
  },
  WebhookLine: function MockWebhookLine({ className }: { className: string }) {
    return <div data-testid="webhook-icon" className={className}>Webhook</div>
  },
}))

jest.mock('@/app/components/base/app-icon', () => {
  return function MockAppIcon({ icon, background, className }: any) {
    return (
      <div
        data-testid="app-icon"
        className={className}
        data-icon={icon}
        data-background={background}
      >
        AppIcon
      </div>
    )
  }
})

describe('useDynamicTestRunOptions', () => {
  beforeEach(() => {
    // Clear mock nodes before each test
    mockNodes.length = 0
  })

  describe('Empty workflow', () => {
    it('should return empty options when no nodes exist', () => {
      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.userInput).toBeUndefined()
      expect(result.current.triggers).toEqual([])
      expect(result.current.runAll).toBeUndefined()
    })
  })

  describe('Start node handling', () => {
    it('should create user input option from Start node', () => {
      mockNodes.push({
        id: 'start-1',
        type: 'start',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.Start,
          title: 'Custom Start',
        },
      })

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.userInput).toEqual({
        id: 'start-1',
        type: 'user_input',
        name: 'Custom Start',
        icon: expect.any(Object),
        nodeId: 'start-1',
        enabled: true,
      })
    })

    it('should use fallback translation when Start node has no title', () => {
      mockNodes.push({
        id: 'start-1',
        type: 'start',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.Start,
        },
      })

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.userInput?.name).toBe('User Input')
    })
  })

  describe('Trigger nodes handling', () => {
    it('should create schedule trigger option', () => {
      mockNodes.push({
        id: 'schedule-1',
        type: 'trigger-schedule',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.TriggerSchedule,
          title: 'Daily Schedule',
        },
      })

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.triggers).toHaveLength(1)
      expect(result.current.triggers[0]).toEqual({
        id: 'schedule-1',
        type: 'schedule',
        name: 'Daily Schedule',
        icon: expect.any(Object),
        nodeId: 'schedule-1',
        enabled: true,
      })
    })

    it('should create webhook trigger option', () => {
      mockNodes.push({
        id: 'webhook-1',
        type: 'trigger-webhook',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.TriggerWebhook,
          title: 'API Webhook',
        },
      })

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.triggers).toHaveLength(1)
      expect(result.current.triggers[0]).toEqual({
        id: 'webhook-1',
        type: 'webhook',
        name: 'API Webhook',
        icon: expect.any(Object),
        nodeId: 'webhook-1',
        enabled: true,
      })
    })

    it('should create plugin trigger option with built-in tool', () => {
      mockNodes.push({
        id: 'plugin-1',
        type: 'trigger-plugin',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.TriggerPlugin,
          title: 'Plugin Trigger',
          provider_id: 'builtin-tool-1',
          provider_type: CollectionType.builtIn,
        },
      })

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.triggers).toHaveLength(1)
      expect(result.current.triggers[0]).toEqual({
        id: 'plugin-1',
        type: 'plugin',
        name: 'Plugin Trigger',
        icon: expect.any(Object),
        nodeId: 'plugin-1',
        enabled: true,
      })
    })

    it('should create plugin trigger option with custom tool', () => {
      mockNodes.push({
        id: 'plugin-2',
        type: 'trigger-plugin',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.TriggerPlugin,
          title: 'Custom Plugin',
          provider_id: 'custom-tool-1',
          provider_type: CollectionType.custom,
        },
      })

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.triggers).toHaveLength(1)
      expect(result.current.triggers[0].icon).toBeDefined()
    })

    it('should create plugin trigger option with fallback icon when tool not found', () => {
      mockNodes.push({
        id: 'plugin-3',
        type: 'trigger-plugin',
        position: { x: 0, y: 0 },
        data: {
          type: BlockEnum.TriggerPlugin,
          title: 'Unknown Plugin',
          provider_id: 'unknown-tool',
          provider_type: CollectionType.builtIn,
        },
      })

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.triggers).toHaveLength(1)
      expect(result.current.triggers[0].name).toBe('Unknown Plugin')
    })
  })

  describe('Run all triggers option', () => {
    it('should create runAll option when multiple triggers exist', () => {
      mockNodes.push(
        {
          id: 'schedule-1',
          type: 'trigger-schedule',
          position: { x: 0, y: 0 },
          data: { type: BlockEnum.TriggerSchedule, title: 'Schedule 1' },
        },
        {
          id: 'webhook-1',
          type: 'trigger-webhook',
          position: { x: 100, y: 0 },
          data: { type: BlockEnum.TriggerWebhook, title: 'Webhook 1' },
        },
      )

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.runAll).toEqual({
        id: 'run-all',
        type: 'all',
        name: 'Run all triggers',
        icon: expect.any(Object),
        enabled: true,
      })
    })

    it('should not create runAll option when only one trigger exists', () => {
      mockNodes.push({
        id: 'schedule-1',
        type: 'trigger-schedule',
        position: { x: 0, y: 0 },
        data: { type: BlockEnum.TriggerSchedule, title: 'Schedule 1' },
      })

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.runAll).toBeUndefined()
    })

    it('should not create runAll option when no triggers exist', () => {
      mockNodes.push({
        id: 'start-1',
        type: 'start',
        position: { x: 0, y: 0 },
        data: { type: BlockEnum.Start, title: 'Start' },
      })

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.runAll).toBeUndefined()
    })
  })

  describe('Complex workflow scenarios', () => {
    it('should handle workflow with all node types', () => {
      mockNodes.push(
        {
          id: 'start-1',
          type: 'start',
          position: { x: 0, y: 0 },
          data: { type: BlockEnum.Start, title: 'User Input' },
        },
        {
          id: 'schedule-1',
          type: 'trigger-schedule',
          position: { x: 100, y: 0 },
          data: { type: BlockEnum.TriggerSchedule, title: 'Schedule Trigger' },
        },
        {
          id: 'webhook-1',
          type: 'trigger-webhook',
          position: { x: 200, y: 0 },
          data: { type: BlockEnum.TriggerWebhook, title: 'Webhook Trigger' },
        },
        {
          id: 'plugin-1',
          type: 'trigger-plugin',
          position: { x: 300, y: 0 },
          data: {
            type: BlockEnum.TriggerPlugin,
            title: 'Plugin Trigger',
            provider_id: 'builtin-tool-1',
            provider_type: CollectionType.builtIn,
          },
        },
      )

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.userInput).toBeDefined()
      expect(result.current.triggers).toHaveLength(3)
      expect(result.current.runAll).toBeDefined()

      // Verify node ID mapping for future click functionality
      expect(result.current.userInput?.nodeId).toBe('start-1')
      expect(result.current.triggers[0].nodeId).toBe('schedule-1')
      expect(result.current.triggers[1].nodeId).toBe('webhook-1')
      expect(result.current.triggers[2].nodeId).toBe('plugin-1')
    })

    it('should handle nodes with missing data gracefully', () => {
      mockNodes.push(
        {
          id: 'invalid-1',
          type: 'unknown',
          position: { x: 0, y: 0 },
          data: {}, // Missing type
        },
        {
          id: 'start-1',
          type: 'start',
          position: { x: 100, y: 0 },
          data: { type: BlockEnum.Start },
        },
      )

      const { result } = renderHook(() => useDynamicTestRunOptions())

      // Should only process valid nodes
      expect(result.current.userInput).toBeDefined()
      expect(result.current.triggers).toHaveLength(0)
    })

    it('should use workflow entry node as fallback when no direct Start node exists', () => {
      // No Start node, but workflow entry utility finds a fallback
      mockNodes.push({
        id: 'fallback-1',
        type: 'other',
        position: { x: 0, y: 0 },
        data: { type: BlockEnum.Start, title: 'Fallback Start' },
      })

      const { result } = renderHook(() => useDynamicTestRunOptions())

      expect(result.current.userInput).toBeDefined()
      expect(result.current.userInput?.nodeId).toBe('fallback-1')
    })
  })

  describe('Node ID mapping for click functionality', () => {
    it('should ensure all options have nodeId for proper click handling', () => {
      mockNodes.push(
        {
          id: 'start-node-123',
          type: 'start',
          position: { x: 0, y: 0 },
          data: { type: BlockEnum.Start, title: 'Start' },
        },
        {
          id: 'trigger-node-456',
          type: 'trigger-schedule',
          position: { x: 100, y: 0 },
          data: { type: BlockEnum.TriggerSchedule, title: 'Schedule' },
        },
      )

      const { result } = renderHook(() => useDynamicTestRunOptions())

      // Verify node ID mapping exists for click functionality
      expect(result.current.userInput?.nodeId).toBe('start-node-123')
      expect(result.current.triggers[0].nodeId).toBe('trigger-node-456')

      // runAll doesn't need nodeId as it handles multiple nodes
      expect(result.current.runAll?.nodeId).toBeUndefined()
    })
  })

  describe('Icon rendering verification', () => {
    it('should render proper icon components for each node type', () => {
      mockNodes.push(
        {
          id: 'start-1',
          type: 'start',
          position: { x: 0, y: 0 },
          data: { type: BlockEnum.Start },
        },
        {
          id: 'schedule-1',
          type: 'trigger-schedule',
          position: { x: 100, y: 0 },
          data: { type: BlockEnum.TriggerSchedule },
        },
      )

      const { result } = renderHook(() => useDynamicTestRunOptions())

      // Icons should be React elements
      expect(React.isValidElement(result.current.userInput?.icon)).toBe(true)
      expect(React.isValidElement(result.current.triggers[0]?.icon)).toBe(true)
    })
  })
})
