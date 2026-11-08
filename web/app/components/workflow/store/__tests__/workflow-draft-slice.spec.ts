import { createTestWorkflowStore } from '../../__tests__/workflow-test-env'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('syncs only the latest draft after editing has stopped for five seconds', () => {
  const store = createTestWorkflowStore()
  const first = vi.fn()
  const latest = vi.fn()
  store.getState().debouncedSyncWorkflowDraft(first)
  vi.advanceTimersByTime(3000)
  store.getState().debouncedSyncWorkflowDraft(latest)
  vi.advanceTimersByTime(4999)
  expect(first).not.toHaveBeenCalled()
  expect(latest).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(latest).toHaveBeenCalledTimes(1)
  expect(first).not.toHaveBeenCalled()
})

it('flushes the latest pending draft once without replaying it when the timer expires', () => {
  const store = createTestWorkflowStore()
  const first = vi.fn()
  const latest = vi.fn()
  store.getState().debouncedSyncWorkflowDraft(first)
  store.getState().debouncedSyncWorkflowDraft(latest)
  store.getState().flushPendingSync()
  expect(latest).toHaveBeenCalledTimes(1)
  expect(first).not.toHaveBeenCalled()
  vi.advanceTimersByTime(5000)
  store.getState().flushPendingSync()
  expect(latest).toHaveBeenCalledTimes(1)
})
