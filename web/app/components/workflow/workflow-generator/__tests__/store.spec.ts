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

  describe('history reset on /create open', () => {
    // /create must always start on the empty placeholder — the previous
    // session's versions belong to a different intent and confuse the user.
    // Without this, opening /create twice in a row would re-show the prior
    // generated graph. Studio-refine sessions (with currentAppId) keep
    // their history so close+reopen of the toolbar Generate doesn't lose
    // the versions the user was comparing.
    it('should clear new-app sessionStorage keys when opened without a currentAppId', () => {
      sessionStorage.setItem('workflow-gen-workflow-new-versions', JSON.stringify([{ ghost: true }]))
      sessionStorage.setItem('workflow-gen-workflow-new-version-index', '3')

      const { result } = renderHook(() => useWorkflowGeneratorStore())
      act(() => {
        result.current.openGenerator({ mode: 'workflow' })
      })

      expect(sessionStorage.getItem('workflow-gen-workflow-new-versions')).toBeNull()
      expect(sessionStorage.getItem('workflow-gen-workflow-new-version-index')).toBeNull()
    })

    // Only the mode being opened gets cleared — opening /create for
    // workflow must not wipe a parallel advanced-chat /create session in
    // another tab's sessionStorage path (we share the same sessionStorage
    // namespace per tab, but only the corresponding mode key is wiped).
    it('should leave the other mode\'s new-app history alone', () => {
      sessionStorage.setItem('workflow-gen-advanced-chat-new-versions', JSON.stringify([{ keep: true }]))

      const { result } = renderHook(() => useWorkflowGeneratorStore())
      act(() => {
        result.current.openGenerator({ mode: 'workflow' })
      })

      expect(sessionStorage.getItem('workflow-gen-advanced-chat-new-versions')).not.toBeNull()
    })

    // Studio refine sessions (currentAppId present) must NOT clear their
    // history — the user expects to find their previous versions when they
    // reopen the toolbar Generate button.
    it('should NOT clear history when opened with a currentAppId', () => {
      sessionStorage.setItem('workflow-gen-workflow-app-42-versions', JSON.stringify([{ keep: true }]))

      const { result } = renderHook(() => useWorkflowGeneratorStore())
      act(() => {
        result.current.openGenerator({ mode: 'workflow', currentAppId: 'app-42', currentAppMode: 'workflow' })
      })

      expect(sessionStorage.getItem('workflow-gen-workflow-app-42-versions')).not.toBeNull()
    })
  })
})
