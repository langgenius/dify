import type { MockedFunction } from 'vitest'
import type { EntryNodeStatus } from '../store/trigger-status'
import type { BlockEnum } from '../types'
import { act, render } from '@testing-library/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTriggerStatusStore } from '../store/trigger-status'
import { isTriggerNode } from '../types'

// Mock the isTriggerNode function while preserving BlockEnum
vi.mock('../types', async importOriginal => ({
  ...await importOriginal<typeof import('../types')>(),
  isTriggerNode: vi.fn(),
}))

const mockIsTriggerNode = isTriggerNode as MockedFunction<typeof isTriggerNode>

// Test component that mimics BaseNode's usage pattern
const TestTriggerNode: React.FC<{
  nodeId: string
  nodeType: string
}> = ({ nodeId, nodeType }) => {
  const triggerStatus = useTriggerStatusStore(state =>
    mockIsTriggerNode(nodeType as BlockEnum) ? (state.triggerStatuses[nodeId] || 'disabled') : 'enabled',
  )

  return (
    <div data-testid={`node-${nodeId}`} data-status={triggerStatus}>
      Status:
      {' '}
      {triggerStatus}
    </div>
  )
}

// Test component that mimics TriggerCard's usage pattern
const TestTriggerController: React.FC = () => {
  const { setTriggerStatus, setTriggerStatuses } = useTriggerStatusStore()

  const handleToggle = (nodeId: string, enabled: boolean) => {
    const newStatus = enabled ? 'enabled' : 'disabled'
    setTriggerStatus(nodeId, newStatus)
  }

  const handleBatchUpdate = (statuses: Record<string, EntryNodeStatus>) => {
    setTriggerStatuses(statuses)
  }

  return (
    <div>
      <button
        data-testid="toggle-node-1"
        onClick={() => handleToggle('node-1', true)}
      >
        Enable Node 1
      </button>
      <button
        data-testid="toggle-node-2"
        onClick={() => handleToggle('node-2', false)}
      >
        Disable Node 2
      </button>
      <button
        data-testid="batch-update"
        onClick={() => handleBatchUpdate({
          'node-1': 'disabled',
          'node-2': 'enabled',
          'node-3': 'enabled',
        })}
      >
        Batch Update
      </button>
    </div>
  )
}

describe('Trigger Status Synchronization Integration', () => {
  beforeEach(() => {
    // Clear store state
    act(() => {
      const store = useTriggerStatusStore.getState()
      store.clearTriggerStatuses()
    })

    // Reset mocks
    vi.clearAllMocks()
  })

  describe('Real-time Status Synchronization', () => {
    it('should sync status changes between trigger controller and nodes', () => {
      mockIsTriggerNode.mockReturnValue(true)

      const { getByTestId } = render(
        <>
          <TestTriggerController />
          <TestTriggerNode nodeId="node-1" nodeType="trigger-webhook" />
          <TestTriggerNode nodeId="node-2" nodeType="trigger-schedule" />
        </>,
      )

      // Initial state - should be 'disabled' by default
      expect(getByTestId('node-node-1')).toHaveAttribute('data-status', 'disabled')
      expect(getByTestId('node-node-2')).toHaveAttribute('data-status', 'disabled')

      // Enable node-1
      act(() => {
        getByTestId('toggle-node-1').click()
      })

      expect(getByTestId('node-node-1')).toHaveAttribute('data-status', 'enabled')
      expect(getByTestId('node-node-2')).toHaveAttribute('data-status', 'disabled')

      // Disable node-2 (should remain disabled)
      act(() => {
        getByTestId('toggle-node-2').click()
      })

      expect(getByTestId('node-node-1')).toHaveAttribute('data-status', 'enabled')
      expect(getByTestId('node-node-2')).toHaveAttribute('data-status', 'disabled')
    })

    it('should handle batch status updates correctly', () => {
      mockIsTriggerNode.mockReturnValue(true)

      const { getByTestId } = render(
        <>
          <TestTriggerController />
          <TestTriggerNode nodeId="node-1" nodeType="trigger-webhook" />
          <TestTriggerNode nodeId="node-2" nodeType="trigger-schedule" />
          <TestTriggerNode nodeId="node-3" nodeType="trigger-plugin" />
        </>,
      )

      // Initial state
      expect(getByTestId('node-node-1')).toHaveAttribute('data-status', 'disabled')
      expect(getByTestId('node-node-2')).toHaveAttribute('data-status', 'disabled')
      expect(getByTestId('node-node-3')).toHaveAttribute('data-status', 'disabled')

      // Batch update
      act(() => {
        getByTestId('batch-update').click()
      })

      expect(getByTestId('node-node-1')).toHaveAttribute('data-status', 'disabled')
      expect(getByTestId('node-node-2')).toHaveAttribute('data-status', 'enabled')
      expect(getByTestId('node-node-3')).toHaveAttribute('data-status', 'enabled')
    })

    it('should handle mixed node types (trigger vs non-trigger)', () => {
      // Mock different node types
      mockIsTriggerNode.mockImplementation((nodeType: string) => {
        return nodeType.startsWith('trigger-')
      })

      const { getByTestId } = render(
        <>
          <TestTriggerController />
          <TestTriggerNode nodeId="node-1" nodeType="trigger-webhook" />
          <TestTriggerNode nodeId="node-2" nodeType="start" />
          <TestTriggerNode nodeId="node-3" nodeType="llm" />
        </>,
      )

      // Trigger node should use store status, non-trigger nodes should be 'enabled'
      expect(getByTestId('node-node-1')).toHaveAttribute('data-status', 'disabled') // trigger node
      expect(getByTestId('node-node-2')).toHaveAttribute('data-status', 'enabled') // start node
      expect(getByTestId('node-node-3')).toHaveAttribute('data-status', 'enabled') // llm node

      // Update trigger node status
      act(() => {
        getByTestId('toggle-node-1').click()
      })

      expect(getByTestId('node-node-1')).toHaveAttribute('data-status', 'enabled') // updated
      expect(getByTestId('node-node-2')).toHaveAttribute('data-status', 'enabled') // unchanged
      expect(getByTestId('node-node-3')).toHaveAttribute('data-status', 'enabled') // unchanged
    })
  })

  describe('Store State Management', () => {
    it('should maintain state consistency across multiple components', () => {
      mockIsTriggerNode.mockReturnValue(true)

      // Render multiple instances of the same node
      const { getByTestId, rerender } = render(
        <>
          <TestTriggerController />
          <TestTriggerNode nodeId="shared-node" nodeType="trigger-webhook" />
        </>,
      )

      // Update status
      act(() => {
        getByTestId('toggle-node-1').click() // This updates node-1, not shared-node
      })

      // Add another component with the same nodeId
      rerender(
        <>
          <TestTriggerController />
          <TestTriggerNode nodeId="shared-node" nodeType="trigger-webhook" />
          <TestTriggerNode nodeId="shared-node" nodeType="trigger-webhook" />
        </>,
      )

      // Both components should show the same status
      const nodes = document.querySelectorAll('[data-testid="node-shared-node"]')
      expect(nodes).toHaveLength(2)
      nodes.forEach((node) => {
        expect(node).toHaveAttribute('data-status', 'disabled')
      })
    })

    it('should handle rapid status changes correctly', () => {
      mockIsTriggerNode.mockReturnValue(true)

      const { getByTestId } = render(
        <>
          <TestTriggerController />
          <TestTriggerNode nodeId="node-1" nodeType="trigger-webhook" />
        </>,
      )

      // Rapid consecutive updates
      act(() => {
        // Multiple rapid clicks
        getByTestId('toggle-node-1').click() // enable
        getByTestId('toggle-node-2').click() // disable (different node)
        getByTestId('toggle-node-1').click() // enable again
      })

      // Should reflect the final state
      expect(getByTestId('node-node-1')).toHaveAttribute('data-status', 'enabled')
    })
  })

  describe('Error Scenarios', () => {
    it('should handle non-existent node IDs gracefully', () => {
      mockIsTriggerNode.mockReturnValue(true)

      const { getByTestId } = render(
        <TestTriggerNode nodeId="non-existent-node" nodeType="trigger-webhook" />,
      )

      // Should default to 'disabled' for non-existent nodes
      expect(getByTestId('node-non-existent-node')).toHaveAttribute('data-status', 'disabled')
    })

    it('should handle component unmounting gracefully', () => {
      mockIsTriggerNode.mockReturnValue(true)

      const { getByTestId, unmount } = render(
        <>
          <TestTriggerController />
          <TestTriggerNode nodeId="node-1" nodeType="trigger-webhook" />
        </>,
      )

      // Update status
      act(() => {
        getByTestId('toggle-node-1').click()
      })

      // Unmount components
      expect(() => unmount()).not.toThrow()

      // Store should still maintain the state
      const store = useTriggerStatusStore.getState()
      expect(store.triggerStatuses['node-1']).toBe('enabled')
    })
  })

  describe('Performance Optimization', () => {
    // Component that uses optimized selector with useCallback
    const OptimizedTriggerNode: React.FC<{
      nodeId: string
      nodeType: string
    }> = ({ nodeId, nodeType }) => {
      const triggerStatusSelector = useCallback((state: any) =>
        mockIsTriggerNode(nodeType as BlockEnum) ? (state.triggerStatuses[nodeId] || 'disabled') : 'enabled', [nodeId, nodeType])
      const triggerStatus = useTriggerStatusStore(triggerStatusSelector)

      return (
        <div data-testid={`optimized-node-${nodeId}`} data-status={triggerStatus}>
          Status:
          {' '}
          {triggerStatus}
        </div>
      )
    }

    it('should work correctly with optimized selector using useCallback', () => {
      mockIsTriggerNode.mockImplementation(nodeType => nodeType === 'trigger-webhook')

      const { getByTestId } = render(
        <>
          <OptimizedTriggerNode nodeId="node-1" nodeType="trigger-webhook" />
          <OptimizedTriggerNode nodeId="node-2" nodeType="start" />
          <TestTriggerController />
        </>,
      )

      // Initial state
      expect(getByTestId('optimized-node-node-1')).toHaveAttribute('data-status', 'disabled')
      expect(getByTestId('optimized-node-node-2')).toHaveAttribute('data-status', 'enabled')

      // Update status via controller
      act(() => {
        getByTestId('toggle-node-1').click()
      })

      // Verify optimized component updates correctly
      expect(getByTestId('optimized-node-node-1')).toHaveAttribute('data-status', 'enabled')
      expect(getByTestId('optimized-node-node-2')).toHaveAttribute('data-status', 'enabled')
    })

    it('should handle selector dependency changes correctly', () => {
      mockIsTriggerNode.mockImplementation(nodeType => nodeType === 'trigger-webhook')

      const TestComponent: React.FC<{ nodeType: string }> = ({ nodeType }) => {
        const triggerStatusSelector = useCallback(
          (state: any) =>
            mockIsTriggerNode(nodeType as BlockEnum) ? (state.triggerStatuses['test-node'] || 'disabled') : 'enabled',
          ['test-node', nodeType], // Dependencies should match implementation
        )
        const status = useTriggerStatusStore(triggerStatusSelector)
        return <div data-testid="test-component" data-status={status} />
      }

      const { getByTestId, rerender } = render(<TestComponent nodeType="trigger-webhook" />)

      // Initial trigger node
      expect(getByTestId('test-component')).toHaveAttribute('data-status', 'disabled')

      // Set status for the node
      act(() => {
        useTriggerStatusStore.getState().setTriggerStatus('test-node', 'enabled')
      })
      expect(getByTestId('test-component')).toHaveAttribute('data-status', 'enabled')

      // Change node type to non-trigger - should return 'enabled' regardless of store
      rerender(<TestComponent nodeType="start" />)
      expect(getByTestId('test-component')).toHaveAttribute('data-status', 'enabled')
    })
  })
})
