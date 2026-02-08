import { fireEvent, render, screen } from '@testing-library/react'
import ResultPanel from './result-panel'

// Mock ResDownload (sibling dep with CSV logic)
vi.mock('../run-batch/res-download', () => ({
  default: ({ values }: { values: Record<string, string>[] }) => (
    <button data-testid="res-download">
      Download (
      {values.length}
      )
    </button>
  ),
}))

const defaultProps = {
  isPC: true,
  isShowResultPanel: false,
  isCallBatchAPI: false,
  totalTasks: 0,
  successCount: 0,
  failedCount: 0,
  noPendingTask: true,
  exportRes: [] as Record<string, string>[],
  onRetryFailed: vi.fn(),
}

describe('ResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Renders children
  describe('Rendering', () => {
    it('should render children content', () => {
      render(
        <ResultPanel {...defaultProps}>
          <div>Result content</div>
        </ResultPanel>,
      )

      expect(screen.getByText('Result content')).toBeInTheDocument()
    })
  })

  // Batch header
  describe('Batch mode header', () => {
    it('should show execution count when isCallBatchAPI is true', () => {
      render(
        <ResultPanel {...defaultProps} isCallBatchAPI={true} totalTasks={5}>
          <div />
        </ResultPanel>,
      )

      expect(screen.getByText(/share\.generation\.executions/)).toBeInTheDocument()
    })

    it('should not show execution header when not in batch mode', () => {
      render(
        <ResultPanel {...defaultProps} isCallBatchAPI={false}>
          <div />
        </ResultPanel>,
      )

      expect(screen.queryByText(/share\.generation\.executions/)).not.toBeInTheDocument()
    })

    it('should show download button when there are successful tasks', () => {
      render(
        <ResultPanel {...defaultProps} isCallBatchAPI={true} successCount={3} exportRes={[{ a: 'b' }]}>
          <div />
        </ResultPanel>,
      )

      expect(screen.getByTestId('res-download')).toBeInTheDocument()
    })

    it('should not show download button when no successful tasks', () => {
      render(
        <ResultPanel {...defaultProps} isCallBatchAPI={true} successCount={0}>
          <div />
        </ResultPanel>,
      )

      expect(screen.queryByTestId('res-download')).not.toBeInTheDocument()
    })
  })

  // Loading indicator for pending tasks
  describe('Pending tasks', () => {
    it('should show loading area when there are pending tasks', () => {
      const { container } = render(
        <ResultPanel {...defaultProps} noPendingTask={false}>
          <div />
        </ResultPanel>,
      )

      expect(container.querySelector('.mt-4')).toBeInTheDocument()
    })

    it('should not show loading when all tasks are done', () => {
      const { container } = render(
        <ResultPanel {...defaultProps} noPendingTask={true}>
          <div />
        </ResultPanel>,
      )

      expect(container.querySelector('.mt-4')).not.toBeInTheDocument()
    })
  })

  // Failed tasks retry bar
  describe('Failed tasks retry', () => {
    it('should show retry bar when batch has failed tasks', () => {
      render(
        <ResultPanel {...defaultProps} isCallBatchAPI={true} failedCount={2}>
          <div />
        </ResultPanel>,
      )

      expect(screen.getByText(/share\.generation\.batchFailed\.info/)).toBeInTheDocument()
      expect(screen.getByText(/share\.generation\.batchFailed\.retry/)).toBeInTheDocument()
    })

    it('should call onRetryFailed when retry is clicked', () => {
      const onRetry = vi.fn()
      render(
        <ResultPanel {...defaultProps} isCallBatchAPI={true} failedCount={1} onRetryFailed={onRetry}>
          <div />
        </ResultPanel>,
      )

      fireEvent.click(screen.getByText(/share\.generation\.batchFailed\.retry/))

      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('should not show retry bar when no failed tasks', () => {
      render(
        <ResultPanel {...defaultProps} isCallBatchAPI={true} failedCount={0}>
          <div />
        </ResultPanel>,
      )

      expect(screen.queryByText(/share\.generation\.batchFailed\.retry/)).not.toBeInTheDocument()
    })

    it('should not show retry bar when not in batch mode even with failed count', () => {
      render(
        <ResultPanel {...defaultProps} isCallBatchAPI={false} failedCount={3}>
          <div />
        </ResultPanel>,
      )

      expect(screen.queryByText(/share\.generation\.batchFailed\.retry/)).not.toBeInTheDocument()
    })
  })
})
