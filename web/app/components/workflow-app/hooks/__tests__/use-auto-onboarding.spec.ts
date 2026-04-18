import { act, renderHook } from '@testing-library/react'
import { useAutoOnboarding } from '../use-auto-onboarding'

const mockGetNodes = vi.fn()
const mockWorkflowStore = {
  getState: vi.fn(),
}

const mockSetShowOnboarding = vi.fn()
const mockSetHasShownOnboarding = vi.fn()
const mockSetShouldAutoOpenStartNodeSelector = vi.fn()
const mockSetHasSelectedStartNode = vi.fn()

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
    }),
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => mockWorkflowStore,
}))

describe('useAutoOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockGetNodes.mockReturnValue([])
    mockWorkflowStore.getState.mockReturnValue({
      showOnboarding: false,
      hasShownOnboarding: false,
      notInitialWorkflow: false,
      setShowOnboarding: mockSetShowOnboarding,
      setHasShownOnboarding: mockSetHasShownOnboarding,
      setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
      hasSelectedStartNode: false,
      setHasSelectedStartNode: mockSetHasSelectedStartNode,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should open onboarding after the delayed empty-canvas check on mount', () => {
    renderHook(() => useAutoOnboarding())

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockSetShowOnboarding).toHaveBeenCalledWith(true)
    expect(mockSetHasShownOnboarding).toHaveBeenCalledWith(true)
    expect(mockSetShouldAutoOpenStartNodeSelector).toHaveBeenCalledWith(true)
  })

  it('should skip auto onboarding when it is already visible or the workflow is not initial', () => {
    mockWorkflowStore.getState.mockReturnValue({
      showOnboarding: true,
      hasShownOnboarding: false,
      notInitialWorkflow: true,
      setShowOnboarding: mockSetShowOnboarding,
      setHasShownOnboarding: mockSetHasShownOnboarding,
      setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
      hasSelectedStartNode: false,
      setHasSelectedStartNode: mockSetHasSelectedStartNode,
    })

    renderHook(() => useAutoOnboarding())

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockSetShowOnboarding).not.toHaveBeenCalled()
    expect(mockSetHasShownOnboarding).not.toHaveBeenCalled()
    expect(mockSetShouldAutoOpenStartNodeSelector).not.toHaveBeenCalled()
  })

  it('should close onboarding and reset selected start node state when one was chosen', () => {
    mockWorkflowStore.getState.mockReturnValue({
      showOnboarding: false,
      hasShownOnboarding: true,
      notInitialWorkflow: false,
      setShowOnboarding: mockSetShowOnboarding,
      setHasShownOnboarding: mockSetHasShownOnboarding,
      setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
      hasSelectedStartNode: true,
      setHasSelectedStartNode: mockSetHasSelectedStartNode,
    })

    const { result } = renderHook(() => useAutoOnboarding())

    act(() => {
      result.current.handleOnboardingClose()
    })

    expect(mockSetShowOnboarding).toHaveBeenCalledWith(false)
    expect(mockSetHasShownOnboarding).toHaveBeenCalledWith(true)
    expect(mockSetHasSelectedStartNode).toHaveBeenCalledWith(false)
    expect(mockSetShouldAutoOpenStartNodeSelector).not.toHaveBeenCalled()
  })

  it('should close onboarding and disable auto-open when no start node was selected', () => {
    const { result } = renderHook(() => useAutoOnboarding())

    act(() => {
      result.current.handleOnboardingClose()
    })

    expect(mockSetShowOnboarding).toHaveBeenCalledWith(false)
    expect(mockSetHasShownOnboarding).toHaveBeenCalledWith(true)
    expect(mockSetShouldAutoOpenStartNodeSelector).toHaveBeenCalledWith(false)
    expect(mockSetHasSelectedStartNode).not.toHaveBeenCalled()
  })
})
