import { act } from '@testing-library/react'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import { renderWorkflowHook } from '../../../__tests__/workflow-test-env'

it('locks editing while applying Builder changes, then releases the lock', () => {
  const { result, store } = renderWorkflowHook(() => useNodesReadOnly())
  act(() => store.getState().setWorkflowDraftSyncPhase('builder'))
  expect(result.current.nodesReadOnly).toBe(true)
  act(() => store.getState().setWorkflowDraftSyncPhase('idle'))
  expect(result.current.nodesReadOnly).toBe(false)
  expect(result.current.getNodesReadOnly()).toBe(false)
})
