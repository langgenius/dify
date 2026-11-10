import { act } from '@testing-library/react'
import { useNodesReadOnly, useWorkflowReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import { createTestWorkflowStore, renderWorkflowHook } from '../../../__tests__/workflow-test-env'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('pauses editing until the draft conflict is resolved', () => {
  const { result, store } = renderWorkflowHook(() => ({
    ...useNodesReadOnly(),
    ...useWorkflowReadOnly(),
  }))
  act(() => store.getState().setWorkflowDraftConflict(true))
  expect(result.current.nodesReadOnly).toBe(true)
  expect(result.current.getNodesReadOnly()).toBe(true)
  expect(result.current.workflowReadOnly).toBe(false)
  act(() => store.getState().setWorkflowDraftConflict(false))
  expect(result.current.nodesReadOnly).toBe(false)
})

it('cancels pending autosave when a conflict is detected', () => {
  const store = createTestWorkflowStore()
  const sync = vi.fn()
  store.getState().debouncedSyncWorkflowDraft(sync)
  store.getState().setWorkflowDraftConflict(true)
  store.getState().flushPendingSync()
  vi.advanceTimersByTime(5000)
  expect(sync).not.toHaveBeenCalled()
})

it('locks editing while preparing and applying Builder changes, then releases the lock', () => {
  const { result, store } = renderWorkflowHook(() => useNodesReadOnly())
  act(() => store.getState().setWorkflowDraftSyncPhase('preparing'))
  expect(result.current.nodesReadOnly).toBe(true)
  expect(result.current.getNodesReadOnly()).toBe(true)
  act(() => store.getState().setWorkflowDraftSyncPhase('builder'))
  expect(result.current.nodesReadOnly).toBe(true)
  act(() => store.getState().setWorkflowDraftSyncPhase('idle'))
  expect(result.current.nodesReadOnly).toBe(false)
  expect(result.current.getNodesReadOnly()).toBe(false)
})
