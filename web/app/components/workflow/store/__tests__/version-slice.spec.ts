import { createTestWorkflowStore } from '../../__tests__/workflow-test-env'

describe('workflow version timestamps', () => {
  it('converts server seconds to milliseconds and clears an unset publication timestamp', () => {
    const store = createTestWorkflowStore()
    store.getState().setDraftUpdatedAt(1704067200)
    store.getState().setPublishedAt(1704067300)

    expect(store.getState().draftUpdatedAt).toBe(1704067200000)
    expect(store.getState().publishedAt).toBe(1704067300000)

    store.getState().setPublishedAt(0)
    expect(store.getState().publishedAt).toBe(0)
    expect(store.getState().draftUpdatedAt).toBe(1704067200000)
  })
})
