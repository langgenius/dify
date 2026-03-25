import type { EntryNodeStatus } from '../trigger-status'
import { act, renderHook } from '@testing-library/react'
import { useTriggerStatusStore } from '../trigger-status'

describe('useTriggerStatusStore', () => {
  beforeEach(() => {
    // Clear the store state before each test
    const { result } = renderHook(() => useTriggerStatusStore())
    act(() => {
      result.current.clearTriggerStatuses()
    })
  })

  describe('Initial State', () => {
    it('should initialize with empty trigger statuses', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      expect(result.current.triggerStatuses).toEqual({})
    })

    it('should return "disabled" for non-existent trigger status', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      const status = result.current.getTriggerStatus('non-existent-id')
      expect(status).toBe('disabled')
    })
  })

  describe('setTriggerStatus', () => {
    it('should set trigger status for a single node', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      act(() => {
        result.current.setTriggerStatus('node-1', 'enabled')
      })

      expect(result.current.triggerStatuses['node-1']).toBe('enabled')
      expect(result.current.getTriggerStatus('node-1')).toBe('enabled')
    })

    it('should update existing trigger status', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      // Set initial status
      act(() => {
        result.current.setTriggerStatus('node-1', 'enabled')
      })
      expect(result.current.getTriggerStatus('node-1')).toBe('enabled')

      // Update status
      act(() => {
        result.current.setTriggerStatus('node-1', 'disabled')
      })
      expect(result.current.getTriggerStatus('node-1')).toBe('disabled')
    })

    it('should handle multiple nodes independently', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      act(() => {
        result.current.setTriggerStatus('node-1', 'enabled')
        result.current.setTriggerStatus('node-2', 'disabled')
      })

      expect(result.current.getTriggerStatus('node-1')).toBe('enabled')
      expect(result.current.getTriggerStatus('node-2')).toBe('disabled')
    })
  })

  describe('setTriggerStatuses', () => {
    it('should set multiple trigger statuses at once', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      const statuses = {
        'node-1': 'enabled' as EntryNodeStatus,
        'node-2': 'disabled' as EntryNodeStatus,
        'node-3': 'enabled' as EntryNodeStatus,
      }

      act(() => {
        result.current.setTriggerStatuses(statuses)
      })

      expect(result.current.triggerStatuses).toEqual(statuses)
      expect(result.current.getTriggerStatus('node-1')).toBe('enabled')
      expect(result.current.getTriggerStatus('node-2')).toBe('disabled')
      expect(result.current.getTriggerStatus('node-3')).toBe('enabled')
    })

    it('should replace existing statuses completely', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      // Set initial statuses
      act(() => {
        result.current.setTriggerStatuses({
          'node-1': 'enabled',
          'node-2': 'disabled',
        })
      })

      // Replace with new statuses
      act(() => {
        result.current.setTriggerStatuses({
          'node-3': 'enabled',
          'node-4': 'disabled',
        })
      })

      expect(result.current.triggerStatuses).toEqual({
        'node-3': 'enabled',
        'node-4': 'disabled',
      })
      expect(result.current.getTriggerStatus('node-1')).toBe('disabled') // default
      expect(result.current.getTriggerStatus('node-2')).toBe('disabled') // default
    })

    it('should handle empty object', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      // Set some initial data
      act(() => {
        result.current.setTriggerStatus('node-1', 'enabled')
      })

      // Clear with empty object
      act(() => {
        result.current.setTriggerStatuses({})
      })

      expect(result.current.triggerStatuses).toEqual({})
      expect(result.current.getTriggerStatus('node-1')).toBe('disabled')
    })
  })

  describe('getTriggerStatus', () => {
    it('should return the correct status for existing nodes', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      act(() => {
        result.current.setTriggerStatuses({
          'enabled-node': 'enabled',
          'disabled-node': 'disabled',
        })
      })

      expect(result.current.getTriggerStatus('enabled-node')).toBe('enabled')
      expect(result.current.getTriggerStatus('disabled-node')).toBe('disabled')
    })

    it('should return "disabled" as default for non-existent nodes', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      expect(result.current.getTriggerStatus('non-existent')).toBe('disabled')
      expect(result.current.getTriggerStatus('')).toBe('disabled')
      expect(result.current.getTriggerStatus('undefined-node')).toBe('disabled')
    })
  })

  describe('clearTriggerStatuses', () => {
    it('should clear all trigger statuses', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      // Set some statuses
      act(() => {
        result.current.setTriggerStatuses({
          'node-1': 'enabled',
          'node-2': 'disabled',
          'node-3': 'enabled',
        })
      })

      expect(Object.keys(result.current.triggerStatuses)).toHaveLength(3)

      // Clear all
      act(() => {
        result.current.clearTriggerStatuses()
      })

      expect(result.current.triggerStatuses).toEqual({})
      expect(result.current.getTriggerStatus('node-1')).toBe('disabled')
      expect(result.current.getTriggerStatus('node-2')).toBe('disabled')
      expect(result.current.getTriggerStatus('node-3')).toBe('disabled')
    })

    it('should not throw when clearing empty statuses', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      expect(() => {
        act(() => {
          result.current.clearTriggerStatuses()
        })
      }).not.toThrow()

      expect(result.current.triggerStatuses).toEqual({})
    })
  })

  describe('Store Reactivity', () => {
    it('should notify subscribers when status changes', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      const initialTriggerStatuses = result.current.triggerStatuses

      act(() => {
        result.current.setTriggerStatus('reactive-node', 'enabled')
      })

      // The reference should change, indicating reactivity
      expect(result.current.triggerStatuses).not.toBe(initialTriggerStatuses)
      expect(result.current.triggerStatuses['reactive-node']).toBe('enabled')
    })

    it('should maintain immutability when updating statuses', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      act(() => {
        result.current.setTriggerStatus('node-1', 'enabled')
      })

      const firstSnapshot = result.current.triggerStatuses

      act(() => {
        result.current.setTriggerStatus('node-2', 'disabled')
      })

      const secondSnapshot = result.current.triggerStatuses

      // References should be different (immutable updates)
      expect(firstSnapshot).not.toBe(secondSnapshot)
      // But the first node status should remain
      expect(secondSnapshot['node-1']).toBe('enabled')
      expect(secondSnapshot['node-2']).toBe('disabled')
    })
  })

  describe('Edge Cases', () => {
    it('should handle rapid consecutive updates', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      act(() => {
        result.current.setTriggerStatus('rapid-node', 'enabled')
        result.current.setTriggerStatus('rapid-node', 'disabled')
        result.current.setTriggerStatus('rapid-node', 'enabled')
      })

      expect(result.current.getTriggerStatus('rapid-node')).toBe('enabled')
    })

    it('should handle setting the same status multiple times', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      act(() => {
        result.current.setTriggerStatus('same-node', 'enabled')
      })

      const firstSnapshot = result.current.triggerStatuses

      act(() => {
        result.current.setTriggerStatus('same-node', 'enabled')
      })

      const secondSnapshot = result.current.triggerStatuses

      expect(result.current.getTriggerStatus('same-node')).toBe('enabled')
      // Should still create new reference (Zustand behavior)
      expect(firstSnapshot).not.toBe(secondSnapshot)
    })

    it('should handle special node ID formats', () => {
      const { result } = renderHook(() => useTriggerStatusStore())

      const specialNodeIds = [
        'node-with-dashes',
        'node_with_underscores',
        'nodeWithCamelCase',
        'node123',
        'node-123-abc',
      ]

      act(() => {
        specialNodeIds.forEach((nodeId, index) => {
          const status = index % 2 === 0 ? 'enabled' : 'disabled'
          result.current.setTriggerStatus(nodeId, status as EntryNodeStatus)
        })
      })

      specialNodeIds.forEach((nodeId, index) => {
        const expectedStatus = index % 2 === 0 ? 'enabled' : 'disabled'
        expect(result.current.getTriggerStatus(nodeId)).toBe(expectedStatus)
      })
    })
  })
})
