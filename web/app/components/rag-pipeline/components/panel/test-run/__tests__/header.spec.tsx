import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Header from '../header'

const { mockSetIsPreparingDataSource, mockHandleCancelDebugAndPreviewPanel, mockWorkflowStore } =
  vi.hoisted(() => ({
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

vi.mock('@/app/components/workflow/hooks/use-workflow-panel-interactions', () => ({
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

  it('should render the title and reset preparing state on close', async () => {
    const user = userEvent.setup()
    render(<Header />)

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(screen.getByText('datasetPipeline.testRun.title')).toBeInTheDocument()
    expect(mockSetIsPreparingDataSource).toHaveBeenCalledWith(false)
    expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalledTimes(1)
  })

  it('should only cancel the panel when the datasource preparation flag is false', async () => {
    const user = userEvent.setup()
    mockWorkflowStore.getState.mockReturnValue({
      isPreparingDataSource: false,
      setIsPreparingDataSource: mockSetIsPreparingDataSource,
    })

    render(<Header />)
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(mockSetIsPreparingDataSource).not.toHaveBeenCalled()
    expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalledTimes(1)
  })
})
