import { createStore } from 'zustand/vanilla'
import { createWorkflowDraftSlice } from '../workflow-draft-slice'

describe('createWorkflowDraftSlice', () => {
  it('stores draft metadata and flushes pending sync work', () => {
    const store = createStore(createWorkflowDraftSlice)
    const syncWorkflowDraft = vi.fn()

    store.getState().setSyncWorkflowDraftHash('draft-hash')
    store.getState().setIsSyncingWorkflowDraft(true)
    store.getState().setIsWorkflowDataLoaded(true)
    store.getState().setNodes([{ id: 'node-1' }] as never)
    store.getState().debouncedSyncWorkflowDraft(syncWorkflowDraft)
    store.getState().flushPendingSync()

    expect(store.getState().syncWorkflowDraftHash).toBe('draft-hash')
    expect(store.getState().isSyncingWorkflowDraft).toBe(true)
    expect(store.getState().isWorkflowDataLoaded).toBe(true)
    expect(store.getState().nodes).toEqual([{ id: 'node-1' }])
    expect(syncWorkflowDraft).toHaveBeenCalledTimes(1)
  })
})
