import type { Node } from '@/app/components/workflow/types'
import { createTestWorkflowStore } from '../../__tests__/workflow-test-env'

function createStore() {
  return createTestWorkflowStore()
}

describe('Workflow Draft Slice', () => {
  describe('Initial State', () => {
    it('should have empty default values', () => {
      const store = createStore()
      const state = store.getState()
      expect(state.backupDraft).toBeUndefined()
      expect(state.syncWorkflowDraftHash).toBe('')
      expect(state.isSyncingWorkflowDraft).toBe(false)
      expect(state.isWorkflowDataLoaded).toBe(false)
      expect(state.nodes).toEqual([])
    })
  })

  describe('setBackupDraft', () => {
    it('should set and clear backup draft', () => {
      const store = createStore()
      const draft = {
        nodes: [] as Node[],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        environmentVariables: [],
      }
      store.getState().setBackupDraft(draft)
      expect(store.getState().backupDraft).toEqual(draft)

      store.getState().setBackupDraft(undefined)
      expect(store.getState().backupDraft).toBeUndefined()
    })
  })

  describe('setSyncWorkflowDraftHash', () => {
    it('should update the hash', () => {
      const store = createStore()
      store.getState().setSyncWorkflowDraftHash('abc123')
      expect(store.getState().syncWorkflowDraftHash).toBe('abc123')
    })
  })

  describe('setIsSyncingWorkflowDraft', () => {
    it('should toggle syncing state', () => {
      const store = createStore()
      store.getState().setIsSyncingWorkflowDraft(true)
      expect(store.getState().isSyncingWorkflowDraft).toBe(true)
    })
  })

  describe('setIsWorkflowDataLoaded', () => {
    it('should toggle loaded state', () => {
      const store = createStore()
      store.getState().setIsWorkflowDataLoaded(true)
      expect(store.getState().isWorkflowDataLoaded).toBe(true)
    })
  })

  describe('setNodes', () => {
    it('should update nodes array', () => {
      const store = createStore()
      const nodes: Node[] = []
      store.getState().setNodes(nodes)
      expect(store.getState().nodes).toEqual(nodes)
    })
  })

  describe('debouncedSyncWorkflowDraft', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should be a callable function', () => {
      const store = createStore()
      expect(typeof store.getState().debouncedSyncWorkflowDraft).toBe('function')
    })

    it('should debounce the sync call', () => {
      const store = createStore()
      const syncFn = vi.fn()

      store.getState().debouncedSyncWorkflowDraft(syncFn)
      expect(syncFn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(5000)
      expect(syncFn).toHaveBeenCalledTimes(1)
    })

    it('should flush pending sync via flushPendingSync', () => {
      const store = createStore()
      const syncFn = vi.fn()

      store.getState().debouncedSyncWorkflowDraft(syncFn)
      expect(syncFn).not.toHaveBeenCalled()

      store.getState().flushPendingSync()
      expect(syncFn).toHaveBeenCalledTimes(1)
    })
  })
})
