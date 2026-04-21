import { fireEvent, render, screen } from '@testing-library/react'
import Header from '../header'

const {
  mockSetIsPreparingDataSource,
  mockHandleCancelDebugAndPreviewPanel,
  mockWorkflowStore,
} = vi.hoisted(() => ({
  mockSetIsPreparingDataSource: vi.fn(),
  mockHandleCancelDebugAndPreviewPanel: vi.fn(),
  mockWorkflowStore: {
    getState: vi.fn(() => ({
      isPreparingDataSource: true,
      setIsPreparingDataSource: vi.fn(),
    })),
  },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => mockWorkflowStore,
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowInteractions: () => ({
    handleCancelDebugAndPreviewPanel: mockHandleCancelDebugAndPreviewPanel,
  }),
}))

describe('TestRun header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.getState.mockReturnValue({
      isPreparingDataSource: true,
      setIsPreparingDataSource: mockSetIsPreparingDataSource,
    })
  })

  it('should render the title and reset preparing state on close', () => {
    render(<Header />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('datasetPipeline.testRun.title')).toBeInTheDocument()
    expect(mockSetIsPreparingDataSource).toHaveBeenCalledWith(false)
    expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalledTimes(1)
  })

  it('should only cancel the panel when the datasource preparation flag is false', () => {
    mockWorkflowStore.getState.mockReturnValue({
      isPreparingDataSource: false,
      setIsPreparingDataSource: mockSetIsPreparingDataSource,
    })

    render(<Header />)
    fireEvent.click(screen.getByRole('button'))

    expect(mockSetIsPreparingDataSource).not.toHaveBeenCalled()
    expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalledTimes(1)
  })
})
