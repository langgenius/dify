import { act, renderHook } from '@testing-library/react'
import { useMoreLikeThisState, useWorkflowTabs } from './hooks'
import type { WorkflowProcess } from '@/app/components/base/chat/types'

// ============================================================================
// useMoreLikeThisState Tests
// ============================================================================
describe('useMoreLikeThisState', () => {
  // --------------------------------------------------------------------------
  // Initial State Tests
  // Tests verifying the hook's initial state values
  // --------------------------------------------------------------------------
  describe('Initial State', () => {
    it('should initialize with empty completionRes', () => {
      const { result } = renderHook(() => useMoreLikeThisState({}))
      expect(result.current.completionRes).toBe('')
    })

    it('should initialize with null childMessageId', () => {
      const { result } = renderHook(() => useMoreLikeThisState({}))
      expect(result.current.childMessageId).toBeNull()
    })

    it('should initialize with null rating in childFeedback', () => {
      const { result } = renderHook(() => useMoreLikeThisState({}))
      expect(result.current.childFeedback).toEqual({ rating: null })
    })

    it('should initialize isQuerying as false', () => {
      const { result } = renderHook(() => useMoreLikeThisState({}))
      expect(result.current.isQuerying).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // State Setter Tests
  // Tests for state update functions
  // --------------------------------------------------------------------------
  describe('State Setters', () => {
    it('should update completionRes when setCompletionRes is called', () => {
      const { result } = renderHook(() => useMoreLikeThisState({}))

      act(() => {
        result.current.setCompletionRes('new response')
      })

      expect(result.current.completionRes).toBe('new response')
    })

    it('should update childMessageId when setChildMessageId is called', () => {
      const { result } = renderHook(() => useMoreLikeThisState({}))

      act(() => {
        result.current.setChildMessageId('child-123')
      })

      expect(result.current.childMessageId).toBe('child-123')
    })

    it('should update childFeedback when setChildFeedback is called', () => {
      const { result } = renderHook(() => useMoreLikeThisState({}))

      act(() => {
        result.current.setChildFeedback({ rating: 'like' })
      })

      expect(result.current.childFeedback).toEqual({ rating: 'like' })
    })

    it('should set isQuerying to true when startQuerying is called', () => {
      const { result } = renderHook(() => useMoreLikeThisState({}))

      act(() => {
        result.current.startQuerying()
      })

      expect(result.current.isQuerying).toBe(true)
    })

    it('should set isQuerying to false when stopQuerying is called', () => {
      const { result } = renderHook(() => useMoreLikeThisState({}))

      act(() => {
        result.current.startQuerying()
      })
      expect(result.current.isQuerying).toBe(true)

      act(() => {
        result.current.stopQuerying()
      })
      expect(result.current.isQuerying).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // controlClearMoreLikeThis Effect Tests
  // Tests for the clear effect triggered by controlClearMoreLikeThis
  // --------------------------------------------------------------------------
  describe('controlClearMoreLikeThis Effect', () => {
    it('should clear childMessageId when controlClearMoreLikeThis changes to truthy value', () => {
      const { result, rerender } = renderHook(
        ({ controlClearMoreLikeThis }: { controlClearMoreLikeThis?: number }) =>
          useMoreLikeThisState({ controlClearMoreLikeThis }),
        { initialProps: { controlClearMoreLikeThis: undefined as number | undefined } },
      )

      act(() => {
        result.current.setChildMessageId('child-to-clear')
        result.current.setCompletionRes('response-to-clear')
      })

      expect(result.current.childMessageId).toBe('child-to-clear')
      expect(result.current.completionRes).toBe('response-to-clear')

      rerender({ controlClearMoreLikeThis: 1 })

      expect(result.current.childMessageId).toBeNull()
      expect(result.current.completionRes).toBe('')
    })

    it('should not clear state when controlClearMoreLikeThis is 0', () => {
      const { result, rerender } = renderHook(
        ({ controlClearMoreLikeThis }: { controlClearMoreLikeThis?: number }) =>
          useMoreLikeThisState({ controlClearMoreLikeThis }),
        { initialProps: { controlClearMoreLikeThis: undefined as number | undefined } },
      )

      act(() => {
        result.current.setChildMessageId('keep-this')
        result.current.setCompletionRes('keep-response')
      })

      rerender({ controlClearMoreLikeThis: 0 })

      expect(result.current.childMessageId).toBe('keep-this')
      expect(result.current.completionRes).toBe('keep-response')
    })

    it('should clear state when controlClearMoreLikeThis increments', () => {
      const { result, rerender } = renderHook(
        ({ controlClearMoreLikeThis }) => useMoreLikeThisState({ controlClearMoreLikeThis }),
        { initialProps: { controlClearMoreLikeThis: 1 } },
      )

      act(() => {
        result.current.setChildMessageId('will-clear')
      })

      rerender({ controlClearMoreLikeThis: 2 })

      expect(result.current.childMessageId).toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  // isLoading Effect Tests
  // Tests for the effect triggered by isLoading changes
  // --------------------------------------------------------------------------
  describe('isLoading Effect', () => {
    it('should clear childMessageId when isLoading becomes true', () => {
      const { result, rerender } = renderHook(
        ({ isLoading }) => useMoreLikeThisState({ isLoading }),
        { initialProps: { isLoading: false } },
      )

      act(() => {
        result.current.setChildMessageId('child-during-load')
      })

      expect(result.current.childMessageId).toBe('child-during-load')

      rerender({ isLoading: true })

      expect(result.current.childMessageId).toBeNull()
    })

    it('should not clear childMessageId when isLoading is false', () => {
      const { result, rerender } = renderHook(
        ({ isLoading }) => useMoreLikeThisState({ isLoading }),
        { initialProps: { isLoading: true } },
      )

      act(() => {
        result.current.setChildMessageId('keep-child')
      })

      rerender({ isLoading: false })

      // childMessageId was already cleared when isLoading was true initially
      // Set it again after isLoading is false
      act(() => {
        result.current.setChildMessageId('keep-child-2')
      })

      expect(result.current.childMessageId).toBe('keep-child-2')
    })

    it('should not affect completionRes when isLoading changes', () => {
      const { result, rerender } = renderHook(
        ({ isLoading }) => useMoreLikeThisState({ isLoading }),
        { initialProps: { isLoading: false } },
      )

      act(() => {
        result.current.setCompletionRes('my response')
      })

      rerender({ isLoading: true })

      expect(result.current.completionRes).toBe('my response')
    })
  })

  // --------------------------------------------------------------------------
  // Boundary Conditions Tests
  // Tests for edge cases and boundary values
  // --------------------------------------------------------------------------
  describe('Boundary Conditions', () => {
    it('should handle undefined parameters', () => {
      const { result } = renderHook(() =>
        useMoreLikeThisState({ controlClearMoreLikeThis: undefined, isLoading: undefined }),
      )

      expect(result.current.childMessageId).toBeNull()
      expect(result.current.completionRes).toBe('')
    })

    it('should handle empty string for completionRes', () => {
      const { result } = renderHook(() => useMoreLikeThisState({}))

      act(() => {
        result.current.setCompletionRes('')
      })

      expect(result.current.completionRes).toBe('')
    })

    it('should handle multiple rapid state changes', () => {
      const { result } = renderHook(() => useMoreLikeThisState({}))

      act(() => {
        result.current.setChildMessageId('first')
        result.current.setChildMessageId('second')
        result.current.setChildMessageId('third')
      })

      expect(result.current.childMessageId).toBe('third')
    })
  })
})

// ============================================================================
// useWorkflowTabs Tests
// ============================================================================
describe('useWorkflowTabs', () => {
  // --------------------------------------------------------------------------
  // Initial State Tests
  // Tests verifying the hook's initial state based on workflowProcessData
  // --------------------------------------------------------------------------
  describe('Initial State', () => {
    it('should initialize currentTab to DETAIL when no workflowProcessData', () => {
      const { result } = renderHook(() => useWorkflowTabs(undefined))
      expect(result.current.currentTab).toBe('DETAIL')
    })

    it('should initialize showResultTabs to false when no workflowProcessData', () => {
      const { result } = renderHook(() => useWorkflowTabs(undefined))
      expect(result.current.showResultTabs).toBe(false)
    })

    it('should set currentTab to RESULT when resultText is present', () => {
      const workflowData = { resultText: 'some result' } as WorkflowProcess
      const { result } = renderHook(() => useWorkflowTabs(workflowData))
      expect(result.current.currentTab).toBe('RESULT')
    })

    it('should set currentTab to RESULT when files array has items', () => {
      const workflowData = { files: [{ id: 'file-1' }] } as WorkflowProcess
      const { result } = renderHook(() => useWorkflowTabs(workflowData))
      expect(result.current.currentTab).toBe('RESULT')
    })

    it('should set showResultTabs to true when resultText is present', () => {
      const workflowData = { resultText: 'result' } as WorkflowProcess
      const { result } = renderHook(() => useWorkflowTabs(workflowData))
      expect(result.current.showResultTabs).toBe(true)
    })

    it('should set showResultTabs to true when files array has items', () => {
      const workflowData = { files: [{ id: 'file-1' }] } as WorkflowProcess
      const { result } = renderHook(() => useWorkflowTabs(workflowData))
      expect(result.current.showResultTabs).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // Tab Switching Tests
  // Tests for manual tab switching functionality
  // --------------------------------------------------------------------------
  describe('Tab Switching', () => {
    it('should allow switching to DETAIL tab', () => {
      const workflowData = { resultText: 'result' } as WorkflowProcess
      const { result } = renderHook(() => useWorkflowTabs(workflowData))

      expect(result.current.currentTab).toBe('RESULT')

      act(() => {
        result.current.setCurrentTab('DETAIL')
      })

      expect(result.current.currentTab).toBe('DETAIL')
    })

    it('should allow switching to RESULT tab', () => {
      const { result } = renderHook(() => useWorkflowTabs(undefined))

      act(() => {
        result.current.setCurrentTab('RESULT')
      })

      expect(result.current.currentTab).toBe('RESULT')
    })
  })

  // --------------------------------------------------------------------------
  // Dynamic Data Change Tests
  // Tests for behavior when workflowProcessData changes
  // --------------------------------------------------------------------------
  describe('Dynamic Data Changes', () => {
    it('should update currentTab when resultText becomes available', () => {
      const { result, rerender } = renderHook(
        ({ data }) => useWorkflowTabs(data),
        { initialProps: { data: undefined as WorkflowProcess | undefined } },
      )

      expect(result.current.currentTab).toBe('DETAIL')

      rerender({ data: { resultText: 'new result' } as WorkflowProcess })

      expect(result.current.currentTab).toBe('RESULT')
    })

    it('should update currentTab when resultText is removed', () => {
      const { result, rerender } = renderHook(
        ({ data }) => useWorkflowTabs(data),
        { initialProps: { data: { resultText: 'result' } as WorkflowProcess } },
      )

      expect(result.current.currentTab).toBe('RESULT')

      rerender({ data: { resultText: '' } as WorkflowProcess })

      expect(result.current.currentTab).toBe('DETAIL')
    })

    it('should update showResultTabs when files array changes', () => {
      const { result, rerender } = renderHook(
        ({ data }) => useWorkflowTabs(data),
        { initialProps: { data: { files: [] } as unknown as WorkflowProcess } },
      )

      expect(result.current.showResultTabs).toBe(false)

      rerender({ data: { files: [{ id: 'file-1' }] } as WorkflowProcess })

      expect(result.current.showResultTabs).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // Boundary Conditions Tests
  // Tests for edge cases
  // --------------------------------------------------------------------------
  describe('Boundary Conditions', () => {
    it('should handle empty resultText', () => {
      const workflowData = { resultText: '' } as WorkflowProcess
      const { result } = renderHook(() => useWorkflowTabs(workflowData))
      expect(result.current.showResultTabs).toBe(false)
      expect(result.current.currentTab).toBe('DETAIL')
    })

    it('should handle empty files array', () => {
      const workflowData = { files: [] } as unknown as WorkflowProcess
      const { result } = renderHook(() => useWorkflowTabs(workflowData))
      expect(result.current.showResultTabs).toBe(false)
    })

    it('should handle undefined files', () => {
      const workflowData = { files: undefined } as WorkflowProcess
      const { result } = renderHook(() => useWorkflowTabs(workflowData))
      expect(result.current.showResultTabs).toBe(false)
    })

    it('should handle both resultText and files present', () => {
      const workflowData = {
        resultText: 'result',
        files: [{ id: 'file-1' }],
      } as WorkflowProcess
      const { result } = renderHook(() => useWorkflowTabs(workflowData))
      expect(result.current.showResultTabs).toBe(true)
      expect(result.current.currentTab).toBe('RESULT')
    })

    it('should handle whitespace-only resultText as truthy', () => {
      const workflowData = { resultText: '   ' } as WorkflowProcess
      const { result } = renderHook(() => useWorkflowTabs(workflowData))
      // whitespace string is truthy
      expect(result.current.showResultTabs).toBe(true)
    })
  })
})
