import { act } from '@testing-library/react'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowViewport } from '../use-workflow-viewport'

const interrupt = vi.hoisted(() => vi.fn())
vi.mock('reactflow', () => ({
  useStoreApi: () => ({ getState: () => ({ d3Selection: { interrupt } }) }),
}))

it('reports user navigation and interrupts queued viewport animations', () => {
  const onViewportInteraction = vi.fn()
  const { result } = renderWorkflowHook(() => useWorkflowViewport(), {
    hooksStoreProps: { onViewportInteraction },
  })
  act(() => result.current.handleViewportUserInteraction())
  expect(onViewportInteraction).toHaveBeenCalledOnce()
  expect(interrupt).toHaveBeenCalledOnce()
})
