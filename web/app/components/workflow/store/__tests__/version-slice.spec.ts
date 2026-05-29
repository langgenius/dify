import type { VersionHistory } from '@/types/workflow'
import { createTestWorkflowStore } from '../../__tests__/workflow-test-env'

function createStore() {
  return createTestWorkflowStore()
}

describe('Version Slice', () => {
  describe('setDraftUpdatedAt', () => {
    it('should multiply timestamp by 1000 (seconds to milliseconds)', () => {
      const store = createStore()
      store.getState().setDraftUpdatedAt(1704067200)
      expect(store.getState().draftUpdatedAt).toBe(1704067200000)
    })

    it('should set 0 when given 0', () => {
      const store = createStore()
      store.getState().setDraftUpdatedAt(0)
      expect(store.getState().draftUpdatedAt).toBe(0)
    })
  })

  describe('setPublishedAt', () => {
    it('should multiply timestamp by 1000', () => {
      const store = createStore()
      store.getState().setPublishedAt(1704067200)
      expect(store.getState().publishedAt).toBe(1704067200000)
    })

    it('should set 0 when given 0', () => {
      const store = createStore()
      store.getState().setPublishedAt(0)
      expect(store.getState().publishedAt).toBe(0)
    })
  })

  describe('currentVersion', () => {
    it('should default to null', () => {
      const store = createStore()
      expect(store.getState().currentVersion).toBeNull()
    })

    it('should update current version', () => {
      const store = createStore()
      const version = { hash: 'abc', updated_at: 1000, version: '1.0' } as VersionHistory
      store.getState().setCurrentVersion(version)
      expect(store.getState().currentVersion).toEqual(version)
    })
  })

  describe('isRestoring', () => {
    it('should toggle restoring state', () => {
      const store = createStore()
      store.getState().setIsRestoring(true)
      expect(store.getState().isRestoring).toBe(true)

      store.getState().setIsRestoring(false)
      expect(store.getState().isRestoring).toBe(false)
    })
  })
})
