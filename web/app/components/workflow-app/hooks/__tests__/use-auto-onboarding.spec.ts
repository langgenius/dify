import type { ReactNode } from 'react'
import type { InjectWorkflowStoreSliceFn, Shape } from '@/app/components/workflow/store'
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { createTestWorkflowStore } from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowSlice } from '../../store/workflow/workflow-slice'
import { useAutoOnboarding } from '../use-auto-onboarding'

const getNodes = vi.hoisted(() => vi.fn())
vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
  useStoreApi: () => ({ getState: () => ({ getNodes }) }),
}))

const setup = (initialState: Partial<Shape> = {}) => {
  const store = createTestWorkflowStore(
    { isWorkflowDataLoaded: true, ...initialState },
    createWorkflowSlice as InjectWorkflowStoreSliceFn,
  )
  const hook = renderHook(() => useAutoOnboarding(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(WorkflowContext, { value: store }, children),
  })
  return { ...hook, store }
}

describe('useAutoOnboarding', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getNodes.mockReset().mockReturnValue([])
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens onboarding and the start selector after the delayed empty-canvas check', () => {
    const { store } = setup()
    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(store.getState().showOnboarding).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(store.getState()).toMatchObject({
      showOnboarding: true,
      hasShownOnboarding: true,
      shouldAutoOpenStartNodeSelector: true,
    })
  })

  it.each([
    { isWorkflowDataLoaded: false },
    { notInitialWorkflow: true },
    { hasShownOnboarding: true },
  ])('does not open onboarding when a prerequisite is missing (%j)', (initialState) => {
    const { store } = setup(initialState)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(store.getState().showOnboarding).toBe(false)
    expect(store.getState().shouldAutoOpenStartNodeSelector).toBe(false)
  })

  it('preserves an existing canvas instead of opening onboarding over it', () => {
    getNodes.mockReturnValue([{ id: 'existing-node' }])
    const { store } = setup()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(store.getState().showOnboarding).toBe(false)
    expect(store.getState().hasShownOnboarding).toBe(false)
  })

  it.each([true, false])(
    'closes onboarding and preserves auto-open only for a selected start node (selected=%s)',
    (hasSelectedStartNode) => {
      const { result, store } = setup({
        showOnboarding: true,
        shouldAutoOpenStartNodeSelector: true,
        hasSelectedStartNode,
      })
      act(() => {
        result.current.handleOnboardingClose()
      })
      expect(store.getState()).toMatchObject({
        showOnboarding: false,
        hasShownOnboarding: true,
        hasSelectedStartNode: false,
        shouldAutoOpenStartNodeSelector: hasSelectedStartNode,
      })
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(store.getState().showOnboarding).toBe(false)
    },
  )
})
