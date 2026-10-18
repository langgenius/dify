import type { InjectWorkflowStoreSliceFn, Shape } from '@/app/components/workflow/store'
import type { Node } from '@/app/components/workflow/types'
import { act } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createWorkflowSlice } from '../../store/workflow/workflow-slice'
import { useAutoOnboarding } from '../use-auto-onboarding'

const setup = (initialState: Partial<Shape> = {}, nodes: Node[] = []) =>
  renderWorkflowFlowHook(() => useAutoOnboarding(), {
    nodes,
    initialStoreState: { isWorkflowDataLoaded: true, ...initialState },
    injectWorkflowStoreSliceFn: createWorkflowSlice as InjectWorkflowStoreSliceFn,
  })

describe('useAutoOnboarding', () => {
  beforeEach(() => {
    vi.useFakeTimers()
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
    const { store } = setup({}, [createNode({ id: 'existing-node', type: 'default' })])
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
