import { act, renderHook } from '@testing-library/react'
import { useWorkflowZoom } from '../use-workflow-zoom'

const {
  mockFitView,
  mockZoomIn,
  mockZoomOut,
  mockZoomTo,
  mockHandleSyncWorkflowDraft,
  runtimeState,
} = vi.hoisted(() => ({
  mockFitView: vi.fn(),
  mockZoomIn: vi.fn(),
  mockZoomOut: vi.fn(),
  mockZoomTo: vi.fn(),
  mockHandleSyncWorkflowDraft: vi.fn(),
  runtimeState: {
    workflowReadOnly: false,
  },
}))

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    fitView: mockFitView,
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    zoomTo: mockZoomTo,
  }),
}))

vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: (...args: unknown[]) => mockHandleSyncWorkflowDraft(...args),
  }),
}))

vi.mock('../use-workflow', () => ({
  useWorkflowReadOnly: () => ({
    getWorkflowReadOnly: () => runtimeState.workflowReadOnly,
  }),
}))

describe('useWorkflowZoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeState.workflowReadOnly = false
  })

  it('runs zoom actions and syncs the workflow draft when editable', () => {
    const { result } = renderHook(() => useWorkflowZoom())

    act(() => {
      result.current.handleFitView()
      result.current.handleBackToOriginalSize()
      result.current.handleSizeToHalf()
      result.current.handleZoomOut()
      result.current.handleZoomIn()
    })

    expect(mockFitView).toHaveBeenCalledTimes(1)
    expect(mockZoomTo).toHaveBeenCalledWith(1)
    expect(mockZoomTo).toHaveBeenCalledWith(0.5)
    expect(mockZoomOut).toHaveBeenCalledTimes(1)
    expect(mockZoomIn).toHaveBeenCalledTimes(1)
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(5)
  })

  it('blocks zoom actions when the workflow is read-only', () => {
    runtimeState.workflowReadOnly = true
    const { result } = renderHook(() => useWorkflowZoom())

    act(() => {
      result.current.handleFitView()
      result.current.handleBackToOriginalSize()
      result.current.handleSizeToHalf()
      result.current.handleZoomOut()
      result.current.handleZoomIn()
    })

    expect(mockFitView).not.toHaveBeenCalled()
    expect(mockZoomTo).not.toHaveBeenCalled()
    expect(mockZoomOut).not.toHaveBeenCalled()
    expect(mockZoomIn).not.toHaveBeenCalled()
    expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
  })
})
