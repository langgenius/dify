import { act, renderHook } from '@testing-library/react'
import { useWorkflowGeneratorStore } from '../store'

// Reset zustand state between tests so they don't share opener context.
const resetStore = () => {
  useWorkflowGeneratorStore.setState({
    isOpen: false,
    mode: 'workflow',
    currentAppId: null,
    currentAppMode: null,
  })
}

describe('useWorkflowGeneratorStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  describe('initial state', () => {
    // Default snapshot: the generator modal is closed, mode is "workflow", and
    // there is no current-app context attached.
    it('should start closed in workflow mode with no current app', () => {
      const { result } = renderHook(() => useWorkflowGeneratorStore())

      expect(result.current.isOpen).toBe(false)
      expect(result.current.mode).toBe('workflow')
      expect(result.current.currentAppId).toBeNull()
      expect(result.current.currentAppMode).toBeNull()
    })
  })

  describe('openGenerator', () => {
    // Opening from a non-Studio surface (e.g. /apps page): only the requested
    // mode is set; currentAppId stays null so the modal hides "Apply to current".
    it('should open with the requested mode and no current app by default', () => {
      const { result } = renderHook(() => useWorkflowGeneratorStore())

      act(() => {
        result.current.openGenerator({ mode: 'advanced-chat' })
      })

      expect(result.current.isOpen).toBe(true)
      expect(result.current.mode).toBe('advanced-chat')
      expect(result.current.currentAppId).toBeNull()
      expect(result.current.currentAppMode).toBeNull()
    })

    // Opening from inside Studio: caller passes currentAppId + currentAppMode
    // so the modal can show "Apply to current draft".
    it('should accept a current app id and mode when opened from Studio', () => {
      const { result } = renderHook(() => useWorkflowGeneratorStore())

      act(() => {
        result.current.openGenerator({
          mode: 'workflow',
          currentAppId: 'app-123',
          currentAppMode: 'workflow',
        })
      })

      expect(result.current.isOpen).toBe(true)
      expect(result.current.mode).toBe('workflow')
      expect(result.current.currentAppId).toBe('app-123')
      expect(result.current.currentAppMode).toBe('workflow')
    })

    // Reopening with new parameters must overwrite the previous mode/context;
    // stale state would let the modal apply to the wrong app.
    it('should overwrite previous state on a subsequent open', () => {
      const { result } = renderHook(() => useWorkflowGeneratorStore())

      act(() => {
        result.current.openGenerator({ mode: 'workflow', currentAppId: 'app-1', currentAppMode: 'workflow' })
      })
      act(() => {
        result.current.openGenerator({ mode: 'advanced-chat' })
      })

      expect(result.current.mode).toBe('advanced-chat')
      expect(result.current.currentAppId).toBeNull()
      expect(result.current.currentAppMode).toBeNull()
    })
  })

  describe('closeGenerator', () => {
    // Closing flips isOpen back to false but preserves mode / currentAppId so
    // a subsequent reopen can decide whether to keep or replace them.
    it('should close the modal without clearing the captured context', () => {
      const { result } = renderHook(() => useWorkflowGeneratorStore())

      act(() => {
        result.current.openGenerator({ mode: 'workflow', currentAppId: 'app-9', currentAppMode: 'workflow' })
      })
      act(() => {
        result.current.closeGenerator()
      })

      expect(result.current.isOpen).toBe(false)
      expect(result.current.mode).toBe('workflow')
      expect(result.current.currentAppId).toBe('app-9')
      expect(result.current.currentAppMode).toBe('workflow')
    })
  })
})
